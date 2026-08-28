"use client";

/**
 * Recording review.
 *
 * Plays each recording session as ONE continuous video covering the whole
 * assessment (the server reassembles the stored chunks — an individual chunk
 * is not independently playable). A timeline lets the reviewer jump to a
 * point in time; jumping reloads the stream starting at that segment, so
 * long recordings never have to download from the beginning.
 */

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card } from "@/components/ui";

interface Segment {
  sequence: number;
  offsetSeconds: number | null;
  startedAt: string | null;
  sizeBytes: number | null;
}

interface RecordingSession {
  sessionId: string;
  status: string;
  mimeType: string;
  startedAt: string;
  endedAt: string | null;
  expectedChunks: number | null;
  uploadedChunks: number;
  totalBytes: number;
  durationSeconds: number | null;
  segments: Segment[];
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordingViewer({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<{
    reminder: string;
    sessions: RecordingSession[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(): Promise<void> {
    setError(null);
    try {
      const res = await api<{ reminder: string; sessions: RecordingSession[] }>(
        `/api/admin/attempts/${attemptId}/recording`,
      );
      setData(res);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load recordings.");
    }
  }

  if (!loaded) {
    return (
      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Recording access</h3>
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Review this recording only for assessment-integrity concerns. Do not
          evaluate appearance or any actual or perceived protected
          characteristic. Every access is logged in the audit trail.
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <Button className="mt-4" onClick={() => void load()}>
          I understand — load recording
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{data?.reminder}</p>
      {data?.sessions.length === 0 && (
        <Card className="p-8 text-center text-sm text-navy-400">
          No recordings exist for this attempt.
        </Card>
      )}
      {data?.sessions.map((s, i) => (
        <SessionPlayer
          key={s.sessionId}
          attemptId={attemptId}
          session={s}
          index={i}
          total={data.sessions.length}
        />
      ))}
    </div>
  );
}

function SessionPlayer({
  attemptId,
  session,
  index,
  total,
}: {
  attemptId: string;
  session: RecordingSession;
  index: number;
  total: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [fromSequence, setFromSequence] = useState<number>(
    session.segments[0]?.sequence ?? 0,
  );
  const [elapsed, setElapsed] = useState(0);

  const base = `/api/admin/attempts/${attemptId}/recording/stream?session=${encodeURIComponent(
    session.sessionId,
  )}`;
  const src = `${base}&from=${fromSequence}`;

  // Offset of the segment playback starts from, so the displayed time
  // reflects position in the assessment rather than in the loaded stream.
  const startOffset =
    session.segments.find((seg) => seg.sequence === fromSequence)?.offsetSeconds ?? 0;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.load();
    setElapsed(0);
  }, [src]);

  const incomplete =
    session.status === "INCOMPLETE" ||
    (session.expectedChunks !== null &&
      session.uploadedChunks < session.expectedChunks);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy-900">
          {total > 1 ? `Session ${index + 1} of ${total}` : "Recording"}
        </h3>
        <div className="flex items-center gap-2">
          <Badge tone={incomplete ? "amber" : "green"}>
            {incomplete ? "Incomplete upload" : "Complete"}
          </Badge>
          <span className="text-xs text-navy-400">
            {new Date(session.startedAt).toLocaleString()}
            {session.durationSeconds !== null &&
              ` · ${formatClock(session.durationSeconds)} captured`}
            {` · ${formatBytes(session.totalBytes)}`}
          </span>
        </div>
      </div>

      {session.segments.length === 0 ? (
        <p className="mt-3 text-sm text-navy-400">
          No uploaded video for this session.
        </p>
      ) : (
        <>
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            className="mt-4 aspect-video w-full max-w-2xl rounded-xl bg-navy-950"
            onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
          >
            <source src={src} type={session.mimeType || "video/webm"} />
            Your browser cannot play this recording format.
          </video>

          <p className="mt-2 text-sm font-medium text-navy-700">
            Position in assessment:{" "}
            <span className="font-mono">
              {formatClock(Math.round(startOffset + elapsed))}
            </span>
            {session.durationSeconds !== null && (
              <span className="text-navy-400">
                {" "}
                / {formatClock(session.durationSeconds)}
              </span>
            )}
          </p>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
              Jump to a point in the assessment
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {session.segments.map((seg) => {
                const active = seg.sequence === fromSequence;
                return (
                  <button
                    key={seg.sequence}
                    onClick={() => setFromSequence(seg.sequence)}
                    className={`rounded px-2.5 py-1 font-mono text-xs font-semibold transition-colors ${
                      active
                        ? "bg-navy-900 text-white"
                        : "bg-navy-100 text-navy-600 hover:bg-navy-200"
                    }`}
                    aria-pressed={active}
                    aria-label={`Play from ${
                      seg.offsetSeconds !== null
                        ? formatClock(seg.offsetSeconds)
                        : `segment ${seg.sequence + 1}`
                    }`}
                  >
                    {seg.offsetSeconds !== null
                      ? formatClock(seg.offsetSeconds)
                      : `#${seg.sequence + 1}`}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-navy-400">
              The player streams the recording continuously from the selected
              point to the end. Because browser-recorded video carries no
              duration header, the scrub bar may not show a total length —
              use these markers to move through the session, or download the
              full file to review it in a desktop player.
            </p>
          </div>

          <div className="mt-3 flex gap-2">
            <a
              href={`${base}&from=${session.segments[0].sequence}`}
              download={`recording-${session.sessionId}.webm`}
              className="rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50"
            >
              Download full recording
            </a>
            {fromSequence !== session.segments[0].sequence && (
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => setFromSequence(session.segments[0].sequence)}
              >
                Back to start
              </Button>
            )}
          </div>

          {incomplete && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              This session&apos;s upload did not finish
              {session.expectedChunks !== null
                ? ` (${session.uploadedChunks} of ${session.expectedChunks} segments received)`
                : ""}
              . The candidate may have closed the window or lost connection at
              the end. Any other sessions above/below cover the rest of the
              attempt.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
