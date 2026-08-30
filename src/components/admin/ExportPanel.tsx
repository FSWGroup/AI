"use client";

/**
 * The complete-export tab: says exactly what the file will contain before
 * anyone sends it to a colleague, then downloads it.
 *
 * The contents list is not decoration. This PDF leaves the system the moment
 * it is downloaded, taking personal information with it, so the person
 * clicking should know what they are about to forward.
 */

import { useState } from "react";
import { Button, Card } from "@/components/ui";

const INCLUDED = [
  "Executive summary — strongest alignment, what to investigate, how much confidence the results deserve",
  "Results at a glance — every dimension on the 1–9 scale against this role's target ranges",
  "Dimension-by-dimension detail for the mental aptitudes and the performance scales",
  "Response quality (validity) indicators and how to read them",
  "Sales trait composites and leadership composites, where the role uses them",
  "The targeted interview guide, with alternate wordings and what to listen for",
  "Development suggestions",
  "Session record — administration, section timings, accommodations, consent records",
  "Session integrity log, every recorded event",
  "A plain-English guide to reading bands, ranges, and the limits of the instrument",
];

export function ExportPanel({
  attemptId,
  ready,
  hasAiBrief,
  integrityEventCount,
}: {
  attemptId: string;
  ready: boolean;
  hasAiBrief: boolean;
  integrityEventCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/attempts/${attemptId}/export`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "The export could not be generated.");
      }
      // Read the whole file before creating the link so a failure mid-stream
      // surfaces as an error rather than a truncated download.
      const blob = await res.blob();
      const name =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "assessment-report.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <Card className="p-8 text-center text-sm text-navy-400">
        The export becomes available once the assessment is completed and
        scored.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">
          Complete assessment report (PDF)
        </h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-navy-600">
          One file with everything below, ready to send to a colleague. It
          opens with the executive summary and the score sheet, so someone who
          reads only the first two pages still gets the picture; the detail
          behind them follows.
        </p>
        <div className="mt-5">
          <Button disabled={busy} onClick={() => void download()}>
            {busy ? "Building the PDF…" : "Download PDF"}
          </Button>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">
          What is in the file
        </h3>
        <ul className="mt-3 space-y-1.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-navy-700">
              <span aria-hidden className="text-fsw-600">
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
          <li className="flex gap-2 text-sm text-navy-700">
            <span aria-hidden className={hasAiBrief ? "text-fsw-600" : "text-navy-300"}>
              {hasAiBrief ? "✓" : "—"}
            </span>
            <span className={hasAiBrief ? "" : "text-navy-400"}>
              The AI interview brief
              {hasAiBrief
                ? ", labelled as AI-generated"
                : " — none has been generated for this candidate, so the section is omitted"}
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-navy-500">
          {integrityEventCount === 0
            ? "No integrity events were recorded for this session."
            : `The integrity log runs to ${integrityEventCount} event${
                integrityEventCount === 1 ? "" : "s"
              }.`}
        </p>
      </Card>

      <Card className="p-6">
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">
          Before you send it
        </h3>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-navy-700">
          <li>
            <strong className="text-navy-900">
              The webcam recording is never included.
            </strong>{" "}
            Who may view a recording is a separate, audited permission, and a
            PDF cannot carry that permission with it. Recordings stay in the
            portal.
          </li>
          <li>
            <strong className="text-navy-900">
              The candidate&rsquo;s résumé is not included either.
            </strong>{" "}
            It is their document, not ours to redistribute. What the AI brief
            concluded from it is included.
          </li>
          <li>
            <strong className="text-navy-900">Your name is on the cover</strong>{" "}
            with the export time, and the download is recorded in the audit
            log — so a forwarded copy can always be traced back.
          </li>
          <li>
            This file contains personal information about a named individual.
            Share it only with colleagues involved in this hiring decision, and
            dispose of it under your retention policy.
          </li>
        </ul>
      </Card>
    </div>
  );
}
