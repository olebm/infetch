"use server";

import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import { getDb } from "@/lib/db/client";
import { saveCredentialSecret } from "@/lib/secrets/credential-store";
import {
  savePortalCredentialMeta,
  resetPortalCredentialMeta,
} from "@/portals/credential-meta";
import { runAgentForVendor } from "@/portals/agent/agent-connector";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import { invalidateBrowserSession } from "@/portals/agent/session-store";
import { findVendorByCanonicalKey, upsertVendor } from "@/lib/db/queries";
import { syncCommunityRecipes } from "@/portals/agent/community-sync";
import { canAddOnlineAccount, getLimits, getTier } from "@/lib/tier";

export type ConnectState = {
  status: "idle" | "success" | "error";
  message: string;
  vendorKey?: string;
  invoicesFound?: number;
};

export async function connectOnlineAccountAction(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  void _prev;
  try {
    const mode = String(formData.get("mode") || "").trim();
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const loginUrl = String(formData.get("loginUrl") || "").trim();
    const category = String(formData.get("category") || "").trim() || null;
    const totpSecret = String(formData.get("totpSecret") || "").trim();

    if (!username || !password.trim()) {
      return { status: "error", message: "Bitte Benutzername und Passwort eingeben." };
    }
    if (!loginUrl || !/^https?:\/\//i.test(loginUrl)) {
      return { status: "error", message: "Bitte eine gültige Login-URL eingeben (mit https://)." };
    }
    if (totpSecret) {
      const cleaned = totpSecret.replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z2-7]{16,}$/.test(cleaned)) {
        return {
          status: "error",
          message: "Der TOTP-Schlüssel sieht ungültig aus. Er sollte aus Base32-Zeichen bestehen (A-Z, 2-7, mind. 16 Zeichen).",
        };
      }
    }

    const tier = getTier();
    const limit = canAddOnlineAccount(undefined, tier);
    if (!limit.allowed) {
      const proPrice = getLimits("pro").priceMonthlyEur;
      return {
        status: "error",
        message: `Im Free-Tier sind ${limit.max} Online-Konten möglich (${limit.current} verbunden). Auf Pro upgraden (${proPrice} €/Monat) oder ein bestehendes Konto entfernen.`,
      };
    }

    let vendorName: string;
    let canonicalKey: string;

    if (mode === "existing") {
      const existingKey = String(formData.get("vendorKey") || "").trim();
      const vendor = findVendorByCanonicalKey(existingKey);
      if (!vendor) {
        return { status: "error", message: "Lieferant nicht gefunden." };
      }
      vendorName = vendor.name;
      canonicalKey = vendor.canonicalKey;
    } else if (mode === "new") {
      const newName = String(formData.get("vendorName") || "").trim();
      if (newName.length < 2) {
        return { status: "error", message: "Bitte einen Namen für den Lieferanten eingeben." };
      }
      vendorName = newName;
      canonicalKey = generateCanonicalKey(newName);
    } else {
      return { status: "error", message: "Ungültiger Modus." };
    }

    // Vendor anlegen oder aktualisieren mit URL + Kategorie
    const vendor = upsertVendor({
      name: vendorName,
      canonicalKey,
      portalLoginUrl: loginUrl,
      portalCategory: category,
    });

    // Credentials sicher speichern
    await saveCredentialSecret({
      scope: "portal",
      ownerId: vendor.canonicalKey,
      label: `${vendor.name} Online-Konto`,
      secret: password,
    });
    savePortalCredentialMeta({ vendorKey: vendor.canonicalKey, username });

    // Optionaler TOTP-Schlüssel
    if (totpSecret) {
      const cleaned = totpSecret.replace(/\s+/g, "").toUpperCase();
      await saveCredentialSecret({
        scope: "totp",
        ownerId: vendor.canonicalKey,
        label: `${vendor.name} TOTP-Schlüssel`,
        secret: cleaned,
      });
    }

    // Erstabruf (kann beim Recording 30-60 Sek dauern)
    const result = await runAgentForVendor({ vendorKey: vendor.canonicalKey });
    await importDownloads(result.downloads, vendor.canonicalKey);

    revalidatePath("/einstellungen");
    revalidatePath("/audit");
    revalidatePath("/");

    if (result.status === "success") {
      return {
        status: "success",
        message: `${vendor.name} verbunden. ${result.invoicesFound} Rechnung${result.invoicesFound === 1 ? "" : "en"} geholt.`,
        vendorKey: vendor.canonicalKey,
        invoicesFound: result.invoicesFound,
      };
    }
    if (result.status === "no_invoices") {
      return {
        status: "success",
        message: `${vendor.name} verbunden. Aktuell keine Rechnungen gefunden — wir prüfen ab jetzt automatisch.`,
        vendorKey: vendor.canonicalKey,
      };
    }
    if (result.status === "login_required") {
      return {
        status: "error",
        message: `Login bei ${vendor.name} ist fehlgeschlagen. Prüf Benutzername und Passwort.`,
        vendorKey: vendor.canonicalKey,
      };
    }
    if (result.status === "two_factor") {
      return {
        status: "error",
        message: `${vendor.name} fordert einen 2FA-Code. Das unterstützen wir noch nicht automatisch — du kannst die Sitzung einmal manuell anmelden.`,
        vendorKey: vendor.canonicalKey,
      };
    }
    if (result.status === "captcha") {
      return {
        status: "error",
        message: `${vendor.name} zeigt ein CAPTCHA. Bitte einmal manuell anmelden, danach übernehmen wir.`,
        vendorKey: vendor.canonicalKey,
      };
    }
    return {
      status: "error",
      message: result.errorMessage ?? `Konnten ${vendor.name} nicht abrufen.`,
      vendorKey: vendor.canonicalKey,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler.";
    return { status: "error", message: msg };
  }
}

export type PortalCheckState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function fetchOnlineAccountNowAction(
  _prev: PortalCheckState,
  formData: FormData,
): Promise<PortalCheckState> {
  void _prev;
  try {
    const vendorKey = String(formData.get("vendorKey") || "").trim();
    if (!vendorKey) return { status: "error", message: "Kein Lieferant angegeben." };

    const result = await runAgentForVendor({ vendorKey });
    await importDownloads(result.downloads, vendorKey);

    revalidatePath("/einstellungen");
    revalidatePath("/audit");
    revalidatePath("/fehlt");
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
      return { status: "success", message: "Keine neuen Rechnungen gefunden." };
    }
    return { status: "error", message: result.errorMessage ?? "Konnten nicht abrufen." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Fehler." };
  }
}

export type SyncCommunityState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function syncCommunityRecipesAction(
  _prev: SyncCommunityState,
  _formData: FormData,
): Promise<SyncCommunityState> {
  void _prev;
  void _formData;
  try {
    const result = await syncCommunityRecipes({ force: false });
    revalidatePath("/einstellungen");
    if (!result.ok) {
      return {
        status: "error",
        message: result.errors[0] ?? "Sync fehlgeschlagen.",
      };
    }
    const parts: string[] = [];
    if (result.installed > 0) parts.push(`${result.installed} neu installiert`);
    if (result.updated > 0) parts.push(`${result.updated} aktualisiert`);
    if (result.skipped > 0) parts.push(`${result.skipped} übersprungen`);
    const errorSuffix = result.errors.length > 0 ? ` (${result.errors.length} Fehler)` : "";
    return {
      status: "success",
      message: parts.length > 0 ? parts.join(", ") + "." + errorSuffix : "Keine neuen Recipes verfügbar.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unbekannter Fehler beim Sync.",
    };
  }
}

export async function removeOnlineAccountAction(formData: FormData): Promise<void> {
  const vendorKey = String(formData.get("vendorKey") || "").trim();
  if (!vendorKey) return;
  const db = getDb();
  db.prepare(`DELETE FROM credential_refs WHERE scope IN ('portal','totp') AND secret_ref LIKE ?`).run(`%:${vendorKey}:%`);
  db.prepare(`DELETE FROM portal_recipes WHERE vendor_key = ?`).run(vendorKey);
  db.prepare(`DELETE FROM portal_run_logs WHERE vendor_key = ?`).run(vendorKey);
  db.prepare(`UPDATE vendors SET portal_login_url = NULL, portal_category = NULL WHERE canonical_key = ?`).run(vendorKey);
  invalidateBrowserSession(vendorKey);
  resetPortalCredentialMeta(vendorKey);
  revalidatePath("/einstellungen");
}

async function importDownloads(
  downloads: Array<{ filePath: string; invoiceDate: string | null; originalFilename: string }>,
  vendorKey: string,
) {
  for (const download of downloads) {
    try {
      const buffer = await fs.readFile(download.filePath);
      await importPdfBuffer({
        buffer,
        originalFilename: download.originalFilename,
        sourceType: "portal",
        sourceRefId: vendorKey,
      });
    } catch {
      // Failures sind in portal_run_logs sichtbar
    }
  }
}

/**
 * generateCanonicalKey: deterministische, kollisionsfreie ID aus einem Namen.
 * Bei Kollision haengen wir -2, -3, ... an.
 */
function generateCanonicalKey(name: string): string {
  const base = slugify(name);
  const db = getDb();
  let candidate = base;
  let n = 2;
  while (db.prepare(`SELECT 1 FROM vendors WHERE canonical_key = ? LIMIT 1`).get(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
    if (n > 100) throw new Error("Zu viele Kollisionen bei der ID-Generierung.");
  }
  return candidate;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "lieferant";
}
