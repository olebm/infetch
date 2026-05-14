export const maxPdfSizeBytes = 20 * 1024 * 1024;

export function isLikelyPdf(buffer: Buffer) {
  return buffer.byteLength >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}
