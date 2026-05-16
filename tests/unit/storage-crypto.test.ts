import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptBuffer, encryptBuffer, isEncrypted } from "@/lib/secrets/storage-crypto";

const KEY = crypto.randomBytes(32);

describe("storage-crypto", () => {
  it("round-trips a buffer", () => {
    const plain = Buffer.from("%PDF-1.7 invoice content äöü€");
    const enc = encryptBuffer(plain, KEY);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc.equals(plain)).toBe(false);
    expect(decryptBuffer(enc, KEY).equals(plain)).toBe(true);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = Buffer.from("same input");
    expect(encryptBuffer(plain, KEY).equals(encryptBuffer(plain, KEY))).toBe(false);
  });

  it("passes legacy plaintext through unchanged on decrypt", () => {
    const legacy = Buffer.from("%PDF-1.7 unencrypted legacy file");
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptBuffer(legacy, KEY).equals(legacy)).toBe(true);
  });

  it("throws on a tampered ciphertext", () => {
    const enc = encryptBuffer(Buffer.from("secret invoice"), KEY);
    enc[enc.length - 1] ^= 0xff; // letztes Byte kippen
    expect(() => decryptBuffer(enc, KEY)).toThrow();
  });

  it("throws when decrypting with the wrong key", () => {
    const enc = encryptBuffer(Buffer.from("secret invoice"), KEY);
    expect(() => decryptBuffer(enc, crypto.randomBytes(32))).toThrow();
  });

  it("throws on a truncated envelope", () => {
    const enc = encryptBuffer(Buffer.from("x"), KEY);
    expect(() => decryptBuffer(enc.subarray(0, 8), KEY)).toThrow(/beschädigt/);
  });
});
