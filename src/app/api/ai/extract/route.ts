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

function isAuthorized(request: NextRequest): { ok: boolean; reason?: string } {
  const requiredToken = appConfig.aiProxy.token;
  if (!requiredToken) {
    // SECURITY: In Production ohne Token NICHT erlauben — sonst kann jeder
    // im Internet Mistral-Calls auf Kosten des Betreibers auslösen.
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "ai_proxy_misconfigured" };
    }
    // Dev: explizit erlauben
    return { ok: true };
  }
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false };
  // Konstante-Zeit-Vergleich gegen Timing-Angriffe
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(requiredToken);
  if (provided.length !== expected.length) return { ok: false };
  // Buffer.compare ist nicht constant-time → eigene Variante
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided[i] ^ expected[i];
  return { ok: diff === 0 };
}

export async function POST(request: NextRequest) {
  const authz = isAuthorized(request);
  if (!authz.ok) {
    const status = authz.reason === "ai_proxy_misconfigured" ? 503 : 401;
    return NextResponse.json({ error: authz.reason ?? "unauthorized" }, { status });
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
