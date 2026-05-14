import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config/env";
import { callMistralInvoiceExtractor } from "@/ai/mistral-client";
import { invoiceAiExtractionSchema } from "@/ai/schemas";
import { recordUsageEvent, estimateMistralCostCents } from "@/lib/usage/track";

const requestSchema = z.object({
  pdfText: z.string().min(1).max(200_000),
  originalFilename: z.string().min(1).max(500),
  localParsed: z
    .object({
      invoiceNumber: z.string().nullable().optional(),
      invoiceDate: z.string().nullable().optional(),
      amountGross: z.number().nullable().optional(),
      currency: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
  localVendorKey: z.string().nullable().optional(),
  model: z.string().optional(),
  organizationId: z.string().uuid().optional(),
});

function isAuthorized(request: NextRequest): boolean {
  const requiredToken = appConfig.aiProxy.token;
  if (!requiredToken) {
    // Dev-Modus: kein Token konfiguriert → kein Auth-Check
    return true;
  }
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === requiredToken;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    const raw = await request.json();
    body = requestSchema.parse(raw);
  } catch (error) {
    return NextResponse.json(
      { error: "bad_request", message: error instanceof Error ? error.message : "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const extraction = await callMistralInvoiceExtractor({
      model: body.model || appConfig.mistral.model,
      promptPayload: {
        pdfText: body.pdfText,
        originalFilename: body.originalFilename,
        localParsed: body.localParsed ?? null,
        localVendorKey: body.localVendorKey ?? null,
      },
    });

    // Usage-Tracking: pauschale Schätzung (Token-Counts sind aktuell nicht im SDK-Return).
    // Phase 3+: exakte Token-Counts aus Mistral-Response extrahieren.
    const estimatedTokens = Math.ceil(body.pdfText.length / 4); // ~4 chars/token
    const costCents = estimateMistralCostCents({
      promptTokens: estimatedTokens,
      completionTokens: 200,
    });

    recordUsageEvent({
      organizationId: body.organizationId ?? null,
      eventType: "ai_extraction",
      costCents,
      metadata: {
        model: body.model || appConfig.mistral.model,
        originalFilename: body.originalFilename,
        promptTokensEstimate: estimatedTokens,
      },
    });

    return NextResponse.json({
      ok: true,
      extraction: invoiceAiExtractionSchema.parse(extraction),
      costCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mistral call failed";
    return NextResponse.json({ error: "extraction_failed", message }, { status: 502 });
  }
}
