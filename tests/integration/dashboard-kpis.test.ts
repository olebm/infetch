import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  getAutomationStats,
  getMonthlyKpis,
  getDailyTimeseries,
  getSecondaryStats,
} from "@/lib/db/queries";

// Hebel 4 (stats-kpi-queries-untested): Die dem Nutzer angezeigten Dashboard-
// Zahlen waren nur auf Mandanten-Isolation und Datums-Achse getestet
// (tenant-isolation-queries.test.ts), NICHT auf Rechen-Korrektheit. Diese Datei
// fixiert, dass die BERECHNUNG stimmt: Summen, Deltas, die Stunden-Schätzung,
// Tag-/Wochenfenster, Latenz, Forecast — und getSecondaryStats überhaupt.
//
// Zeit-Steuerung: created_at/updated_at/sent_at sind TEXT (ISO). Wir setzen sie
// relativ zur DB-Uhr per (NOW() - INTERVAL '…')::TEXT, damit die Fenster-Grenzen
// (heute / 7 Tage / 30 Tage) deterministisch fallen, ohne von der Node-Zeitzone
// abzuhängen. Zeit-abhängige Aggregate (daysActive, daysSince, Forecast) prüfen
// wir bewusst als Bereich, nicht auf die Sekunde — ehrlicher als ein Flake.

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}`;

async function seedOrg(orgId: string, userId: string) {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@kpi.local`}, 'Kpi') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT DO NOTHING
  `;
}

// Exportierte Rechnung mit KONTROLLIERTEM updated_at (= Verarbeitungs-/Versand-
// zeit, worauf Automation/Kpis/Timeseries aggregieren). `agoInterval` ist ein
// Postgres-Intervall-Literal wie '2 days' / '40 days' / '0 seconds'.
async function seedExported(
  orgId: string,
  tag: string,
  amountGross: number,
  updatedAgo: string,
  createdAgo = updatedAgo,
): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO invoices
      (organization_id, source, status, confidence, dedupe_key, invoice_date, amount_gross, created_at, updated_at)
    VALUES
      (${orgId}, 'manual', 'exported', 0.9, ${`${tag}-${SUFFIX}`}, '2020-01-10', ${amountGross},
       (NOW() - ${createdAgo}::INTERVAL)::TEXT,
       (NOW() - ${updatedAgo}::INTERVAL)::TEXT)
    RETURNING id
  `;
  return Number(row.id);
}

async function seedInvoice(
  orgId: string,
  tag: string,
  status: string,
  createdAgo: string,
): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO invoices
      (organization_id, source, status, confidence, dedupe_key, created_at, updated_at)
    VALUES
      (${orgId}, 'manual', ${status}, 0.9, ${`${tag}-${SUFFIX}`},
       (NOW() - ${createdAgo}::INTERVAL)::TEXT,
       (NOW() - ${createdAgo}::INTERVAL)::TEXT)
    RETURNING id
  `;
  return Number(row.id);
}

async function cleanupOrg(orgId: string, userId: string) {
  await sql`DELETE FROM exports WHERE organization_id = ${orgId}`;
  await sql`DELETE FROM export_targets WHERE organization_id = ${orgId}`;
  await sql`DELETE FROM invoices WHERE organization_id = ${orgId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
}

// ─── getAutomationStats: Hero-Zahlen (heute/Woche/gesamt/Stunden) ──────────────

describe.skipIf(!hasDb)("getAutomationStats — Berechnung", () => {
  const ORG = `kpi-auto-${SUFFIX}`;
  const USER = `kpi-auto-u-${SUFFIX}`;

  beforeEach(async () => {
    await cleanupOrg(ORG, USER);
    await seedOrg(ORG, USER);
    // 3× heute exportiert, 1× vor 3 Tagen (noch in 7-Tage-Woche), 1× vor 40 Tagen.
    await seedExported(ORG, "auto-t1", 10, "0 seconds");
    await seedExported(ORG, "auto-t2", 10, "1 hours");
    await seedExported(ORG, "auto-t3", 10, "2 hours");
    await seedExported(ORG, "auto-w1", 10, "3 days");
    await seedExported(ORG, "auto-old", 10, "40 days");
    // 2× Review, 1× ready (captured = ready + exported).
    await seedInvoice(ORG, "auto-r1", "needs_review", "1 days");
    await seedInvoice(ORG, "auto-r2", "needs_review", "1 days");
    await seedInvoice(ORG, "auto-rdy", "ready", "1 days");
  });
  afterEach(() => cleanupOrg(ORG, USER));

  it("exportedLifetime = alle exportierten, exportedToday nach updated_at", async () => {
    const s = await getAutomationStats(ORG);
    expect(s.exportedLifetime).toBe(5);
    expect(s.exportedToday).toBe(3); // nur updated_at = heute
  });

  it("exportedThisWeek = 7-Tage-Fenster (heute + vor 3 Tagen, nicht vor 40)", async () => {
    const s = await getAutomationStats(ORG);
    expect(s.exportedThisWeek).toBe(4);
  });

  it("needsReview + capturedCount (ready + exported) getrennt gezählt", async () => {
    const s = await getAutomationStats(ORG);
    expect(s.needsReview).toBe(2);
    expect(s.capturedCount).toBe(6); // 5 exported + 1 ready
  });

  it("hoursSavedLifetime = Schätzung 2 Min/Rechnung, auf 0,1 h gerundet", async () => {
    const s = await getAutomationStats(ORG);
    // 5 × 2 Min = 10 Min = 0,1667 h → gerundet 0,2.
    expect(s.hoursSavedLifetime).toBe(0.2);
  });

  it("daysActive ≈ Tage seit ältestem updated_at (~40)", async () => {
    const s = await getAutomationStats(ORG);
    expect(s.daysActive).not.toBeNull();
    expect(s.daysActive!).toBeGreaterThanOrEqual(39);
    expect(s.daysActive!).toBeLessThanOrEqual(41);
  });

  it("Null-Org-Kontrakt: alle Zahlen 0, daysActive null (kein Cross-Tenant-Aggregat)", async () => {
    const s = await getAutomationStats(null);
    expect(s).toMatchObject({
      exportedToday: 0,
      exportedThisWeek: 0,
      exportedLifetime: 0,
      needsReview: 0,
      capturedCount: 0,
      hoursSavedLifetime: 0,
      daysActive: null,
    });
  });
});

// ─── Guardrail (Item 3): Semantik der Zeitachse ────────────────────────────────
// exportedToday/-Woche aggregieren auf updated_at (Versandzeit), NICHT created_at
// oder invoice_date. Bekannter Trade-off: ein ERNEUTER Export/Review-Speichern
// (export-pipeline.ts / review.ts setzen updated_at = NOW()) datiert eine bereits
// exportierte Rechnung neu → sie taucht erneut in „heute" auf. Reine Inhalts-
// Edits ohne updated_at (Audit-Flags) verschieben sie NICHT — das pinnen wir hier.

describe.skipIf(!hasDb)("getAutomationStats — Zeitachse (Guardrail)", () => {
  const ORG = `kpi-guard-${SUFFIX}`;
  const USER = `kpi-guard-u-${SUFFIX}`;

  beforeEach(async () => {
    await cleanupOrg(ORG, USER);
    await seedOrg(ORG, USER);
  });
  afterEach(() => cleanupOrg(ORG, USER));

  it("zählt nach updated_at, nicht created_at: alt erstellt + heute versendet → heute", async () => {
    // created vor 400 Tagen, versendet (updated_at) heute.
    await seedExported(ORG, "guard-old-created", 10, "0 seconds", "400 days");
    const s = await getAutomationStats(ORG);
    expect(s.exportedToday).toBe(1);
  });

  it("alt versendet (updated_at) zählt NICHT als heute, auch wenn created_at heute", async () => {
    await seedExported(ORG, "guard-old-updated", 10, "40 days", "0 seconds");
    const s = await getAutomationStats(ORG);
    expect(s.exportedToday).toBe(0);
    expect(s.exportedLifetime).toBe(1);
  });

  it("reiner Inhalts-Edit ohne updated_at haelt die Rechnung in 'heute'", async () => {
    const id = await seedExported(ORG, "guard-edit", 10, "0 seconds");
    expect((await getAutomationStats(ORG)).exportedToday).toBe(1);
    // Audit-artiger Edit, der updated_at bewusst NICHT anfasst (kein Trigger).
    await sql`UPDATE invoices SET is_private = TRUE WHERE id = ${id}`;
    expect((await getAutomationStats(ORG)).exportedToday).toBe(1);
  });
});

// ─── getMonthlyKpis: Summe + Delta zum Vormonat ────────────────────────────────

describe.skipIf(!hasDb)("getMonthlyKpis — Berechnung", () => {
  const ORG = `kpi-monthly-${SUFFIX}`;
  const USER = `kpi-monthly-u-${SUFFIX}`;
  const MONTH = new Date().toISOString().slice(0, 7);

  beforeEach(async () => {
    await cleanupOrg(ORG, USER);
    await seedOrg(ORG, USER);
  });
  afterEach(() => cleanupOrg(ORG, USER));

  it("total + sumGross für den laufenden Monat (nach updated_at)", async () => {
    await seedExported(ORG, "m-cur1", 100, "0 seconds");
    await seedExported(ORG, "m-cur2", 200, "1 hours");
    await seedExported(ORG, "m-cur3", 300, "2 hours");
    const k = await getMonthlyKpis(MONTH, ORG);
    expect(k.total).toBe(3);
    expect(k.sumGross).toBe(600);
  });

  it("deltaPercent gegen Vormonat gerundet (prev=2 → cur=3 → +50%)", async () => {
    // Fixe Kalendermonate, damit die Vormonats-Logik unabhängig vom Testdatum ist.
    await seedExportedAt(ORG, "m-jan1", 100, "2025-01-15 10:00:00");
    await seedExportedAt(ORG, "m-jan2", 100, "2025-01-16 10:00:00");
    await seedExportedAt(ORG, "m-jan3", 100, "2025-01-17 10:00:00");
    await seedExportedAt(ORG, "m-dec1", 50, "2024-12-10 10:00:00");
    await seedExportedAt(ORG, "m-dec2", 50, "2024-12-11 10:00:00");
    const k = await getMonthlyKpis("2025-01", ORG);
    expect(k.total).toBe(3);
    expect(k.prevTotal).toBe(2); // Jahres-Rollover Dez 2024 korrekt gegriffen
    expect(k.prevSumGross).toBe(100);
    expect(k.deltaPercent).toBe(50);
  });

  it("deltaPercent = null wenn Vormonat leer (keine Division durch 0)", async () => {
    await seedExportedAt(ORG, "m-solo", 100, "2025-06-15 10:00:00");
    const k = await getMonthlyKpis("2025-06", ORG);
    expect(k.total).toBe(1);
    expect(k.prevTotal).toBe(0);
    expect(k.deltaPercent).toBeNull();
  });

  // Exportierte Rechnung mit ABSOLUTEM updated_at (fixer Kalendermonat).
  async function seedExportedAt(orgId: string, tag: string, amount: number, updatedAt: string) {
    await sql`
      INSERT INTO invoices
        (organization_id, source, status, confidence, dedupe_key, invoice_date, amount_gross, created_at, updated_at)
      VALUES
        (${orgId}, 'manual', 'exported', 0.9, ${`${tag}-${SUFFIX}`}, '2020-01-10', ${amount},
         ${updatedAt}, ${updatedAt})
    `;
  }
});

// ─── getDailyTimeseries: lückenlose Tagesreihe ─────────────────────────────────

describe.skipIf(!hasDb)("getDailyTimeseries — Berechnung", () => {
  const ORG = `kpi-ts-${SUFFIX}`;
  const USER = `kpi-ts-u-${SUFFIX}`;

  beforeEach(async () => {
    await cleanupOrg(ORG, USER);
    await seedOrg(ORG, USER);
  });
  afterEach(() => cleanupOrg(ORG, USER));

  it("liefert genau `days` Einträge, chronologisch aufsteigend, Lücken mit 0", async () => {
    await seedExported(ORG, "ts-a", 10, "0 seconds");
    await seedExported(ORG, "ts-b", 10, "0 seconds");
    await seedExported(ORG, "ts-c", 10, "2 days");
    const series = await getDailyTimeseries(7, ORG);
    expect(series).toHaveLength(7);
    // Aufsteigend sortiert.
    const dates = series.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
    // Alle Zähler ≥ 0, Summe = Anzahl im Fenster (3).
    expect(series.reduce((s, r) => s + r.count, 0)).toBe(3);
  });

  it("Rechnung außerhalb des Fensters wird ausgeschlossen", async () => {
    await seedExported(ORG, "ts-in", 10, "1 days");
    await seedExported(ORG, "ts-out", 10, "10 days"); // außerhalb 7-Tage-Fenster
    const series = await getDailyTimeseries(7, ORG);
    expect(series.reduce((s, r) => s + r.count, 0)).toBe(1);
  });
});

// ─── getSecondaryStats: bislang komplett ungetestet ────────────────────────────

describe.skipIf(!hasDb)("getSecondaryStats — Berechnung", () => {
  const ORG = `kpi-sec-${SUFFIX}`;
  const USER = `kpi-sec-u-${SUFFIX}`;

  async function seedTarget(orgId: string): Promise<number> {
    // `enabled`/`smtp_slot` bewusst ausgelassen (Defaults greifen): enabled ist
    // je nach Umgebung BOOLEAN (lokal/CI) oder INTEGER (Prod) — die Divergenz
    // ist für getSecondaryStats irrelevant, da es export_targets.enabled nie liest.
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO export_targets (target, label, recipient_email, organization_id)
      VALUES ('kontist', 'Kontist', 'buchhaltung@kpi.local', ${orgId})
      RETURNING id
    `;
    return Number(row.id);
  }

  // Versendeter Export: invoice created vor `createdAgo`, sent_at vor `sentAgo`.
  // Latenz = created_at → sent_at.
  async function seedSentExport(
    orgId: string,
    targetId: number,
    tag: string,
    createdAgo: string,
    sentAgo: string,
  ) {
    const [inv] = await sql<{ id: number }[]>`
      INSERT INTO invoices
        (organization_id, source, status, confidence, dedupe_key, created_at, updated_at)
      VALUES
        (${orgId}, 'manual', 'exported', 0.9, ${`${tag}-${SUFFIX}`},
         (NOW() - ${createdAgo}::INTERVAL)::TEXT,
         (NOW() - ${sentAgo}::INTERVAL)::TEXT)
      RETURNING id
    `;
    await sql`
      INSERT INTO exports (invoice_id, export_target_id, status, sent_at, organization_id)
      VALUES (${inv.id}, ${targetId}, 'sent', (NOW() - ${sentAgo}::INTERVAL)::TEXT, ${orgId})
    `;
  }

  beforeEach(async () => {
    await cleanupOrg(ORG, USER);
    await seedOrg(ORG, USER);
  });
  afterEach(() => cleanupOrg(ORG, USER));

  it("avgLatencyMin = Mittel aus (sent_at − created_at)", async () => {
    const t = await seedTarget(ORG);
    // Latenzen 60 und 120 Min → Mittel 90.
    await seedSentExport(ORG, t, "sec-l1", "60 minutes", "0 minutes");
    await seedSentExport(ORG, t, "sec-l2", "120 minutes", "0 minutes");
    const s = await getSecondaryStats(ORG);
    expect(s.avgLatencyMin).not.toBeNull();
    expect(s.avgLatencyMin!).toBeGreaterThanOrEqual(89);
    expect(s.avgLatencyMin!).toBeLessThanOrEqual(91);
  });

  it("filteredThisMonth = ignored + duplicate im laufenden Monat", async () => {
    await seedInvoice(ORG, "sec-ign", "ignored", "1 days");
    await seedInvoice(ORG, "sec-dup", "duplicate", "2 days");
    await seedInvoice(ORG, "sec-old", "ignored", "40 days"); // Vormonat → zählt nicht
    const s = await getSecondaryStats(ORG);
    expect(s.filteredThisMonth).toBe(2);
  });

  it("daysSinceLastIntervention ≈ Tage seit letztem Review", async () => {
    await seedInvoice(ORG, "sec-rev", "needs_review", "5 days");
    const s = await getSecondaryStats(ORG);
    expect(s.daysSinceLastIntervention).not.toBeNull();
    expect(s.daysSinceLastIntervention!).toBeGreaterThanOrEqual(4);
    expect(s.daysSinceLastIntervention!).toBeLessThanOrEqual(6);
  });

  it("Autopilot-Fallback: ohne Review, aber mit Sends → Tage seit erstem Send", async () => {
    const t = await seedTarget(ORG);
    await seedSentExport(ORG, t, "sec-auto", "10 days", "10 days");
    const s = await getSecondaryStats(ORG);
    // Kein needs_review → Fallback auf Tage seit frühestem sent_at (~10).
    expect(s.daysSinceLastIntervention).not.toBeNull();
    expect(s.daysSinceLastIntervention!).toBeGreaterThanOrEqual(9);
    expect(s.daysSinceLastIntervention!).toBeLessThanOrEqual(11);
  });

  it("forecastRestMonth: Zahl ≥ 0 bei Sends in den letzten 30 Tagen", async () => {
    const t = await seedTarget(ORG);
    await seedSentExport(ORG, t, "sec-fc1", "5 days", "5 days");
    await seedSentExport(ORG, t, "sec-fc2", "6 days", "6 days");
    const s = await getSecondaryStats(ORG);
    // Exakter Wert hängt vom Tag im Monat ab (Rate × Resttage) → nur Kontrakt prüfen.
    expect(s.forecastRestMonth).not.toBeNull();
    expect(s.forecastRestMonth!).toBeGreaterThanOrEqual(0);
  });

  it("Null-Org-Kontrakt: Defaults (nulls + filteredThisMonth 0)", async () => {
    const s = await getSecondaryStats(null);
    expect(s).toEqual({
      daysSinceLastIntervention: null,
      avgLatencyMin: null,
      filteredThisMonth: 0,
      forecastRestMonth: null,
    });
  });
});
