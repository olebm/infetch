import { getAutoApprovalRulesForVendor } from "@/lib/db/queries";
import type { InvoiceAiExtraction } from "@/ai/schemas";
import { appConfig } from "@/lib/config/env";

const PER_FIELD_RULE_THRESHOLD = 0.95;

/**
 * Rein & CI-testbar (INFETCH-272): Darf der High-Confidence-Pfad greifen? Nur
 * unter dem Betrags-Cap UND für einen bekannten Anbieter. Beides zusammen
 * schließt den Prompt-Injection-Geldpfad: ein injiziertes PDF kann zwar
 * Confidence/Betrag im Modell-Output steuern, aber weder den Cap aushebeln noch
 * sich Org-Historie erfinden.
 */
export function highConfidenceAllowed(
  amountCents: number,
  maxAmountCents: number,
  vendorKnown: boolean,
): boolean {
  return vendorKnown && amountCents <= maxAmountCents;
}

export type AutoApprovalDecision =
  | { autoApproved: true; ruleId: number | null; via: "high_confidence" | "rule" }
  | { autoApproved: false; reason: string };

export type AutoApprovalInput = {
  organizationId: string | null;
  vendorId: number | null;
  vendorName: string | null;
  amountGross: number | null;
  invoiceDate: string | null;
  /** Bekannter Anbieter? (≥1 zuvor verarbeitete Rechnung in dieser Org — INFETCH-272.) */
  vendorKnown: boolean;
};

export async function evaluateAutoApproval(
  extraction: InvoiceAiExtraction,
  resolved: AutoApprovalInput,
): Promise<AutoApprovalDecision> {
  if (!resolved.vendorId || !resolved.invoiceDate || resolved.amountGross === null) {
    return { autoApproved: false, reason: "missing core fields" };
  }
  if (extraction.needs_review) {
    return { autoApproved: false, reason: "mistral flagged needs_review" };
  }
  const overallThreshold = appConfig.features.autoApprovalConfidenceThreshold;

  // SECURITY (INFETCH-272): Der High-Confidence-Pfad vertraut der modell-
  // selbstberichteten Confidence, die aus dem (untrusted) PDF-Inhalt stammt.
  // Damit eine prompt-injizierte Rechnung sich nicht selbst freigibt, greift er
  // nur unter dem Betrags-Cap UND für einen bekannten Anbieter (Org-Historie).
  // Außerhalb → durchfallen zum expliziten Per-Vendor-Rule-Pfad (kunden-Cap)
  // bzw. manuelles Review.
  const amountCents = Math.round(resolved.amountGross * 100);
  const highConfOk = highConfidenceAllowed(
    amountCents,
    appConfig.features.autoApprovalMaxAmountCents,
    resolved.vendorKnown,
  );

  const confidences = [
    extraction.amount_confidence,
    extraction.date_confidence,
    extraction.vendor_confidence,
  ];

  // Fallback: aktuelle Mistral-Pipeline liefert nur top-level `confidence`,
  // keine per-Field-Werte mehr. Wenn Top-Level über Threshold UND alle
  // Kernfelder gefüllt → vertrauen wir der Gesamteinschätzung (im Cap/known-Gate).
  if (confidences.some((c) => c === null)) {
    if (highConfOk && extraction.confidence !== null && extraction.confidence >= overallThreshold) {
      return { autoApproved: true, ruleId: null, via: "high_confidence" };
    }
    return { autoApproved: false, reason: "missing per-field confidence" };
  }
  const minConfidence = Math.min(...(confidences as number[]));

  // Path 1: High overall confidence — nur unter Cap + bekannter Vendor.
  if (minConfidence >= overallThreshold && highConfOk) {
    return { autoApproved: true, ruleId: null, via: "high_confidence" };
  }

  // Path 2: Per-vendor rule with amount cap (explicit user opt-in).
  if (minConfidence < PER_FIELD_RULE_THRESHOLD) {
    return { autoApproved: false, reason: "per-field confidence below threshold" };
  }
  const rules = await getAutoApprovalRulesForVendor(
    resolved.vendorId,
    resolved.vendorName,
    resolved.organizationId,
  );
  if (rules.length === 0) {
    return { autoApproved: false, reason: "no matching rule" };
  }
  for (const rule of rules) {
    if (rule.maxAmountCents !== null && amountCents > rule.maxAmountCents) continue;
    return { autoApproved: true, ruleId: rule.id, via: "rule" };
  }
  return { autoApproved: false, reason: "amount exceeds rule limits" };
}
