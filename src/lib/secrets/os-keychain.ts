import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const serviceName = "invoice-agent";

export function isOsKeychainSupported() {
  return process.platform === "darwin";
}

export async function writeOsSecret(secretRef: string, secret: string) {
  if (!isOsKeychainSupported()) {
    throw new Error("OS Secret Store ist auf diesem System nicht verfügbar.");
  }

  await execFileAsync("security", ["add-generic-password", "-a", secretRef, "-s", serviceName, "-w", secret, "-U"], {
    timeout: 10_000,
    maxBuffer: 1024,
  });
}

export async function readOsSecret(secretRef: string) {
  if (!isOsKeychainSupported()) return null;

  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", secretRef, "-s", serviceName, "-w"], {
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function deleteOsSecret(secretRef: string) {
  if (!isOsKeychainSupported()) return;

  try {
    await execFileAsync("security", ["delete-generic-password", "-a", secretRef, "-s", serviceName], {
      timeout: 10_000,
      maxBuffer: 1024,
    });
  } catch {
    // Deleting a missing keychain item is already the desired end state.
  }
}
