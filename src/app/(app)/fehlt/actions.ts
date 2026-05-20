"use server";

import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { runAgentForVendor } from "@/portals/agent/agent-connector";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import { requireCurrentAuth } from "@/lib/auth/current";

export type MissingCheckState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type PortalActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function runMissingCheckAction(_previousState: MissingCheckState): Promise<MissingCheckState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const result = await runMissingInvoiceCheck();
    revalidatePath("/");
    revalidatePath("/fehlt");
    return {
      status: "success",
      message: `${result.checked} Lieferant/Monat-Kombinationen geprüft, ${result.required} Online-Abrufe nötig.`,
    };
  } catch {
    return {
      status: "error",
      message: "Prüfung fehlgeschlagen. Details stehen in den Läufen.",
    };
  }
}

export async function runVendorRequiredPortalAction(
  _previousState: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const vendorKey = String(formData.get("vendorKey") || "").trim();
    if (!vendorKey) {
      return { status: "error", message: "Kein Lieferant angegeben." };
    }

    const requiredRows = await sql<{ yearMonth: string }[]>`
      SELECT vms.year_month AS "yearMonth"
      FROM vendor_month_status vms
      JOIN vendors v ON v.id = vms.vendor_id
      WHERE v.canonical_key = ${vendorKey} AND vms.portal_status = 'required'
      ORDER BY vms.year_month ASC
      LIMIT 1
    `;
    const required = requiredRows[0];

    const result = await runAgentForVendor({
      vendorKey,
      targetYearMonth: required?.yearMonth,
    });

    for (const download of result.downloads) {
      try {
        const buffer = await fs.readFile(download.filePath);
        await importPdfBuffer({
          buffer,
          originalFilename: download.originalFilename,
          sourceType: "portal",
          sourceRefId: vendorKey,
        });
      } catch {
        // import-Fehler werden in portal_run_logs protokolliert
      }
    }

    revalidatePath("/fehlt");
    revalidatePath("/audit");
    revalidatePath("/");

    if (result.status === "success") {
      return {
        status: "success",
        message: `${result.invoicesFound} Rechnung${result.invoicesFound === 1 ? "" : "en"} geholt.`,
      };
    }
    if (result.status === "login_required") {
      return { status: "error", message: "Login abgelaufen — bitte neu verbinden." };
    }
    if (result.status === "no_invoices") {
      return { status: "success", message: "Nichts gefunden im Online-Konto." };
    }
    if (result.status === "two_factor") {
      return { status: "error", message: "2FA-Code nötig — wir können nicht alleine weiter." };
    }
    if (result.status === "captcha") {
      return { status: "error", message: "Captcha aufgetaucht — bitte einmal manuell anmelden." };
    }
    return { status: "error", message: result.errorMessage ?? "Konnten nicht abrufen." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler.";
    return { status: "error", message: msg };
  }
}

export async function toggleVendorHiddenAction(formData: FormData): Promise<void> {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (!orgId) throw new Error("Keine Organisation zugeordnet.");
  const vendorId = Number(formData.get("vendorId"));
  const hidden = Number(formData.get("hidden"));
  if (!Number.isInteger(vendorId) || vendorId <= 0) return;
  if (hidden !== 0 && hidden !== 1) return;
  // Org-globale Built-in-Vendors (organization_id IS NULL) bleiben unangetastet;
  // jeder User kann nur Vendors der eigenen Org togglen.
  await sql`
    UPDATE vendors SET hidden = ${hidden === 1}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${vendorId} AND organization_id = ${orgId}
  `;
  revalidatePath("/fehlt");
}
