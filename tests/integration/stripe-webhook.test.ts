import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";

// ── Test-Setup ────────────────────────────────────────────────────────────────

const TEST_SECRET = "whsec_test_infetch_integration";
const TEST_CUSTOMER_ID = `cus_test_${Date.now()}`;
const TEST_PRICE_PRO = "price_test_pro_123";
const TEST_PRICE_BUSINESS = "price_test_business_456";

// Stripe-kompatible Signatur (t=timestamp,v1=hmac) ohne echten Stripe-Client
function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

function makeSubscriptionEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  opts: { customerId?: string; priceId?: string; status?: string } = {},
): string {
  return JSON.stringify({
    id: `evt_test_${Date.now()}`,
    type,
    data: {
      object: {
        id: `sub_test_${Date.now()}`,
        object: "subscription",
        customer: opts.customerId ?? TEST_CUSTOMER_ID,
        status: opts.status ?? "active",
        items: {
          data: [{ price: { id: opts.priceId ?? TEST_PRICE_PRO } }],
        },
      },
    },
  });
}

function makeCheckoutEvent(opts: {
  orgId: string;
  customerId?: string;
  subscription?: string | null;
} = { orgId: "org-test" }): string {
  return JSON.stringify({
    id: `evt_test_checkout_${Date.now()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        object: "checkout.session",
        customer: opts.customerId ?? TEST_CUSTOMER_ID,
        subscription: opts.subscription ?? null,
        metadata: { organization_id: opts.orgId },
      },
    },
  });
}

// Importiert den POST-Handler dynamisch (damit Env-Vars gesetzt sein können)
async function callWebhookHandler(body: string, secret = TEST_SECRET) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const signature = signStripePayload(body, secret);
  const request = new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body,
  });
  // NextRequest-compat: cast to any, Next.js request wrapper
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return POST(request as any);
}

// ── Test-Org ──────────────────────────────────────────────────────────────────

const TEST_ORG_ID = `org-stripe-test-${Date.now()}`;
const TEST_USER_ID = `user-stripe-test-${Date.now()}`;

async function setupTestOrg() {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${TEST_USER_ID}, ${`stripe-test-${Date.now()}@infetch.local`}, 'Stripe Test')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id, stripe_customer_id)
    VALUES (
      ${TEST_ORG_ID},
      'Stripe Test Org',
      ${`stripe-test-${Date.now()}`},
      'free',
      ${TEST_USER_ID},
      ${TEST_CUSTOMER_ID}
    )
    ON CONFLICT DO NOTHING
  `;
}

async function cleanupTestOrg() {
  await sql`DELETE FROM organizations WHERE id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM users WHERE id = ${TEST_USER_ID}`;
}

async function getOrgTier(orgId: string): Promise<string | null> {
  const rows = await sql<{ tier: string }[]>`SELECT tier FROM organizations WHERE id = ${orgId}`;
  return rows[0]?.tier ?? null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Stripe Webhook Handler", () => {
  const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const origPricePro = process.env.STRIPE_PRICE_ID_PRO;
  const origPriceBusiness = process.env.STRIPE_PRICE_ID_BUSINESS;
  const origStripeKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.STRIPE_PRICE_ID_PRO = TEST_PRICE_PRO;
    process.env.STRIPE_PRICE_ID_BUSINESS = TEST_PRICE_BUSINESS;
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    await setupTestOrg();
  });

  afterEach(async () => {
    await cleanupTestOrg();
    if (origSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = origSecret;
    if (origPricePro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = origPricePro;
    if (origPriceBusiness === undefined) delete process.env.STRIPE_PRICE_ID_BUSINESS;
    else process.env.STRIPE_PRICE_ID_BUSINESS = origPriceBusiness;
    if (origStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = origStripeKey;
  });

  it("lehnt Request mit fehlender Signatur ab (400)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const request = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it("lehnt Request mit falscher Signatur ab (400)", async () => {
    const body = makeSubscriptionEvent("customer.subscription.updated");
    const response = await callWebhookHandler(body, "wrong_secret");
    expect(response.status).toBe(400);
  });

  it("setzt tier='pro' bei customer.subscription.updated (status=active, Pro-Price)", async () => {
    const body = makeSubscriptionEvent("customer.subscription.updated", {
      customerId: TEST_CUSTOMER_ID,
      priceId: TEST_PRICE_PRO,
      status: "active",
    });
    const response = await callWebhookHandler(body);
    expect(response.status).toBe(200);

    const tier = await getOrgTier(TEST_ORG_ID);
    expect(tier).toBe("pro");
  });

  it("setzt tier='business' bei customer.subscription.updated (status=active, Business-Price)", async () => {
    const body = makeSubscriptionEvent("customer.subscription.updated", {
      customerId: TEST_CUSTOMER_ID,
      priceId: TEST_PRICE_BUSINESS,
      status: "active",
    });
    const response = await callWebhookHandler(body);
    expect(response.status).toBe(200);

    const tier = await getOrgTier(TEST_ORG_ID);
    expect(tier).toBe("business");
  });

  it("setzt tier='free' bei customer.subscription.deleted", async () => {
    // Org erst auf pro setzen
    await sql`UPDATE organizations SET tier = 'pro' WHERE id = ${TEST_ORG_ID}`;

    const body = makeSubscriptionEvent("customer.subscription.deleted", {
      customerId: TEST_CUSTOMER_ID,
      status: "canceled",
    });
    const response = await callWebhookHandler(body);
    expect(response.status).toBe(200);

    const tier = await getOrgTier(TEST_ORG_ID);
    expect(tier).toBe("free");
  });

  it("setzt tier='free' bei past_due-Status", async () => {
    await sql`UPDATE organizations SET tier = 'pro' WHERE id = ${TEST_ORG_ID}`;

    const body = makeSubscriptionEvent("customer.subscription.updated", {
      customerId: TEST_CUSTOMER_ID,
      priceId: TEST_PRICE_PRO,
      status: "past_due",
    });
    const response = await callWebhookHandler(body);
    expect(response.status).toBe(200);

    const tier = await getOrgTier(TEST_ORG_ID);
    expect(tier).toBe("free");
  });

  it("antwortet 200 bei unbekannten Event-Typen (kein Crash)", async () => {
    const body = JSON.stringify({
      id: "evt_unknown",
      type: "payment_intent.created",
      data: { object: {} },
    });
    const response = await callWebhookHandler(body);
    expect(response.status).toBe(200);
  });

  it("checkout.session.completed ohne Subscription setzt stripe_customer_id auf Org", async () => {
    const body = makeCheckoutEvent({
      orgId: TEST_ORG_ID,
      customerId: TEST_CUSTOMER_ID,
      subscription: null,
    });
    const response = await callWebhookHandler(body);
    expect(response.status).toBe(200);

    const [org] = await sql<{ stripe_customer_id: string }[]>`
      SELECT stripe_customer_id FROM organizations WHERE id = ${TEST_ORG_ID}
    `;
    expect(org.stripe_customer_id).toBe(TEST_CUSTOMER_ID);
  });
});
