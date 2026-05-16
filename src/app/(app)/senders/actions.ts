"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db/client";
import {
  autoAssignSenders,
  backfillFromMailMessages,
  blockSender,
  linkSenderToVendor,
  unblockSender,
} from "@/senders/discovered-senders";
import { rematchUnmatchedInvoices } from "@/vendors/auto-alias";
import { matchVendor } from "@/vendors/matcher";
import { requireCurrentAuth } from "@/lib/auth/current";

export type SenderActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function parseSenderId(formData: FormData): number {
  const raw = formData.get("senderId");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Ungültige Sender-ID.");
  }
  return id;
}

async function getSenderRow(id: number) {
  const rows = await sql<Array<{
    id: number;
    fromAddress: string;
    fromDomain: string;
    displayName: string | null;
    matchedVendorId: number | null;
  }>>`
    SELECT id, from_address AS "fromAddress", from_domain AS "fromDomain",
      display_name AS "displayName", matched_vendor_id AS "matchedVendorId"
    FROM discovered_senders WHERE id = ${id}
  `;
  return rows[0];
}

function refreshSenderViews() {
  revalidatePath("/einstellungen");
  revalidatePath("/");
}

export async function blockSenderAction(
  _previousState: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const senderId = parseSenderId(formData);
    const reason = String(formData.get("reason") || "").trim() || null;
    const sender = await getSenderRow(senderId);
    if (!sender) return { status: "error", message: "Sender nicht gefunden." };
    await blockSender(senderId, reason);
    refreshSenderViews();
    return {
      status: "success",
      message: `${sender.fromAddress} blockiert. Neue Mails dieses Senders werden übersprungen.`,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Block fehlgeschlagen." };
  }
}

export async function unblockSenderAction(
  _previousState: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const senderId = parseSenderId(formData);
    const sender = await getSenderRow(senderId);
    if (!sender) return { status: "error", message: "Sender nicht gefunden." };
    await unblockSender(senderId);
    refreshSenderViews();
    return { status: "success", message: `${sender.fromAddress} ist wieder freigegeben.` };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unblock fehlgeschlagen.",
    };
  }
}

export async function linkSenderToVendorAction(
  _previousState: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const senderId = parseSenderId(formData);
    const rawVendor = String(formData.get("vendorId") || "").trim();
    const vendorId = rawVendor ? Number(rawVendor) : null;
    if (vendorId !== null && (!Number.isInteger(vendorId) || vendorId <= 0)) {
      return { status: "error", message: "Ungültige Vendor-ID." };
    }
    const sender = await getSenderRow(senderId);
    if (!sender) return { status: "error", message: "Sender nicht gefunden." };
    await linkSenderToVendor(senderId, vendorId);
    refreshSenderViews();
    return {
      status: "success",
      message: vendorId
        ? `${sender.fromAddress} ist mit Vendor verknüpft.`
        : `Vendor-Verknüpfung für ${sender.fromAddress} entfernt.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Verknüpfung fehlgeschlagen.",
    };
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createVendorFromSenderAction(
  _previousState: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const senderId = parseSenderId(formData);
    const sender = await getSenderRow(senderId);
    if (!sender) return { status: "error", message: "Sender nicht gefunden." };

    const name = (String(formData.get("vendorName") || "").trim() || sender.displayName || sender.fromDomain).trim();
    if (!name) return { status: "error", message: "Bitte einen Vendor-Namen angeben." };

    const category = String(formData.get("category") || "service").trim() || "service";
    const baseKey = slugify(name) || slugify(sender.fromDomain) || `vendor-${senderId}`;

    const existingRows = await sql<{ id: number }[]>`
      SELECT id FROM vendors WHERE canonical_key = ${baseKey}
    `;
    const existingVendor = existingRows[0];

    let vendorId: number;
    if (existingVendor) {
      vendorId = existingVendor.id;
    } else {
      const insertRows = await sql<{ id: number }[]>`
        INSERT INTO vendors (name, canonical_key, category, portal_enabled, mail_enabled, manual_enabled)
        VALUES (${name}, ${baseKey}, ${category}, FALSE, TRUE, TRUE)
        RETURNING id
      `;
      vendorId = Number(insertRows[0].id);
    }

    const domain = sender.fromDomain;
    if (domain) {
      await sql`
        INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
        VALUES (${vendorId}, ${domain}, 'domain', 50)
        ON CONFLICT DO NOTHING
      `;
    }
    await sql`
      INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
      VALUES (${vendorId}, ${sender.fromAddress}, 'exact', 30)
      ON CONFLICT DO NOTHING
    `;

    await linkSenderToVendor(senderId, vendorId);
    refreshSenderViews();

    return {
      status: "success",
      message: existingVendor
        ? `${sender.fromAddress} mit bestehendem Vendor "${name}" verknüpft.`
        : `Vendor "${name}" angelegt und mit ${sender.fromAddress} verknüpft.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Vendor anlegen fehlgeschlagen.",
    };
  }
}

export async function autoAssignSendersAction(
  _previousState: SenderActionState,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const result = await autoAssignSenders();
    refreshSenderViews();
    revalidatePath("/fehlt");
    const parts: string[] = [];
    if (result.matched > 0) parts.push(`${result.matched} Sender zugeordnet`);
    if (result.created > 0) parts.push(`${result.created} Vendor neu angelegt`);
    if (result.skipped > 0) parts.push(`${result.skipped} ohne PDFs übersprungen`);
    const summary = parts.length > 0 ? parts.join(", ") : "Nichts zu tun";
    return {
      status: "success",
      message: `Auto-Zuordnung abgeschlossen (${result.scanned} geprüft): ${summary}.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Auto-Zuordnung fehlgeschlagen.",
    };
  }
}

export async function backfillSendersAction(
  _previousState: SenderActionState,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const result = await backfillFromMailMessages();
    refreshSenderViews();
    return {
      status: "success",
      message: `Backfill abgeschlossen: ${result.upserts} Sender übernommen, ${result.withPdfs} mit PDFs.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Backfill fehlgeschlagen.",
    };
  }
}

export async function rematchInvoicesAction(
  _previousState: SenderActionState,
): Promise<SenderActionState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const result = await rematchUnmatchedInvoices(matchVendor);
    refreshSenderViews();
    revalidatePath("/audit");
    if (result.scanned === 0) {
      return { status: "success", message: "Keine ungezuordneten Rechnungen — alles sauber." };
    }
    return {
      status: "success",
      message: `Re-Match abgeschlossen: ${result.matched} Rechnungen neu zugeordnet (von ${result.scanned} geprüft, ${result.unchanged} blieben offen).`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Re-Match fehlgeschlagen.",
    };
  }
}
