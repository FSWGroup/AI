"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { msToClock } from "@/lib/interview-intel/transcript";

interface Party {
  party: "CANDIDATE" | "INTERVIEWER";
  userId: string | null;
  status: string;
  label: string;
  isMe: boolean;
}

interface Evidence {
  id: string;
  competencyName: string;
  quote: string;
  startMs: number;
  relevance: string;
  dismissedAt: string | null;
}

interface State {
  canRecord: boolean;
  reason: string | null;
  parties: Party[];
  aiConfigured: boolean;
  recording: {
    status: string;
    fileName: string | null;
    durationSeconds: number | null;
    segmentCount: number;
    hasTimestamps: boolean;
    evidence: Evidence[];
  } | null;
}

/**
 * Interview recording and the evidence pulled from it.
 *
 * The evidence is quotes. There is no score here, no summary of the
 * candidate, and no recommendation, because the interviewer forms the
 * judgement — this exists so they form it from what was said rather than
 * from what they remember.
 */
export function InterviewEvidencePanel({
  interviewId,
  hasKit,
}: {
  interviewId: string;
  hasKit: boolean;
}) {
  const [state, setState] = useState<State | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [showTranscriptBox, setShowTranscriptBox] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(
        await api<State>(`/api/admin/interviews/${interviewId}/recording`),
      );
    } catch {
      setError("Could not load the recording status.");
    }
  }, [interviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const out = await api<Record<string, unknown>>(
        `/api/admin/interviews/${interviewId}/recording`,
        { method: "POST", body },
      );
      if (typeof out.candidateUrl === "string") setLink(out.candidateUrl);
      if (typeof out.stored === "number") {
        const parts = [`${out.stored} quotes found`];
        if (Number(out.droppedUnlocatable) > 0) {
          parts.push(
            `${out.droppedUnlocatable} dropped because the words were not in the transcript`,
          );
        }
        if (Number(out.droppedEvaluative) > 0) {
          parts.push(`${out.droppedEvaluative} notes rewritten for reading as a verdict`);
        }
        setMessage(`${parts.join(". ")}.`);
      }
      if (typeof out.segments === "number") {
        setMessage(
          `${out.segments} lines read${out.hasTimestamps ? " with timestamps" : " (no timestamps in that format)"}.`,
        );
      }
      after?.();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-bold text-navy-900">Interview recording</h3>
        <p className="mt-2 text-sm text-navy-400">Loading…</p>
      </Card>
    );
  }

  const me = state.parties.find((p) => p.isMe);
  const byCompetency = new Map<string, Evidence[]>();
  for (const e of state.recording?.evidence ?? []) {
    const list = byCompetency.get(e.competencyName) ?? [];
    list.push(e);
    byCompetency.set(e.competencyName, list);
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-navy-900">Interview recording</h3>
        <Badge tone={state.canRecord ? "green" : "neutral"}>
          {state.canRecord ? "Recording allowed" : "Not recording"}
        </Badge>
      </div>

      <p className="mt-2 text-xs text-navy-500">
        Everyone in the interview has to agree — the candidate and every
        interviewer. Recording a private conversation without the agreement of
        all parties is a criminal offence in the Philippines and in several
        other places this company hires, so there is no way to override this.
      </p>

      {state.parties.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {state.parties.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="text-navy-700">
                {p.party === "CANDIDATE" ? "The candidate" : p.isMe ? "You" : "An interviewer"}
              </span>
              <span
                className={
                  p.status === "GRANTED"
                    ? "text-xs font-semibold text-emerald-700"
                    : p.status === "PENDING"
                      ? "text-xs text-navy-400"
                      : "text-xs font-semibold text-navy-600"
                }
              >
                {p.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {link && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-900">
            Send this to the candidate before the interview:
          </p>
          <input
            readOnly
            className="mt-2 w-full rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs text-navy-800"
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {message && <p className="mt-3 text-sm text-navy-700">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {state.parties.length === 0 && (
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => act({ action: "request_consent" })}
          >
            Ask everyone
          </Button>
        )}
        {me && me.status !== "GRANTED" && (
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => act({ action: "my_consent", decision: "GRANTED" })}
          >
            I agree to be recorded
          </Button>
        )}
        {me?.status === "GRANTED" && (
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => act({ action: "my_consent", decision: "WITHDRAWN" })}
          >
            Withdraw my consent
          </Button>
        )}
      </div>

      {state.canRecord && (
        <div className="mt-5 border-t border-navy-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
            Transcript
          </p>
          {state.recording?.segmentCount ? (
            <p className="mt-1 text-sm text-navy-600">
              {state.recording.segmentCount} lines
              {state.recording.durationSeconds
                ? `, ${Math.round(state.recording.durationSeconds / 60)} minutes`
                : ""}
              {state.recording.hasTimestamps ? "" : " (no timestamps)"}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-navy-500">
              Paste the transcript your meeting tool produced — WebVTT, SRT, or
              plain text. Theirs is more accurate than anything this platform
              would produce, and the audio never has to leave your meeting tool.
            </p>
          )}

          {showTranscriptBox ? (
            <>
              <Textarea
                rows={6}
                className="mt-2 font-mono text-xs"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="WEBVTT&#10;&#10;00:00:04.000 --> 00:00:09.500&#10;Ana Cruz: We had six weeks…"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  className="px-3 py-1.5 text-xs"
                  disabled={busy || transcript.trim().length === 0}
                  onClick={() =>
                    act({ action: "transcript", text: transcript }, () => {
                      setTranscript("");
                      setShowTranscriptBox(false);
                    })
                  }
                >
                  Save the transcript
                </Button>
                <Button
                  variant="ghost"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => setShowTranscriptBox(false)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="secondary"
              className="mt-2 px-3 py-1.5 text-xs"
              onClick={() => setShowTranscriptBox(true)}
            >
              {state.recording?.segmentCount ? "Replace the transcript" : "Paste a transcript"}
            </Button>
          )}

          {(state.recording?.segmentCount ?? 0) > 0 && (
            <div className="mt-4">
              {!hasKit ? (
                <p className="text-sm text-navy-500">
                  Attach an interview kit to this interview before running the
                  analysis. Evidence with nothing to be evidence <em>for</em> is
                  just a highlight reel.
                </p>
              ) : !state.aiConfigured ? (
                <p className="text-sm text-navy-500">
                  AI analysis is not configured on this instance.
                </p>
              ) : (
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => act({ action: "analyze" })}
                >
                  {busy ? "Reading…" : "Find evidence against the kit"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {byCompetency.size > 0 && (
        <div className="mt-5 border-t border-navy-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
            What the candidate said
          </p>
          <p className="mt-1 text-xs text-navy-500">
            Quotes, verbatim, with where to find them. No score and no verdict:
            you read what was said and rate it on the scorecard yourself.
          </p>
          <div className="mt-3 space-y-4">
            {[...byCompetency.entries()].map(([competency, items]) => (
              <div key={competency}>
                <p className="text-sm font-semibold text-navy-900">{competency}</p>
                <ul className="mt-1 space-y-2">
                  {items.map((e) => (
                    <li key={e.id} className="border-l-2 border-navy-100 pl-3">
                      <p className="text-sm italic leading-relaxed text-navy-800">
                        &ldquo;{e.quote}&rdquo;
                      </p>
                      <p className="mt-0.5 text-xs text-navy-500">
                        {e.startMs >= 0 ? `at ${msToClock(e.startMs)} · ` : ""}
                        {e.relevance}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {(state.recording?.status === "UPLOADED" ||
        state.recording?.status === "TRANSCRIBED" ||
        state.recording?.status === "ANALYZED") && (
        <button
          type="button"
          className="mt-5 text-xs text-navy-500 underline"
          disabled={busy}
          onClick={() => act({ action: "destroy" })}
        >
          Delete the recording and everything from it
        </button>
      )}
    </Card>
  );
}
