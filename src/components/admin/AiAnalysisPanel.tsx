"use client";

/**
 * Résumé upload + AI interview preparation brief.
 *
 * The brief is advisory decision support: it never scores, ranks, or
 * recommends a hiring decision, and the UI states that plainly wherever the
 * output is shown.
 */

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Textarea } from "@/components/ui";

interface DocumentRow {
  id: string;
  fileName: string;
  createdAt: string;
  textSource: string;
  characters: number;
  needsText: boolean;
}

interface CandidateFitOutput {
  roleContext: string;
  assessmentHighlights: {
    dimension: string;
    observation: string;
    relevance: "strength_for_role" | "watch_area" | "context_only";
  }[];
  resumeCorroboration: {
    topic: string;
    assessmentSignal: string;
    resumeSignal: string;
    relationship: "corroborates" | "tension" | "resume_silent";
    whatToVerify: string;
  }[];
  experienceGaps: string[];
  interviewQuestions: {
    theme: string;
    question: string;
    whyThisQuestion: string;
    listenFor: string;
    followUp: string;
  }[];
  referenceCheckPrompts: string[];
  onboardingConsiderations: string[];
  cautions: string[];
}

interface AnalysisRow {
  id: string;
  output: CandidateFitOutput;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export function AiAnalysisPanel({ attemptId }: { attemptId: string }) {
  const [configured, setConfigured] = useState(true);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [showPasteNew, setShowPasteNew] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function refresh(): Promise<void> {
    try {
      const res = await api<{
        configured: boolean;
        analysis: AnalysisRow | null;
        documents: DocumentRow[];
      }>(`/api/admin/attempts/${attemptId}/analysis`);
      setConfigured(res.configured);
      setDocuments(res.documents);
      setAnalysis(res.analysis);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load analysis.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  async function uploadFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/attempts/${attemptId}/resume`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const data = (await res.json()) as {
        error?: string;
        documentId?: string;
        extractionFailed?: boolean;
        message?: string;
        characters?: number;
      };
      if (!res.ok) throw new ApiError(data.error ?? "Upload failed.", res.status);
      if (data.extractionFailed) {
        setPasteFor(data.documentId!);
        setMessage(data.message ?? "Text could not be read — paste it below.");
      } else {
        setMessage(`Résumé uploaded (${data.characters?.toLocaleString()} characters of text).`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function savePastedText(documentId: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (documentId) {
        await api(`/api/admin/attempts/${attemptId}/resume`, {
          method: "PATCH",
          body: { documentId, text: pasteText },
        });
      } else {
        await api(`/api/admin/attempts/${attemptId}/resume`, {
          body: { text: pasteText },
        });
      }
      setPasteFor(null);
      setShowPasteNew(false);
      setPasteText("");
      setMessage("Résumé text saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the text.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(id: string): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/admin/attempts/${attemptId}/resume?documentId=${id}`, {
        method: "DELETE",
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the file.");
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ analysis: AnalysisRow; usedResume: boolean }>(
        `/api/admin/attempts/${attemptId}/analysis`,
        { body: {} },
      );
      setAnalysis(res.analysis);
      setMessage(
        res.usedResume
          ? "Analysis complete, using the assessment results and the résumé."
          : "Analysis complete, using the assessment results. Upload a résumé for a richer brief.",
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "The analysis could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Card className="p-8 text-center text-sm text-navy-400">Loading…</Card>;
  }

  return (
    <div className="space-y-6">
      {!configured && (
        <Card className="border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-bold text-amber-900">AI analysis is not configured</h3>
          <p className="mt-2 text-sm text-amber-900">
            Add an <code className="font-mono">ANTHROPIC_API_KEY</code> environment
            variable to this deployment, then redeploy. Everything else on this
            page works without it.
          </p>
        </Card>
      )}

      {message && (
        <p role="status" className="rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* ---- Résumé ---- */}
      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Résumé</h3>
        <p className="mt-1 text-xs text-navy-500">
          Optional, but it makes the brief far more specific. PDF, DOCX, or
          plain text up to 10 MB. Stored privately and never shown to the
          candidate.
        </p>

        {documents.length > 0 && (
          <ul className="mt-3 space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-navy-100 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-navy-900">{d.fileName}</p>
                  <p className="text-xs text-navy-400">
                    {new Date(d.createdAt).toLocaleString()} ·{" "}
                    {d.needsText
                      ? "no readable text"
                      : `${d.characters.toLocaleString()} characters`}
                    {d.textSource === "pasted" && " · pasted"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.needsText && <Badge tone="amber">Needs text</Badge>}
                  {d.needsText && (
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => {
                        setPasteFor(d.id);
                        setPasteText("");
                      }}
                    >
                      Paste text
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="px-3 py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => void removeDocument(d.id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="block text-sm text-navy-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy-800"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
            aria-label="Upload résumé"
          />
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => {
              setShowPasteNew((v) => !v);
              setPasteText("");
            }}
          >
            or paste text instead
          </Button>
        </div>

        {(pasteFor || showPasteNew) && (
          <div className="mt-4">
            <Textarea
              rows={8}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste the résumé text here…"
              aria-label="Résumé text"
            />
            <div className="mt-2 flex gap-2">
              <Button
                disabled={busy || pasteText.trim().length < 50}
                onClick={() => void savePastedText(pasteFor)}
              >
                Save text
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPasteFor(null);
                  setShowPasteNew(false);
                  setPasteText("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ---- Run ---- */}
      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Interview preparation brief</h3>
        <p className="mt-1 text-xs text-navy-500">
          Combines the assessment results, the role&apos;s job description and
          benchmark, and the résumé into questions worth asking. It does not
          score the candidate and does not make a hiring recommendation.
        </p>
        <Button
          className="mt-4"
          disabled={busy || !configured}
          onClick={() => void runAnalysis()}
        >
          {busy ? "Analyzing…" : analysis ? "Re-run analysis" : "Analyze candidate"}
        </Button>
        {busy && (
          <p className="mt-2 text-xs text-navy-400">
            This usually takes 30-60 seconds.
          </p>
        )}
      </Card>

      {analysis && <AnalysisOutput analysis={analysis} />}
    </div>
  );
}

function AnalysisOutput({ analysis }: { analysis: AnalysisRow }) {
  const o = analysis.output;
  return (
    <div className="space-y-4">
      <Card className="border-fsw-200 bg-fsw-50 p-4">
        <p className="text-xs text-fsw-900">
          <strong>AI-generated decision support.</strong> Reviewed by a human
          before use. It contains no hiring recommendation and no scoring — the
          assessment scores on the Results tab are unaffected by anything here.
          Generated {new Date(analysis.createdAt).toLocaleString()} ·{" "}
          {analysis.model} · {analysis.promptVersion}
        </p>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-navy-900">Role context</h3>
        <p className="mt-2 text-sm leading-relaxed text-navy-700">{o.roleContext}</p>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-navy-900">What the results mean for this role</h3>
        <ul className="mt-3 space-y-3">
          {o.assessmentHighlights.map((h, i) => (
            <li key={i} className="rounded-lg bg-navy-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-navy-900">{h.dimension}</p>
                <Badge
                  tone={
                    h.relevance === "strength_for_role"
                      ? "green"
                      : h.relevance === "watch_area"
                        ? "amber"
                        : "neutral"
                  }
                >
                  {h.relevance === "strength_for_role"
                    ? "Strength for role"
                    : h.relevance === "watch_area"
                      ? "Worth exploring"
                      : "Context"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-navy-700">{h.observation}</p>
            </li>
          ))}
        </ul>
      </Card>

      {o.resumeCorroboration.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-navy-900">
            Résumé compared with assessment
          </h3>
          <p className="mt-1 text-xs text-navy-500">
            Where the written history and the assessment pattern agree, differ,
            or say nothing. A difference is a question, not a finding.
          </p>
          <ul className="mt-3 space-y-3">
            {o.resumeCorroboration.map((c, i) => (
              <li key={i} className="rounded-lg border border-navy-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy-900">{c.topic}</p>
                  <Badge
                    tone={
                      c.relationship === "corroborates"
                        ? "green"
                        : c.relationship === "tension"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {c.relationship === "corroborates"
                      ? "Corroborates"
                      : c.relationship === "tension"
                        ? "Tension"
                        : "Résumé silent"}
                  </Badge>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div>
                    <dt className="inline font-medium text-navy-500">Assessment: </dt>
                    <dd className="inline text-navy-700">{c.assessmentSignal}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-navy-500">Résumé: </dt>
                    <dd className="inline text-navy-700">{c.resumeSignal}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-fsw-700">Verify: </dt>
                    <dd className="inline text-fsw-800">{c.whatToVerify}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {o.experienceGaps.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-navy-900">Not evidenced in the résumé</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-700">
            {o.experienceGaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-bold text-navy-900">Interview questions</h3>
        <ol className="mt-3 space-y-4">
          {o.interviewQuestions.map((q, i) => (
            <li key={i} className="rounded-lg bg-navy-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-fsw-600">
                {q.theme}
              </p>
              <p className="mt-1 text-sm font-semibold text-navy-900">
                {i + 1}. {q.question}
              </p>
              <p className="mt-2 text-xs text-navy-500">
                <span className="font-semibold">Why ask it:</span> {q.whyThisQuestion}
              </p>
              <p className="mt-1 text-xs text-fsw-800">
                <span className="font-semibold">Listen for:</span> {q.listenFor}
              </p>
              <p className="mt-1 text-xs text-navy-500">
                <span className="font-semibold">Follow up:</span> {q.followUp}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {o.referenceCheckPrompts.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-navy-900">Reference check prompts</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-700">
            {o.referenceCheckPrompts.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Card>
      )}

      {o.onboardingConsiderations.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-navy-900">
            If hired — onboarding considerations
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-700">
            {o.onboardingConsiderations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Card>
      )}

      {o.cautions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-bold text-amber-900">Interpretation cautions</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {o.cautions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
