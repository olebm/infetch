import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-Memory-Bucket statt echtem Supabase Storage.
const store = new Map<string, Buffer>();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        async upload(key: string, body: Buffer) {
          store.set(`${bucket}/${key}`, Buffer.from(body));
          return { error: null };
        },
        async download(key: string) {
          const buf = store.get(`${bucket}/${key}`);
          if (!buf) return { data: null, error: { message: "not found" } };
          return { data: new Blob([buf]), error: null };
        },
        async remove(keys: string[]) {
          for (const k of keys) store.delete(`${bucket}/${k}`);
          return { error: null };
        },
      }),
    },
  }),
}));

const FIXED_KEY = crypto.randomBytes(32);
vi.mock("@/lib/secrets/storage-crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/secrets/storage-crypto")>();
  return { ...actual, getStorageKey: async () => FIXED_KEY };
});

import { BUCKETS, uploadToStorage, downloadFromStorage } from "@/lib/supabase/storage";
import { isEncrypted } from "@/lib/secrets/storage-crypto";

describe("storage encryption chokepoint", () => {
  beforeEach(() => store.clear());

  it("encrypts on upload and decrypts on download", async () => {
    const pdf = Buffer.from("%PDF-1.7 confidential invoice");
    await uploadToStorage(BUCKETS.INVOICES, "org/x.pdf", pdf, { contentType: "application/pdf" });

    const atRest = store.get(`${BUCKETS.INVOICES}/org/x.pdf`)!;
    expect(isEncrypted(atRest)).toBe(true);
    expect(atRest.includes("confidential")).toBe(false);

    const back = await downloadFromStorage(BUCKETS.INVOICES, "org/x.pdf");
    expect(back.equals(pdf)).toBe(true);
  });

  it("returns legacy plaintext objects unchanged", async () => {
    const legacy = Buffer.from("%PDF-1.7 pre-encryption file");
    store.set(`${BUCKETS.INVOICES}/legacy.pdf`, legacy);
    const back = await downloadFromStorage(BUCKETS.INVOICES, "legacy.pdf");
    expect(back.equals(legacy)).toBe(true);
  });
});
