/**
 * READ-ONLY-Audit: zählt pro Org den Setup-Status aus getSetupSnapshot()
 * und listet alle Orgs, die der Dashboard-Hard-Gate (siehe
 * src/app/(app)/layout.tsx) zurück ins Onboarding lenken würde.
 *
 * Nutzbar nach Schema-Migrationen, nach Hard-Gate-Anpassungen oder vor
 * Deploys, die Setup-Detection verändern. Keine Schreiboperationen.
 *
 * Aufruf gegen Prod (DB-Host muss `supabase.co` enthalten, sonst Abort):
 *
 *   DATABASE_URL=$(grep ^DATABASE_URL .env.prod.local | cut -d= -f2-) \
 *   MISTRAL_API_KEY=$(grep ^MISTRAL_API_KEY .env.prod.local | cut -d= -f2-) \
 *   npx tsx scripts/prod-setup-audit.ts
 *
 * (MISTRAL_API_KEY wird übergeben, damit getSetupSnapshot keine
 * Konfigurations-Lücke meldet — das KI-Backend ist global, nicht org-bound.)
 */
// Audit ist per Definition cross-org (zählt alle Prod-Orgs) — daher der
// `unsafeGlobalSql`-Alias statt des gescopten Clients.
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { getSetupSnapshot } from "@/lib/db/queries";

type OrgRow = { id: string; name: string; tier: string; created_at: string };

async function main() {
  if (!process.env.DATABASE_URL?.includes("supabase.co")) {
    console.error("[abort] DATABASE_URL does not look like Prod-Supabase. Refusing.");
    process.exit(1);
  }
  console.error(`[audit] DATABASE_URL host: ${new URL(process.env.DATABASE_URL).host}`);

  const orgs = await sql<OrgRow[]>`
    SELECT id, name, tier, created_at::text AS created_at
    FROM organizations
    ORDER BY created_at ASC
  `;

  const incomplete: Array<{ id: string; name: string; tier: string; missing: string[]; created: string }> = [];
  let complete = 0;

  for (const org of orgs) {
    const snap = await getSetupSnapshot(org.id);
    const missing: string[] = [];
    if (!snap.imapConfigured) missing.push("IMAP");
    if (!snap.smtpConfigured) missing.push("SMTP");
    if (!snap.exportTargetActive) missing.push("ExportTarget");
    if (missing.length === 0) {
      complete++;
    } else {
      incomplete.push({ id: org.id, name: org.name, tier: org.tier, missing, created: org.created_at });
    }
  }

  console.log(`\n=== Prod-Setup-Audit (${new Date().toISOString()}) ===`);
  console.log(`Total Orgs:           ${orgs.length}`);
  console.log(`Vollständiges Setup:  ${complete}`);
  console.log(`Halb-Setup (Gate würde sie ins Onboarding zurückwerfen): ${incomplete.length}\n`);

  if (incomplete.length > 0) {
    console.log("Halb-Setup-Orgs (id | tier | created | fehlt):");
    for (const o of incomplete) {
      console.log(`  ${o.id}  ${o.tier.padEnd(8)}  ${o.created.slice(0, 10)}  fehlt: ${o.missing.join(", ")}  (${o.name})`);
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error("[audit] failed:", err);
  process.exit(1);
});
