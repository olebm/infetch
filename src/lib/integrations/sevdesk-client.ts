/**
 * sevDesk Public API Client.
 *
 * Auth: API-Key im Authorization-Header (KEIN Bearer-Prefix).
 * User generiert API-Key in sevDesk unter "Mein Profil → API-Token".
 *
 * Endpoints: https://my.sevdesk.de/api/v1/
 * Doku: https://api.sevdesk.de/
 */

import fs from "node:fs/promises";

const SEVDESK_BASE_URL = "https://my.sevdesk.de/api/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

export type SevdeskUserInfo = {
  id: string;
  fullname: string;
  email: string;
  sevClient?: { id: string; name: string };
};

export type SevdeskTempFileResponse = {
  filename: string;
  fullFilenameWithPath: string;
  mimeType: string;
};

export type SevdeskVoucherResponse = {
  id: string;
  objectName: string;
  createDate: string;
};

class SevdeskApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "SevdeskApiError";
  }
}

async function sevdeskFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(`${SEVDESK_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifySevdeskConnection(apiKey: string): Promise<SevdeskUserInfo> {
  const response = await sevdeskFetch(apiKey, "/SevUser");
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new SevdeskApiError(
        response.status,
        "sevDesk-API-Key ist ungültig oder hat keine Berechtigung.",
        body,
      );
    }
    throw new SevdeskApiError(
      response.status,
      `sevDesk-API antwortet mit ${response.status}.`,
      body,
    );
  }
  const data = (await response.json()) as { objects: SevdeskUserInfo[] };
  if (!data.objects?.length) {
    throw new SevdeskApiError(200, "sevDesk-API lieferte keine User-Info zurück.");
  }
  return data.objects[0];
}

/**
 * Datei in sevDesk-Temp-Storage hochladen.
 * Liefert filename + path, die für POST /Voucher als document benötigt werden.
 */
export async function uploadSevdeskTempFile(
  apiKey: string,
  pdfPath: string,
  filename: string,
): Promise<SevdeskTempFileResponse> {
  const pdfBuffer = await fs.readFile(pdfPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), filename);

  const response = await sevdeskFetch(apiKey, "/Voucher/Factory/uploadTempFile", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new SevdeskApiError(
      response.status,
      `sevDesk-File-Upload fehlgeschlagen (${response.status}).`,
      body,
    );
  }
  const data = (await response.json()) as { objects: SevdeskTempFileResponse };
  return data.objects;
}

/**
 * Minimal-Voucher in sevDesk anlegen mit Verweis auf zuvor hochgeladene Temp-Datei.
 * status=50 (Belegerfassung), creditDebit=C (Eingang). Pflichtfelder sind sehr basal —
 * User vervollständigt in sevDesk-App. Für volle Auto-Buchung müssten taxRate +
 * accountingType-ID vorab konfiguriert werden.
 */
export async function createSevdeskVoucherFromTempFile(
  apiKey: string,
  tempFile: SevdeskTempFileResponse,
  meta: { voucherDate: string | null; description?: string },
): Promise<SevdeskVoucherResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    voucher: {
      objectName: "Voucher",
      mapAll: "true",
      voucherDate: meta.voucherDate ?? today,
      status: 50,
      creditDebit: "C",
      voucherType: "VOU",
      taxType: "default",
      description: meta.description ?? "Auto-Import via Infetch",
    },
    filename: tempFile.filename,
    voucherPosSave: null,
    voucherPosDelete: null,
  };

  const response = await sevdeskFetch(apiKey, "/Voucher/Factory/saveVoucher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new SevdeskApiError(
      response.status,
      `sevDesk-Voucher-Erstellung fehlgeschlagen (${response.status}).`,
      body,
    );
  }
  const data = (await response.json()) as { objects: { voucher: SevdeskVoucherResponse } };
  return data.objects.voucher;
}

export { SevdeskApiError };
