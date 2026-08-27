/**
 * Print-optimized report page consumed by the PDF renderer (headless
 * Chromium). Access requires a short-lived signed token issued by the PDF
 * route — this page is never reachable with a plain URL.
 */

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifySignedValue } from "@/lib/crypto";
import { ReportView } from "@/components/report/ReportView";
import type { ReportPayload } from "@/lib/report/generate";

export const dynamic = "force-dynamic";

export default async function PrintReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ sig?: string }>;
}) {
  const { reportId } = await params;
  const { sig } = await searchParams;
  const payloadStr = sig ? verifySignedValue(sig) : null;
  if (!payloadStr || payloadStr !== `print-report:${reportId}`) notFound();

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report?.payload) notFound();
  const payload = report.payload as unknown as ReportPayload;

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 print:p-0">
      <ReportView payload={payload} print />
      <footer className="mt-10 border-t border-navy-100 pt-3 text-center text-[10px] text-navy-400">
        FSW WorkFit Assessment | Confidential Employment Assessment —{" "}
        {payload.meta.candidateName} · {payload.meta.position}
      </footer>
    </div>
  );
}
