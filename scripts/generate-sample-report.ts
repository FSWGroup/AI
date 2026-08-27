/**
 * Regenerates the Alex Sample fixture report and writes its PDF to
 * ./alex-sample-report.pdf. Requires the app to be running (the PDF renderer
 * prints the app's signed report route through headless Chromium).
 *
 *   npm run dev          # in one terminal
 *   npm run report:sample
 */

import { writeFile } from "fs/promises";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const attempt = await prisma.attempt.findFirstOrThrow({
    where: { candidate: { firstName: "Alex", lastName: "Sample" } },
    include: { candidate: true, jobOpening: true },
  });

  const { generateReport } = await import("../src/lib/report/generate");
  const reportId = await generateReport(attempt.id);
  console.log(`Report regenerated: ${reportId}`);

  const { renderReportPdf } = await import("../src/lib/report/pdf");
  const pdf = await renderReportPdf({
    reportId,
    candidateName: `${attempt.candidate.firstName} ${attempt.candidate.lastName}`,
    position: attempt.jobOpening.title,
    completedAt: attempt.completedAt?.toISOString() ?? null,
  });
  await writeFile("alex-sample-report.pdf", pdf);
  console.log(`PDF written: alex-sample-report.pdf (${pdf.length} bytes)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
