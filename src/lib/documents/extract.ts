/**
 * Résumé / document text extraction.
 *
 * Supports PDF, DOCX, and plain text. Extraction runs server-side on the
 * uploaded bytes; the file itself goes to private object storage and is
 * never exposed publicly. If extraction fails or produces too little text,
 * the caller falls back to letting the admin paste the text manually, so an
 * unusual file never blocks the workflow.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Characters of extracted text retained/sent for analysis. */
export const MAX_EXTRACTED_CHARS = 60_000;

export const ACCEPTED_MIME_TYPES: Record<string, "pdf" | "docx" | "text"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
};

export function detectKind(
  mimeType: string,
  fileName: string,
): "pdf" | "docx" | "text" | null {
  const byMime = ACCEPTED_MIME_TYPES[mimeType.split(";")[0].trim()];
  if (byMime) return byMime;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text";
  return null;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

export interface ExtractionResult {
  text: string;
  ok: boolean;
  reason?: string;
}

/** Below this, extraction is treated as failed (e.g. a scanned PDF). */
const MIN_USABLE_CHARS = 120;

export async function extractText(
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractionResult> {
  const kind = detectKind(mimeType, fileName);
  if (!kind) {
    return {
      text: "",
      ok: false,
      reason: "Unsupported file type. Upload a PDF, DOCX, or plain-text file.",
    };
  }

  try {
    let raw = "";
    if (kind === "text") {
      raw = bytes.toString("utf8");
    } else if (kind === "pdf") {
      const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      raw = Array.isArray(text) ? text.join("\n") : text;
    } else {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer: bytes });
      raw = result.value;
    }

    const text = normalize(raw);
    if (text.length < MIN_USABLE_CHARS) {
      return {
        text,
        ok: false,
        reason:
          "Very little text could be read from this file — it may be a scanned image. Paste the résumé text instead.",
      };
    }
    return { text, ok: true };
  } catch {
    return {
      text: "",
      ok: false,
      reason:
        "This file could not be read automatically. Paste the résumé text instead.",
    };
  }
}
