"use server";

import { revalidatePath } from "next/cache";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { saveCredentialSecret, deleteCredentialSecret } from "@/lib/secrets/credential-store";
import { savePortalCredentialMeta, resetPortalCredentialMeta } from "@/portals/credential-meta";
import { invalidateBrowserSession } from "@/portals/agent/session-store";
import { findVendorByCanonicalKey, upsertVendor } from "@/lib/db/queries";
import { syncCommunityRecipes } from "@/portals/agent/community-sync";
import { canAddOnlineAccount, getLimits, type Tier } from "@/lib/tier";
import { isUsableTotpSecret } from "@/portals/totp";
import { requireCurrentAuth } from "@/lib/auth/current";

export type ConnectState = {
  status: "idle" | "success" | "error";
  message: string;
  vendorKey?: string;
  invoicesFound?: number;
};

/**
 * Tier-bewusste Meldung, wenn kein weiteres Online-Konto erlaubt ist.
 * Free (max 0) → Pro-Upgrade-Hinweis; bezahlte Tiers am Limit → entfernen/höher.
 */
function onlineAccountLimitMessage(limit: { current: number; max: number; tier: Tier }): string {
  if (limit.max === 0) {
    const pro = getLimits("pro");
    return `Portal-Scan ist ein Pro-Feature. Mit Pro verbindest du bis zu ${pro.maxOnlineAccounts} Online-Konten (${pro.priceMonthlyEur} €/Monat).`;
  }
  const businessHint =
    limit.tier === "pro"
      ? ` Mit Business sind bis zu ${getLimits("business").maxOnlineAccounts} möglich.`
      : "";
  return `Limit erreicht: ${limit.current} von ${limit.max} Online-Konten verbunden.${businessHint} Entferne ein Konto, um ein neues zu verbinden.`;
}

export async function connectOnlineAccountAction(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  void _prev;
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (!orgId) return { status: "error", message: "Keine Organisation zugeordnet." };
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
      // Base32-Charset UND otplib-Verwendbarkeit prüfen. Ein 16-stelliges Secret
      // (10 Byte) bestand früher die reine Zeichen-Regex, crashte aber im Lauf,
      // weil otplib ≥ 16 Byte verlangt (INFETCH-260). isUsableTotpSecret testet
      // gegen otplibs echte Regeln statt einer Längen-Heuristik.
      if (!/^[A-Z2-7]+$/.test(cleaned) || !(await isUsableTotpSecret(cleaned))) {
        return {
          status: "error",
          message:
            "Der TOTP-Schlüssel ist ungültig oder zu kurz. Die meisten Portale nutzen einen 32-stelligen Base32-Schlüssel (A–Z, 2–7).",
        };
      }
    }

    const limit = await canAddOnlineAccount(orgId);
    if (!limit.allowed) {
      return { status: "error", message: onlineAccountLimitMessage(limit) };
    }

    let vendorName: string;
    let canonicalKey: string;

    if (mode === "existing") {
      const existingKey = String(formData.get("vendorKey") || "").trim();
      const vendor = await findVendorByCanonicalKey(existingKey, orgId);
      if (!vendor) {
        return { status: "error", message: "Lieferant nicht gefunden." };
      }
      vendorName = vendor.name;
      // Globale Built-ins (organization_id NULL) werden nicht mit der Portal-Konfig
      // dieser Org überschrieben — wir legen eine org-eigene Kopie mit frischem,
      // global eindeutigem Key an. Eigene Org-Vendoren werden direkt wiederverwendet.
      canonicalKey =
        vendor.organizationId === null
          ? await generateCanonicalKey(vendor.name)
          : vendor.canonicalKey;
    } else if (mode === "new") {
      const newName = String(formData.get("vendorName") || "").trim();
      if (newName.length < 2) {
        return { status: "error", message: "Bitte einen Namen für den Lieferanten eingeben." };
      }
      vendorName = newName;
      canonicalKey = await generateCanonicalKey(newName);
    } else {
      return { status: "error", message: "Ungültiger Modus." };
    }

    // Vendor anlegen oder aktualisieren mit URL + Kategorie — strikt org-scoped.
    const vendor = await upsertVendor({
      name: vendorName,
      canonicalKey,
      organizationId: orgId,
      portalLoginUrl: loginUrl,
      portalCategory: category,
    });

    // Credentials sicher speichern
    await saveCredentialSecret({
      scope: "portal",
      ownerId: vendor.canonicalKey,
      organizationId: orgId,
      label: `${vendor.name} Online-Konto`,
      secret: password,
    });
    await savePortalCredentialMeta({
      vendorKey: vendor.canonicalKey,
      username,
      organizationId: orgId,
    });

    // Optionaler TOTP-Schlüssel
    if (totpSecret) {
      const cleaned = totpSecret.replace(/\s+/g, "").toUpperCase();
      await saveCredentialSecret({
        scope: "totp",
        ownerId: vendor.canonicalKey,
        organizationId: orgId,
        label: `${vendor.name} TOTP-Schlüssel`,
        secret: cleaned,
      });
    }

    // Kein synchroner Erstabruf im Web-Request (INFETCH-264): der Agent — und
    // damit die Credential-Entschlüsselung — läuft ausschließlich im isolierten
    // Worker. Der portalFetch-Cron holt das neu verbundene Konto beim nächsten
    // Lauf. So braucht der Web-Prozess keine Decrypt-Rechte auf die Zugangsdaten.
    revalidatePath("/einstellungen");
    revalidatePath("/");

    return {
      status: "success",
      message: `${vendor.name} verbunden. Die Rechnungen werden automatisch abgeholt.`,
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
  await requireCurrentAuth();
  try {
    const vendorKey = String(formData.get("vendorKey") || "").trim();
    if (!vendorKey) return { status: "error", message: "Kein Lieferant angegeben." };

    // Kein Agent-Lauf im Web-Request (INFETCH-264): der Abruf läuft ausschließlich
    // im isolierten Worker. Das Konto wird beim nächsten portalFetch-Lauf geholt.
    revalidatePath("/einstellungen");
    return { status: "success", message: "Wird beim nächsten automatischen Lauf geholt." };
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
  await requireCurrentAuth();
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
      message:
        parts.length > 0 ? parts.join(", ") + "." + errorSuffix : "Keine neuen Recipes verfügbar.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unbekannter Fehler beim Sync.",
    };
  }
}

export async function removeOnlineAccountAction(formData: FormData): Promise<void> {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (!orgId) throw new Error("Keine Organisation zugeordnet.");
  const vendorKey = String(formData.get("vendorKey") || "").trim();
  if (!vendorKey) return;
  // Portal- + TOTP-Secret org-scoped vollständig entfernen (Store-Eintrag UND
  // credential_refs). owner_id = vendorKey ist Klartext; der secret_ref ist
  // gehasht, daher kein LIKE. deleteCredentialSecret räumt auch den Vault-Eintrag.
  await deleteCredentialSecret({ scope: "portal", ownerId: vendorKey, organizationId: orgId });
  await deleteCredentialSecret({ scope: "totp", ownerId: vendorKey, organizationId: orgId });
  // portal_recipes und portal_run_logs sind aktuell global (kein organization_id).
  // Cross-Tenant-Sicherheit: NICHT pauschal löschen — sonst können andere Orgs,
  // die denselben vendor_key nutzen, zerstört werden. Recipes/Logs bleiben stehen;
  // sie werden ohne Credentials nicht mehr verwendet. Org-Scoping der Tabellen ist
  // Aufgabe der Wrapper-Migration (Stream D).
  // vendors: nur die org-eigene Vendor-Zeile zurücksetzen — globale Built-ins (NULL)
  // dürfen nicht angefasst werden.
  await sql`
    UPDATE vendors SET portal_login_url = NULL, portal_category = NULL
    WHERE canonical_key = ${vendorKey} AND organization_id = ${orgId}
  `;
  await invalidateBrowserSession(vendorKey);
  await resetPortalCredentialMeta(vendorKey, orgId);
  revalidatePath("/einstellungen");
}

/**
 * generateCanonicalKey: deterministische, kollisionsfreie ID aus einem Namen.
 * Bei Kollision haengen wir -2, -3, ... an.
 */
async function generateCanonicalKey(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  while (true) {
    const rows = await sql`SELECT 1 FROM vendors WHERE canonical_key = ${candidate} LIMIT 1`;
    if (!rows[0]) break;
    candidate = `${base}-${n}`;
    n += 1;
    if (n > 100) throw new Error("Zu viele Kollisionen bei der ID-Generierung.");
  }
  return candidate;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "lieferant"
  );
}
