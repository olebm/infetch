import { appConfig } from "@/lib/config/env";
import { callMistralInvoiceExtractor } from "@/ai/mistral-client";
import { invoiceAiExtractionSchema, type InvoiceAiExtraction } from "@/ai/schemas";
import { recordUsageEvent, estimateMistralCostCents } from "@/lib/usage/track";

export type AiExtractRequest = {
  pdfText: string;
  originalFilename: string;
  localParsed?: {
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountGross: number | null;
    currency: string | null;
  } | null;
  localVendorKey?: string | null;
  organizationId?: string | null;
  model?: string;
};

export type AiExtractResult = {
  extraction: InvoiceAiExtraction;
  costCents: number;
};

/**
 * Ruft die AI-Extraktion. Routing:
 *   - Wenn `appConfig.aiProxy.url` gesetzt → HTTP-POST an externen Proxy
 *   - Sonst → In-Process-Call (gleicher Server, kein HTTP-Overhead)
 *
 * In beiden Fällen ist die API-Form identisch — Migration zu externem Proxy
 * ist ein env-Swap, keine Code-Änderung beim Caller.
 *
 * Vision: später kann der Proxy Mistral durch andere LLMs ersetzen, ohne dass
 * Caller das wissen.
 */
export async function callAiExtract(input: AiExtractRequest): Promise<AiExtractResult> {
  if (appConfig.aiProxy.url) {
    return callViaHttp(input);
  }
  return callInProcess(input);
}

async function callViaHttp(input: AiExtractRequest): Promise<AiExtractResult> {
  const url = `${appConfig.aiProxy.url}/api/ai/extract`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (appConfig.aiProxy.token) {
    headers["authorization"] = `Bearer ${appConfig.aiProxy.token}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AI-Proxy returned ${response.status}: ${text}`);
  }
  const json = (await response.json()) as { extraction: unknown; costCents: number };
  return {
    extraction: invoiceAiExtractionSchema.parse(json.extraction),
    costCents: json.costCents,
  };
}

async function callInProcess(input: AiExtractRequest): Promise<AiExtractResult> {
  const extraction = await callMistralInvoiceExtractor({
    model: input.model || appConfig.mistral.model,
    promptPayload: {
      pdfText: input.pdfText,
      originalFilename: input.originalFilename,
      localParsed: input.localParsed ?? null,
      localVendorKey: input.localVendorKey ?? null,
    },
  });

  const estimatedTokens = Math.ceil(input.pdfText.length / 4);
  const costCents = estimateMistralCostCents({
    promptTokens: estimatedTokens,
    completionTokens: 200,
  });

  recordUsageEvent({
    organizationId: input.organizationId ?? null,
    eventType: "ai_extraction",
    costCents,
    metadata: {
      model: input.model || appConfig.mistral.model,
      originalFilename: input.originalFilename,
      promptTokensEstimate: estimatedTokens,
      route: "in_process",
    },
  });

  return { extraction, costCents };
}
