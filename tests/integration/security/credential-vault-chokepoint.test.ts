import { afterEach, describe, expect, it } from "vitest";
import { writeDbSecret, readDbSecret, deleteDbSecret } from "@/lib/secrets/encrypted-db-store";

// INFETCH-263a: Secrets werden NUR noch über die SECURITY-DEFINER-Funktion
// public.app_read_vault_secret entschlüsselt (Decrypt-Chokepoint). Dieser Test
// fixiert, dass der Round-Trip über die Funktion funktioniert — sonst könnte ein
// Bruch des Chokepoints (z.B. wieder direktes vault.decrypted_secrets) unbemerkt
// bleiben.

const hasDb = Boolean(process.env.DATABASE_URL);
const REF = `chokepoint-${Date.now()}`;

describe.skipIf(!hasDb)("vault decrypt chokepoint (INFETCH-263a)", () => {
  afterEach(async () => {
    await deleteDbSecret(REF);
  });

  it("readDbSecret liest den Wert über die Funktion zurück", async () => {
    await writeDbSecret(REF, "s3cr3t-value");
    expect(await readDbSecret(REF)).toBe("s3cr3t-value");
  });

  it("unbekannter Ref → null", async () => {
    expect(await readDbSecret(`nope-${Date.now()}`)).toBeNull();
  });
});
