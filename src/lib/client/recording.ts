"use client";

/**
 * Webcam recording manager.
 *
 * - Video only (audio is never requested).
 * - MediaRecorder with ~10-second chunks.
 * - Chunks queue in IndexedDB and upload directly to object storage via
 *   short-lived signed URLs, with exponential-backoff retry.
 * - Emits objective interruption events; performs NO analysis of the video.
 *
 * There is deliberately no face detection, face matching, emotion inference,
 * gaze tracking, or any biometric processing here or anywhere else in the
 * application. The stream is captured, chunked, and uploaded — nothing more.
 */

import { api } from "./api";
import {
  enqueueChunk,
  peekChunks,
  pendingChunkCount,
  removeChunk,
} from "./chunk-queue";

const CHUNK_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export type RecordingStatus =
  | "idle"
  | "recording"
  | "interrupted"
  | "stopped"
  | "error";

export interface RecordingCallbacks {
  onStatusChange?: (status: RecordingStatus) => void;
  onIntegrityEvent?: (type: "CAMERA_INTERRUPTED" | "CAMERA_RESTORED") => void;
}

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
}

export class RecordingManager {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private sessionId: string | null = null;
  private sequence = 0;
  private chunkStartedAt = new Date().toISOString();
  private uploading = false;
  private stopped = false;
  private callbacks: RecordingCallbacks;
  status: RecordingStatus = "idle";

  constructor(callbacks: RecordingCallbacks = {}) {
    this.callbacks = callbacks;
  }

  private setStatus(status: RecordingStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  /** Acquire the camera (video only) — used by preflight and start. */
  async acquireStream(): Promise<MediaStream> {
    if (this.stream?.active) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
      audio: false,
    });
    return this.stream;
  }

  async start(): Promise<void> {
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error("This browser cannot record video.");
    const stream = await this.acquireStream();

    const { sessionId } = await api<{ sessionId: string }>(
      "/api/candidate/recording/start",
      { body: { mimeType: mimeType.split(";")[0] } },
    );
    this.sessionId = sessionId;
    this.sequence = 0;
    this.stopped = false;
    this.chunkStartedAt = new Date().toISOString();

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 400_000,
    });
    this.recorder = recorder;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0 && this.sessionId) {
        const endedAt = new Date().toISOString();
        void enqueueChunk({
          key: `${this.sessionId}:${this.sequence}`,
          sessionId: this.sessionId,
          sequence: this.sequence,
          blob: e.data,
          startedAt: this.chunkStartedAt,
          endedAt,
        }).then(() => this.pumpUploads());
        this.sequence++;
        this.chunkStartedAt = endedAt;
      }
    };

    for (const track of stream.getVideoTracks()) {
      track.onended = () => this.handleInterruption();
      track.onmute = () => this.handleInterruption();
    }
    if (navigator.mediaDevices) {
      navigator.mediaDevices.ondevicechange = () => {
        if (!this.stream?.active) this.handleInterruption();
      };
    }

    recorder.start(CHUNK_MS);
    this.setStatus("recording");
    void this.pumpUploads();
  }

  private handleInterruption(): void {
    if (this.stopped || this.status !== "recording") return;
    this.setStatus("interrupted");
    this.callbacks.onIntegrityEvent?.("CAMERA_INTERRUPTED");
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {
      // recorder already dead
    }
    if (this.sessionId) {
      const expected = this.sequence;
      void api("/api/candidate/recording/stop", {
        body: { sessionId: this.sessionId, expectedChunks: expected, reason: "camera_lost" },
      }).catch(() => undefined);
      this.sessionId = null;
    }
  }

  /** Attempt to restore the camera after an interruption (new session). */
  async restore(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.start();
    this.callbacks.onIntegrityEvent?.("CAMERA_RESTORED");
  }

  /** Upload loop: drain the IndexedDB queue with backoff on failure. */
  private async pumpUploads(): Promise<void> {
    if (this.uploading) return;
    this.uploading = true;
    let backoff = 1000;
    try {
      for (;;) {
        const batch = await peekChunks(3);
        if (batch.length === 0) break;
        let failed = false;
        for (const chunk of batch) {
          try {
            const { uploadUrl } = await api<{ uploadUrl: string }>(
              "/api/candidate/recording/chunk-url",
              { body: { sessionId: chunk.sessionId, sequence: chunk.sequence } },
            );
            const put = await fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": chunk.blob.type || "video/webm" },
              body: chunk.blob,
            });
            if (!put.ok) throw new Error(`upload failed: ${put.status}`);
            await api("/api/candidate/recording/chunk-complete", {
              body: {
                sessionId: chunk.sessionId,
                sequence: chunk.sequence,
                sizeBytes: chunk.blob.size,
                startedAt: chunk.startedAt,
                endedAt: chunk.endedAt,
              },
            });
            await removeChunk(chunk.key);
            backoff = 1000;
          } catch {
            failed = true;
            break;
          }
        }
        if (failed) {
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        }
      }
    } finally {
      this.uploading = false;
    }
  }

  /** Stop recording, flush the queue, and finalize the manifest. */
  async stop(reason: "completed" | "exited" = "completed"): Promise<void> {
    this.stopped = true;
    const sessionId = this.sessionId;
    const recorder = this.recorder;

    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try {
          recorder.stop(); // flushes the final partial chunk
        } catch {
          resolve();
        }
      });
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    // Give queued uploads a bounded window to drain.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await this.pumpUploads();
      if ((await pendingChunkCount()) === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (sessionId) {
      await api("/api/candidate/recording/stop", {
        body: { sessionId, expectedChunks: this.sequence, reason },
      }).catch(() => undefined);
      this.sessionId = null;
    }
    this.setStatus("stopped");
  }

  getStream(): MediaStream | null {
    return this.stream;
  }
}
