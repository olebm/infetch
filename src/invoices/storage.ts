import fs from "node:fs";
import path from "node:path";
import { appConfig } from "@/lib/config/env";

export function buildInvoiceStoragePath(input: {
  originalFilename: string;
  vendorKey: string | null;
  productLabel: string | null;
  invoiceDate: string | null;
  fallbackDate?: string | null;
  currentPath?: string | null;
}) {
  const effectiveDate = input.invoiceDate || input.fallbackDate || "unknown-date";
  const yearMonth = effectiveDate.slice(0, 7) || "unknown-month";
  const year = effectiveDate.slice(0, 4) || "unknown-year";
  const vendor = sanitizePathPart(input.vendorKey || "unknown-vendor");
  const product = sanitizePathPart(input.productLabel || "unknown-product");
  const datePart = sanitizeDatePart(effectiveDate);
  const safeName = `${vendor}_${product}_${datePart}.pdf`;
  const targetDir = path.join(appConfig.invoiceStoragePath, year, yearMonth, vendor);

  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  return resolveUniqueInvoiceStoragePath(path.join(targetDir, safeName), input.currentPath || null);
}

export function sanitizePathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeDatePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "unknown-date";
}

function resolveUniqueInvoiceStoragePath(desiredPath: string, currentPath: string | null) {
  if (currentPath && desiredPath === currentPath) return desiredPath;
  if (!fs.existsSync(desiredPath)) return desiredPath;

  const directory = path.dirname(desiredPath);
  const extension = path.extname(desiredPath);
  const baseName = path.basename(desiredPath, extension);

  let index = 2;
  while (true) {
    const candidate = path.join(directory, `${baseName}_${index}${extension}`);
    if (currentPath && candidate === currentPath) return candidate;
    if (!fs.existsSync(candidate)) return candidate;
    index += 1;
  }
}
