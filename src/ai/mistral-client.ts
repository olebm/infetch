import { Mistral } from "@mistralai/mistralai";
import { appConfig } from "@/lib/config/env";
import { withRetry } from "@/lib/retry";
import {
  readCredentialSecret,
  updateCredentialVerificationStatus,
} from "@/lib/secrets/credential-store";
import {
  invoiceAiExtractionJsonSchema,
  invoiceAiExtractionSchema,
  type InvoiceAiExtraction,
} from "@/ai/schemas";

export type MistralInvoiceExtractionRequest = {
  model: string;
  promptPayload: Record<string, unknown>;
};

/**
 * Resolve the Mistral API key from (in order):
 *   1. DB credential_refs (Legacy/Self-Host BYOK)
 *   2. Environment variable `MISTRAL_API_KEY` (Self-Host with .env.local)
 *
 * Vision target: KI-Erkennung wird vom Anbieter (uns) via Backend-Proxy bereitgestellt
 * (siehe INTAKE-55). Bis dahin bleibt der direkte Client-Call mit env-Fallback aktiv.
 */
async function resolveMistralApiKey(): Promise<string | null> {
  const stored = await readCredentialSecret({ scope: "mistral" });
  if (stored) return stored;
  const envKey = process.env.MISTRAL_API_KEY?.trim();
  return envKey || null;
}

export async function callMistralInvoiceExtractor(
  request: MistralInvoiceExtractionRequest,
): Promise<InvoiceAiExtraction> {
  const apiKey = await resolveMistralApiKey();
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not configured");
  }

  const client = new Mistral({ apiKey, timeoutMs: 30_000 });
  const response = await withRetry(() =>
    client.chat.complete(
      {
        model: request.model || appConfig.mistral.model,
        temperature: 0,
        maxTokens: 900,
        responseFormat: {
          type: "json_schema",
          jsonSchema: {
            name: "invoice_extraction",
            strict: true,
            schemaDefinition: invoiceAiExtractionJsonSchema,
          },
        },
        messages: [
          {
            role: "system",
            content: [
              "Extract invoice data from the provided PDF text and metadata.",
              "Return JSON only, matching the response schema exactly.",
              "Use null for missing fields. Do not invent invoice numbers, amounts, dates, vendors, or countries.",
              "invoice_date is the issue/document date of the invoice — NOT the due date, payment-due date, or reminder date. If only a due/reminder date is present, set invoice_date null.",
              "amount_gross is the final total payable. Never guess: if the amount is ambiguous, looks like concatenated digits, or is implausibly large for a single invoice, set amount_gross null and amount_confidence 0 rather than emitting a wrong number.",
              "Classify non-invoices as document_type other and set needs_review true.",
              "For amount_confidence, date_confidence, vendor_confidence, vat_rate_confidence, doc_type_confidence return a per-field score 0..1 reflecting how certain you are about amount_gross, invoice_date, vendor, vat_rate, document_type respectively.",
              "Use null for a confidence score when the field itself is null. Be conservative: only score >=0.95 when the value is unambiguous in the source.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(request.promptPayload),
          },
        ],
      },
      { timeoutMs: 30_000 },
    ),
  );

  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") {
    throw new Error("Mistral response did not contain JSON text");
  }

  return invoiceAiExtractionSchema.parse(JSON.parse(content));
}

export async function verifyMistralConnection() {
  const apiKey = await resolveMistralApiKey();
  if (!apiKey) {
    throw new Error("Mistral API Key ist nicht konfiguriert.");
  }

  try {
    const client = new Mistral({ apiKey, timeoutMs: 15_000 });
    const response = await client.models.list();
    const firstModel = response.data?.[0]?.id || appConfig.mistral.model;

    await updateCredentialVerificationStatus({
      scope: "mistral",
      ownerId: "default",
      status: "configured",
    });

    return {
      model: firstModel,
      count: response.data?.length || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mistral-Verbindung fehlgeschlagen.";
    if (looksLikeMistralCredentialError(message)) {
      await updateCredentialVerificationStatus({
        scope: "mistral",
        ownerId: "default",
        status: "invalid",
      });
    }
    throw new Error(normalizeMistralVerificationError(message));
  }
}

function looksLikeMistralCredentialError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("api key")
  );
}

function normalizeMistralVerificationError(message: string) {
  if (message.includes("nicht konfiguriert")) return message;
  return `Mistral-Test fehlgeschlagen: ${message}`;
}
