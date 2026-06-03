/**
 * lexoffice Public API Client.
 *
 * Auth: Bearer-Token (API-Key vom User generiert unter
 * https://app.lexoffice.de/addons/public-api — erfordert XL-Plan).
 *
 * Endpoints: https://api.lexoffice.io/v1/
 * Doku: https://developers.lexoffice.io/
 */

import { withRetry, isRetryableHttpStatus, TransientHttpError } from "@/lib/retry";

const LEXOFFICE_BASE_URL = "https://api.lexoffice.io/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

export type LexofficeProfile = {
  organizationId: string;
  companyName: string;
  created: { userName: string; userEmail: string };
};

export type LexofficeVoucherInput = {
  voucherType: "salesinvoice" | "salescreditnote" | "purchaseinvoice" | "purchasecreditnote";
  voucherStatus: "open" | "paid";
  voucherNumber?: string;
  voucherDate: string; // ISO date YYYY-MM-DD
  shippingDate?: string;
  dueDate?: string;
  totalGrossAmount: number;
  totalTaxAmount: number;
  taxType: "net" | "gross";
  useCollectiveContact?: boolean;
  contactId?: string;
  remark?: string;
  voucherItems: Array<{
    amount: number;
    taxAmount: number;
    taxRatePercent: number;
    categoryId: string;
  }>;
};

export type LexofficeVoucherResponse = {
  id: string;
  resourceUri: string;
  createdDate: string;
  updatedDate: string;
  version: number;
};

class LexofficeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "LexofficeApiError";
  }
}

async function lexofficeFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let lastResponse: Response | null = null;
  try {
    return await withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(`${LEXOFFICE_BASE_URL}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            ...init.headers,
          },
        });
        lastResponse = response;
        // 429/5xx → Retry (lexoffice: 2 req/s Rate-Limit). Andere Status
        // (inkl. 4xx) gehen unverändert an den Aufrufer zurück.
        if (isRetryableHttpStatus(response.status)) {
          throw new TransientHttpError(response.status);
        }
        return response;
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (err) {
    // Retries erschöpft bei retrybarem Status → letzte Response zurückgeben,
    // damit die bestehende Status-Fehlerbehandlung des Aufrufers greift.
    if (err instanceof TransientHttpError && lastResponse) return lastResponse;
    throw err;
  }
}

export async function verifyLexofficeConnection(apiKey: string): Promise<LexofficeProfile> {
  const response = await lexofficeFetch(apiKey, "/profile");
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new LexofficeApiError(
        response.status,
        "lexoffice-API-Key ist ungültig oder hat keine Berechtigung. Erfordert XL-Plan.",
        body,
      );
    }
    throw new LexofficeApiError(
      response.status,
      `lexoffice-API antwortet mit ${response.status}.`,
      body,
    );
  }
  return (await response.json()) as LexofficeProfile;
}

export async function createLexofficeVoucher(
  apiKey: string,
  voucher: LexofficeVoucherInput,
): Promise<LexofficeVoucherResponse> {
  const response = await lexofficeFetch(apiKey, "/vouchers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(voucher),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new LexofficeApiError(
      response.status,
      `lexoffice-Voucher-Erstellung fehlgeschlagen (${response.status}).`,
      body,
    );
  }
  return (await response.json()) as LexofficeVoucherResponse;
}

export async function attachLexofficeVoucherFile(
  apiKey: string,
  voucherId: string,
  pdfContent: Buffer,
  filename: string,
): Promise<void> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(pdfContent)], { type: "application/pdf" }),
    filename,
  );
  form.append("type", "voucher");

  const response = await lexofficeFetch(apiKey, `/vouchers/${voucherId}/files`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new LexofficeApiError(
      response.status,
      `lexoffice-File-Upload fehlgeschlagen (${response.status}).`,
      body,
    );
  }
}

/**
 * PDF in den lexoffice-Posteingang (Beleg-Vorschlag) hochladen.
 * User kategorisiert/bucht es dort selbst — kein voucher-create mit categoryId nötig.
 * Endpoint: POST /v1/files mit type=voucher
 */
export async function uploadLexofficeFileToInbox(
  apiKey: string,
  pdfContent: Buffer,
  filename: string,
): Promise<{ id: string }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(pdfContent)], { type: "application/pdf" }),
    filename,
  );
  form.append("type", "voucher");

  const response = await lexofficeFetch(apiKey, "/files", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new LexofficeApiError(
      response.status,
      `lexoffice-Posteingang-Upload fehlgeschlagen (${response.status}).`,
      body,
    );
  }
  return (await response.json()) as { id: string };
}

export { LexofficeApiError };
