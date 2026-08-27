"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";

interface RecordingSession {
  sessionId: string;
  status: string;
  mimeType: string;
  startedAt: string;
  endedAt: string | null;
  chunks: { sequence: number; url: string; sizeBytes: number | null }[];
}

export function RecordingViewer({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<{
    reminder: string;
    sessions: RecordingSession[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(): Promise<void> {
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
        <SessionPlayer key={s.sessionId} session={s} index={i} />
      ))}
    </div>
  );
}

function SessionPlayer({
  session,
  index,
}: {
  session: RecordingSession;
  index: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [chunkIdx, setChunkIdx] = useState(0);
  const chunks = session.chunks;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || chunks.length === 0) return;
    v.src = chunks[chunkIdx].url;
    void v.play().catch(() => undefined);
  }, [chunkIdx, chunks]);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy-900">
          Session {index + 1} — {session.status}
        </h3>
        <p className="text-xs text-navy-400">
          {new Date(session.startedAt).toLocaleString()} · {chunks.length} chunks
        </p>
      </div>
      {chunks.length > 0 ? (
        <>
          <video
            ref={videoRef}
            controls
            playsInline
            className="mt-4 aspect-video w-full max-w-xl rounded-xl bg-navy-950"
            onEnded={() => {
              if (chunkIdx < chunks.length - 1) setChunkIdx(chunkIdx + 1);
            }}
          />
          <div className="mt-3 flex flex-wrap gap-1">
            {chunks.map((c, i) => (
              <button
                key={c.sequence}
                onClick={() => setChunkIdx(i)}
                className={`h-7 w-9 rounded text-xs font-semibold ${
                  i === chunkIdx
                    ? "bg-navy-900 text-white"
                    : "bg-navy-100 text-navy-600 hover:bg-navy-200"
                }`}
                aria-label={`Play segment ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-navy-400">
            Segments play in sequence automatically. Playback URLs expire after
            a few minutes; reload the tab to re-issue them.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-navy-400">No uploaded chunks.</p>
      )}
    </Card>
  );
}
