"use server";

import { revalidatePath } from "next/cache";
import { dispatchPendingExports } from "@/exports/export-pipeline";
import { requireCurrentAuth } from "@/lib/auth/current";

export type ExportDispatchState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function runExportDispatchAction(
  _previousState: ExportDispatchState,
): Promise<ExportDispatchState> {
  void _previousState;

  await requireCurrentAuth();

  try {
    const result = await dispatchPendingExports();

    revalidatePath("/exports");
    revalidatePath("/audit");
    revalidatePath("/");

    if (result.total === 0 && result.enqueued === 0) {
      return { status: "success", message: "Keine ausstehenden Rechnungen zum Senden." };
    }

    const parts: string[] = [];
    if (result.enqueued > 0) parts.push(`${result.enqueued} neu eingereiht`);
    if (result.sent > 0) parts.push(`${result.sent} erfolgreich gesendet`);
    if (result.failed > 0) parts.push(`${result.failed} fehlgeschlagen`);

    const status = result.failed > 0 && result.sent === 0 ? "error" : "success";
    return { status, message: parts.join(", ") + "." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler beim Senden.";
    return { status: "error", message: msg };
  }
}
