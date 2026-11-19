import { PDFParse } from 'pdf-parse';

export const PAGE_SEPARATOR = (pageNumber) => `\n\n===== PAGE ${pageNumber} =====\n\n`;

function normalizePageText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts the text of every page in a PDF buffer and joins the pages with
 * explicit separators so the dashboard can render page-by-page previews.
 *
 * pdf-parse v2 wraps the current pdf.js engine and returns per-page text,
 * which keeps multi-page documents clean (no merged page boundaries).
 */
export async function extractPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    const pages = (result.pages || []).map((page) => normalizePageText(page.text));
    const pageCount = result.total || pages.length;

    const content = pages
      .map(
        (pageText, index) =>
          `${PAGE_SEPARATOR(index + 1)}${pageText || '(no extractable text on this page)'}`,
      )
      .join('')
      .trim();

    return { content, pageCount, pages };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
