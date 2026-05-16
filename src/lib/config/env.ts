import path from "node:path";

const root = process.cwd();

function resolveLocalPath(value: string | undefined, fallback: string) {
  const raw = value?.trim() || fallback;
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

function clampConfidence(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export const appConfig = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  invoiceStoragePath: resolveLocalPath(process.env.INVOICE_STORAGE_PATH, "./data/invoices"),
  rawTextStoragePath: resolveLocalPath(process.env.RAW_TEXT_STORAGE_PATH, "./data/raw-text"),
  portalStoragePath: resolveLocalPath(process.env.PORTAL_STORAGE_PATH, "./data/sessions"),
  aiCacheStoragePath: resolveLocalPath(process.env.AI_CACHE_STORAGE_PATH, "./data/ai-cache"),
  logStoragePath: resolveLocalPath(process.env.LOG_STORAGE_PATH, "./data/logs"),
  syncMonthsBack: Number(process.env.SYNC_MONTHS_BACK || 6),
  mistral: {
    enabled: process.env.MISTRAL_ENABLED !== "false",
    configured: Boolean(process.env.MISTRAL_API_KEY),
    model: process.env.MISTRAL_MODEL || "mistral-small-latest",
    sendPdfBinary: process.env.AI_SEND_PDF_BINARY === "true",
  },
  features: {
    mailFirst: process.env.MAIL_FIRST_STRATEGY !== "false",
    portalFallback: process.env.PORTAL_FALLBACK_ENABLED === "true",
    enablePortals: process.env.ENABLE_PORTALS === "true",
    enableInboundMail: process.env.ENABLE_INBOUND_MAIL === "true",
    enableApiIntegrations: process.env.ENABLE_API_INTEGRATIONS === "true",
    enableCommunityRecipes: process.env.ENABLE_COMMUNITY_RECIPES === "true",
    enableMissingMatrix: process.env.ENABLE_MISSING_MATRIX !== "false",
    autoPilotEnabled: process.env.AUTO_PILOT_ENABLED !== "false",
    autoApprovalConfidenceThreshold: clampConfidence(process.env.AUTO_APPROVE_CONFIDENCE, 0.90),
  },
  selfHealing: {
    // Nach N erfolgreichen Imports pro Vendor wird automatisch eine
    // Auto-Approval-Rule angelegt. Bewährter Wert: 3 (genug Signal, früher Effekt).
    selfProvisionMinImports: Math.max(2, Number(process.env.SELF_PROVISION_MIN_IMPORTS || 3)),
    // Rule-Höchstbetrag = max(historischer Betrag) * Multiplier
    selfProvisionAmountMultiplier: Math.max(1, Number(process.env.SELF_PROVISION_AMOUNT_MULTIPLIER || 1.5)),
    // Disk-Files für 'ignored' Rechnungen werden nach X Tagen gelöscht (DB-Row bleibt für Audit).
    cleanupIgnoredAfterDays: Math.max(7, Number(process.env.CLEANUP_IGNORED_AFTER_DAYS || 30)),
    // Rechnungen die zu lange in 'needs_review' hängen → auf 'ignored' eskaliert.
    stuckEscalationAfterDays: Math.max(7, Number(process.env.STUCK_ESCALATION_AFTER_DAYS || 30)),
  },
  portalAgent: {
    headless: process.env.PORTAL_HEADLESS !== "false",
    slowMoMs: Math.max(0, Number(process.env.PORTAL_SLOWMO_MS || 0)),
    screenshotOnFailure: process.env.PORTAL_SCREENSHOT_ON_FAILURE !== "false",
    verbose: process.env.PORTAL_VERBOSE === "true",
  },
  aiProxy: {
    // Wenn url gesetzt: App ruft externen Proxy via HTTPS.
    // Wenn nicht gesetzt: In-Process-Call (Proxy-Logik laeuft im selben Server).
    url: process.env.AI_PROXY_URL?.trim() || null,
    // Bearer-Token zwischen App und Proxy. In dev: optional (kein Check).
    // Produktiv: Pflicht. Beidseitig in App + Proxy gesetzt.
    token: process.env.AI_PROXY_TOKEN?.trim() || null,
  },
  brevo: {
    // API-Key für ausgehende E-Mails (Benachrichtigungen, Digest) via Brevo.
    // Ohne Key: Notifications werden still übersprungen (dev-safe).
    // Erzeugen unter: app.brevo.com → SMTP & API → API Keys
    apiKey: process.env.BREVO_API_KEY?.trim() || null,
    // Absender — muss in Brevo als verifizierte Absenderadresse hinterlegt sein.
    fromEmail: process.env.BREVO_FROM_EMAIL?.trim() || "noreply@infetch.de",
    fromName: process.env.BREVO_FROM_NAME?.trim() || "Infetch",
  },
  sentry: {
    dsn: process.env.SENTRY_DSN?.trim() || null,
    // Webhook-Secret aus Sentry: Settings → Integrations → Webhooks → Secret.
    // Pflicht in production — verhindert dass fremde Requests in die Error-Log schreiben.
    webhookSecret: process.env.SENTRY_WEBHOOK_SECRET?.trim() || null,
  },
  stripe: {
    // Secret Key für server-side Stripe API calls (Tier-Lookup, Abo-Status).
    // Dashboard → Developers → API Keys → Secret key
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || null,
    // Webhook-Signing-Secret — verhindert gefälschte Webhook-Events.
    // Dashboard → Webhooks → dein Endpoint → Signing secret
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    // Price IDs für Upgrade-CTAs im Frontend (NEXT_PUBLIC — sicher im Browser).
    // Dashboard → Products → Preisliste → Price ID
    priceIdPro: process.env.STRIPE_PRICE_ID_PRO?.trim() || null,
    priceIdBusiness: process.env.STRIPE_PRICE_ID_BUSINESS?.trim() || null,
  },
};
