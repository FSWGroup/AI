/** Clipboard helpers: tab-separated text (pastes into Excel/Sheets) plus an HTML table for Outlook/Teams. */

export type CellValue = string | number | null | undefined;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cellText(v: CellValue): string {
  if (v == null) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

export function toTsv(headers: string[], rows: CellValue[][]): string {
  const lines = [headers.map(cellText).join('\t')];
  for (const r of rows) lines.push(r.map(cellText).join('\t'));
  return lines.join('\r\n');
}

export function toHtmlTable(headers: string[], rows: CellValue[][]): string {
  const th = headers.map((h) => `<th style="text-align:left;padding:4px 8px;border:1px solid #cbd5e1;background:#e8eef7">${escapeHtml(cellText(h))}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td style="padding:4px 8px;border:1px solid #cbd5e1">${escapeHtml(cellText(c))}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:12px"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

async function writeClipboard(text: string, html?: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const item = new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        });
        await navigator.clipboard.write([item]);
        return true;
      }
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Copies a table as TSV (with an HTML twin for rich-text targets). */
export function copyTable(headers: string[], rows: CellValue[][]): Promise<boolean> {
  return writeClipboard(toTsv(headers, rows), toHtmlTable(headers, rows));
}

/** Copies plain text (summaries). */
export function copyText(text: string): Promise<boolean> {
  return writeClipboard(text);
}
