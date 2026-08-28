"use client";

import * as React from "react";
import { toast } from "sonner";

interface ScormMessage {
  source?: string;
  nonce?: string;
  mediaId?: string;
  type?: string;
  cmi?: Record<string, unknown>;
}

/**
 * Listens for postMessage commits from the sandboxed SCORM iframe and relays
 * them to POST /api/media/scorm/progress. See the isolation-model comment in
 * src/lib/services/scorm.ts for why this channel — rather than a direct
 * cross-frame function call — is what actually works across the sandbox
 * boundary, and for the one real limitation in this deployment (this app's
 * media CSP blocks script execution inside the sandboxed frame entirely, so
 * in practice no messages will arrive here yet).
 */
export function ScormPlayerClient({ mediaId, src }: { mediaId: string; src: string }) {
  React.useEffect(() => {
    const onMessage = async (event: MessageEvent<ScormMessage>) => {
      const data = event.data;
      if (!data || data.source !== "fsw-scorm" || data.mediaId !== mediaId) return;
      if (data.type !== "commit" && data.type !== "terminate") return;

      try {
        const response = await fetch("/api/media/scorm/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaId, cmi: data.cmi ?? {} }),
        });
        if (response.ok && data.type === "terminate") {
          toast.success("Progress saved.");
        }
      } catch {
        // Best-effort — the learner isn't blocked by a failed progress ping.
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mediaId]);

  return (
    <iframe
      title="SCORM package"
      src={src}
      sandbox="allow-scripts"
      className="h-[36rem] w-full rounded-lg border border-[var(--border-subtle)] bg-white"
    />
  );
}
