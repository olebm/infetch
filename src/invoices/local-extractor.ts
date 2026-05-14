export async function extractPdfText(buffer: Buffer): Promise<{ text: string; error: string | null }> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    return { text: parsed.text || "", error: null };
  } catch (error) {
    return {
      text: "",
      error: error instanceof Error ? error.message : "PDF text extraction failed",
    };
  }
}
