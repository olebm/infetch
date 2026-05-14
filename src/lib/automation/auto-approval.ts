import { getAutoApprovalRulesForVendor } from "@/lib/db/queries";
import type { InvoiceAiExtraction } from "@/ai/schemas";
import { appConfig } from "@/lib/config/env";

const PER_FIELD_RULE_THRESHOLD = 0.95;

export type AutoApprovalDecision =
  | { autoApproved: true; ruleId: number | null; via: "high_confidence" | "rule" }
  | { autoApproved: false; reason: string };

export type AutoApprovalInput = {
  vendorId: number | null;
  vendorName: string | null;
  amountGross: number | null;
  invoiceDate: string | null;
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

  const confidences = [
    extraction.amount_confidence,
    extraction.date_confidence,
    extraction.vendor_confidence,
  ];

  // Fallback: aktuelle Mistral-Pipeline liefert nur top-level `confidence`,
  // keine per-Field-Werte mehr. Wenn Top-Level über Threshold UND alle
  // Kernfelder gefüllt → vertrauen wir der Gesamteinschätzung.
  if (confidences.some((c) => c === null)) {
    if (extraction.confidence !== null && extraction.confidence >= overallThreshold) {
      return { autoApproved: true, ruleId: null, via: "high_confidence" };
    }
    return { autoApproved: false, reason: "missing per-field confidence" };
  }
  const minConfidence = Math.min(...(confidences as number[]));

  // Path 1: High overall confidence — bypass rule requirement (Auto-Pilot path).
  if (minConfidence >= overallThreshold) {
    return { autoApproved: true, ruleId: null, via: "high_confidence" };
  }

  // Path 2: Per-vendor rule with amount cap (explicit user opt-in).
  if (minConfidence < PER_FIELD_RULE_THRESHOLD) {
    return { autoApproved: false, reason: "per-field confidence below threshold" };
  }
  const rules = await getAutoApprovalRulesForVendor(resolved.vendorId, resolved.vendorName);
  if (rules.length === 0) {
    return { autoApproved: false, reason: "no matching rule" };
  }
  const amountCents = Math.round(resolved.amountGross * 100);
  for (const rule of rules) {
    if (rule.maxAmountCents !== null && amountCents > rule.maxAmountCents) continue;
    return { autoApproved: true, ruleId: rule.id, via: "rule" };
  }
  return { autoApproved: false, reason: "amount exceeds rule limits" };
}
