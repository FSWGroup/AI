/**
 * PDF rendering via headless Chromium (playwright-core) printing the
 * signed print route. Every page carries candidate, job, date, and page
 * numbers, and the confidential footer.
 *
 * Deployment note: this runs wherever a Chromium binary is available
 * (CHROMIUM_PATH). On serverless platforms, run PDF generation in a
 * container/worker or use @sparticuz/chromium — see README.
 */

import { chromium } from "playwright-core";
import { createSignedValue } from "@/lib/crypto";
import { env } from "@/lib/env";

export async function renderReportPdf(params: {
  reportId: string;
  candidateName: string;
  position: string;
  completedAt: string | null;
}): Promise<Buffer> {
  const sig = createSignedValue(`print-report:${params.reportId}`, 5 * 60);
  const url = `${env.appBaseUrl}/print/report/${params.reportId}?sig=${encodeURIComponent(sig)}`;

  const browser = await chromium.launch({
    executablePath: env.chromiumPath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    const dateStr = params.completedAt
      ? new Date(params.completedAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.9in", bottom: "0.9in", left: "0.6in", right: "0.6in" },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width:100%;font-size:8px;color:#6c88a8;padding:0 0.6in;display:flex;justify-content:space-between;">
          <span>${escapeHtml(params.candidateName)} — ${escapeHtml(params.position)}</span>
          <span>${dateStr}</span>
        </div>`,
      footerTemplate: `
        <div style="width:100%;font-size:8px;color:#6c88a8;padding:0 0.6in;display:flex;justify-content:space-between;">
          <span>FSW Talent Scout Assessment | Confidential Employment Assessment</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
