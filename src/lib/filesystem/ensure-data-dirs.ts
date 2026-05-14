import fs from "node:fs";
import { appConfig } from "@/lib/config/env";

const requiredDirs = [
  appConfig.invoiceStoragePath,
  appConfig.rawTextStoragePath,
  appConfig.portalStoragePath,
  appConfig.aiCacheStoragePath,
  appConfig.logStoragePath,
];

export function ensureDataDirs() {
  for (const dir of requiredDirs) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
