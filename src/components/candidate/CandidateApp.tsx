"use client";

/**
 * Candidate application shell: entry flow → assessment runner → completion.
 * Handles device gating, recording lifecycle, integrity event listeners,
 * offline detection, and resume.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { RecordingManager, type RecordingStatus } from "@/lib/client/recording";
import { Button, Card } from "@/components/ui";
import {
  AccommodationScreen,
  CameraTestScreen,
  IdentifyScreen,
  InstructionsScreen,
  MobileBlockScreen,
  RecordingConsentScreen,
  RecoveryScreen,
  RulesScreen,
  ScreenFrame,
  WelcomeScreen,
} from "./EntryScreens";
import { SectionRunner } from "./SectionRunner";
import { CompletionFlow } from "./CompletionFlow";
import type { AttemptState, QuestionPayload, SectionState } from "./types";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "resume_required"; recordId: string }
  | { kind: "entry"; state: AttemptState }
  | { kind: "section_intro"; state: AttemptState; section: SectionState }
  | {
      kind: "section_running";
      state: AttemptState;
      section: SectionState;
      questions: QuestionPayload[];
      remainingSeconds: number | null;
    }
  | { kind: "submitting"; state: AttemptState }
  | { kind: "completed"; state: AttemptState | null };

const ENTRY_ORDER = [
  "welcome",
  "identify",
  "rules",
  "accommodation",
  "recording_consent",
  "camera_test",
  "recovery",
  "instructions",
];

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
  const smallScreen =
    typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 640;
  const coarse =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches &&
    !window.matchMedia?.("(pointer: fine)").matches;
  return uaMobile || (smallScreen && Boolean(coarse));
}

export function CandidateApp({
  invitationToken,
  resumeToken,
}: {
  invitationToken?: string;
  resumeToken?: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [mobileBlocked, setMobileBlocked] = useState(false);
  const [recStatus, setRecStatus] = useState<RecordingStatus>("idle");
  const [cameraOverlay, setCameraOverlay] = useState(false);
  const recorderRef = useRef<RecordingManager | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendEvent = useCallback((type: string, meta?: Record<string, string>) => {
    void api("/api/candidate/event", { body: { type, meta } }).catch(() => undefined);
  }, []);

  const recorder = useMemo(
    () =>
      new RecordingManager({
        onStatusChange: (s) => {
          setRecStatus(s);
          if (s === "interrupted") {
            // Grace period before the blocking overlay (timers keep running).
            overlayTimerRef.current = setTimeout(() => setCameraOverlay(true), 15_000);
          } else {
            if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
            setCameraOverlay(false);
          }
        },
        onIntegrityEvent: (type) => sendEvent(type),
      }),
    [sendEvent],
  );
  recorderRef.current = recorder;

  // ---- initial load ------------------------------------------------------------
  useEffect(() => {
    if (isMobileDevice()) {
      setMobileBlocked(true);
      return;
    }
    void (async () => {
      try {
        if (resumeToken) {
          const { state } = await api<{ state: AttemptState }>(
            "/api/candidate/resume",
            { body: { resumeToken } },
          );
          routeFromState(state, true);
        } else if (invitationToken) {
          const res = await api<{
            state?: AttemptState;
            resumeRequired?: boolean;
            recordId?: string;
            alreadyCompleted?: boolean;
          }>("/api/candidate/open", { body: { token: invitationToken } });
          if (res.alreadyCompleted) {
            // Same browser → the attempt cookie still resolves, which lets us
            // offer the optional post-submission steps. A different browser
            // just gets the confirmation.
            const state = await api<{ state: AttemptState }>(
              "/api/candidate/state",
              { method: "GET" },
            )
              .then((r) => r.state)
              .catch(() => null);
            setPhase({ kind: "completed", state });
          } else if (res.resumeRequired) {
            setPhase({ kind: "resume_required", recordId: res.recordId ?? "" });
          } else if (res.state) routeFromState(res.state, false);
        } else {
          setPhase({ kind: "error", message: "Missing assessment link." });
        }
      } catch (err) {
        setPhase({
          kind: "error",
          message:
            err instanceof ApiError
              ? err.message
              : "We could not load your assessment. Please try again.",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const routeFromState = useCallback((state: AttemptState, isResume: boolean) => {
    if (state.status === "COMPLETED") {
      setPhase({ kind: "completed", state });
      return;
    }
    if (state.status === "IN_PROGRESS") {
      if (isResume) {
        // Log the refresh/reconnect (objective event; no penalty implied).
        void api("/api/candidate/event", { body: { type: "PAGE_REFRESH" } }).catch(
          () => undefined,
        );
      }
      const current = state.sections.find(
        (s) => s.status === "IN_PROGRESS" || s.status === "PENDING",
      );
      if (!current) {
        setPhase({ kind: "submitting", state });
        void submitAssessment(state);
        return;
      }
      if (current.status === "IN_PROGRESS") {
        void openSection(state, current.key);
      } else {
        setPhase({ kind: "section_intro", state, section: current });
      }
      void ensureRecording(state);
      return;
    }
    setPhase({ kind: "entry", state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- integrity + connectivity listeners ---------------------------------------
  useEffect(() => {
    const inAssessment = () =>
      phase.kind === "section_running" || phase.kind === "section_intro";
    const onVisibility = () => {
      if (!inAssessment()) return;
      sendEvent(document.hidden ? "TAB_HIDDEN" : "TAB_VISIBLE");
    };
    const onBlur = () => inAssessment() && sendEvent("WINDOW_BLUR");
    const onFocus = () => inAssessment() && sendEvent("WINDOW_FOCUS");
    const onOffline = () => {
      setOffline(true);
      sendEvent("DISCONNECTED");
    };
    const onOnline = () => {
      setOffline(false);
      sendEvent("RECONNECTED");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [phase.kind, sendEvent]);

  // ---- helpers -------------------------------------------------------------------
  async function refreshState(): Promise<AttemptState> {
    const { state } = await api<{ state: AttemptState }>("/api/candidate/state");
    return state;
  }

  async function entryAction(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      const { state } = await api<{ state: AttemptState }>("/api/candidate/entry", {
        body,
      });
      setPhase({ kind: "entry", state });
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function ensureRecording(state: AttemptState): Promise<void> {
    if (state.cameraExempt) return;
    const rec = recorderRef.current!;
    if (rec.status === "recording") return;
    try {
      await rec.start();
    } catch {
      sendEvent("CAMERA_INTERRUPTED", { detail: "failed_to_start" });
      setCameraOverlay(true);
    }
  }

  async function beginAssessment(state: AttemptState): Promise<void> {
    setBusy(true);
    try {
      if (!state.cameraExempt) {
        await recorderRef.current!.start();
      }
      const { state: next } = await api<{ state: AttemptState }>(
        "/api/candidate/begin",
        { body: {} },
      );
      const first = next.sections.find((s) => s.status === "PENDING");
      if (first) setPhase({ kind: "section_intro", state: next, section: first });
    } catch (err) {
      alert(
        err instanceof ApiError
          ? err.message
          : "Your camera could not be started. Please check camera access and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openSection(state: AttemptState, key: string): Promise<void> {
    setBusy(true);
    try {
      const res = await api<{
        section: { key: string; remainingSeconds: number | null };
        questions: QuestionPayload[];
      }>("/api/candidate/section/start", { body: { sectionKey: key } });
      const sectionMeta = state.sections.find((s) => s.key === key)!;
      setPhase({
        kind: "section_running",
        state,
        section: sectionMeta,
        questions: res.questions,
        remainingSeconds: res.section.remainingSeconds,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Section already closed — move on.
        const fresh = await refreshState();
        routeFromState(fresh, false);
      } else {
        alert(err instanceof ApiError ? err.message : "Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSectionDone(section: SectionState): Promise<void> {
    try {
      const { state } = await api<{ state: AttemptState }>(
        "/api/candidate/section/complete",
        { body: { sectionKey: section.key } },
      );
      const next = state.sections.find(
        (s) => s.status === "PENDING" || s.status === "IN_PROGRESS",
      );
      if (next) {
        setPhase({ kind: "section_intro", state, section: next });
      } else {
        setPhase({ kind: "submitting", state });
        await submitAssessment(state);
      }
    } catch {
      const fresh = await refreshState().catch(() => null);
      if (fresh) routeFromState(fresh, false);
    }
  }

  async function submitAssessment(state: AttemptState): Promise<void> {
    try {
      if (!state.cameraExempt) {
        await recorderRef.current!.stop("completed");
      }
      await api("/api/candidate/complete", { body: {} });
      setPhase({ kind: "completed", state });
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof ApiError
            ? err.message
            : "We could not finalize your assessment. Please contact your hiring representative with your Record ID.",
      });
    }
  }

  // ---- render ----------------------------------------------------------------------
  if (mobileBlocked) return <MobileBlockScreen />;

  if (phase.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-navy-400">Loading your assessment…</p>
      </main>
    );
  }

  if (phase.kind === "error") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-bold text-navy-900">
            We hit a problem
          </h1>
          <p className="mt-3 text-sm text-navy-600">{phase.message}</p>
        </Card>
      </main>
    );
  }

  if (phase.kind === "resume_required") {
    return (
      <ResumeRequired invitationToken={invitationToken} recordId={phase.recordId} />
    );
  }

  if (phase.kind === "completed") {
    return (
      <ScreenFrame plain step={1} totalSteps={1}>
        <CompletionFlow state={phase.state} />
      </ScreenFrame>
    );
  }

  if (phase.kind === "submitting") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="p-10 text-center">
          <h2 className="text-xl font-bold text-navy-900">Submitting your assessment…</h2>
          <p className="mt-2 text-sm text-navy-500">
            Finalizing your responses and recording. Please keep this window open.
          </p>
        </Card>
      </main>
    );
  }

  if (phase.kind === "entry") {
    const state = phase.state;
    const step = state.entryStep;
    const stepIndex = Math.max(0, ENTRY_ORDER.indexOf(step));
    const skipRecording = state.cameraExempt;
    const frame = (children: React.ReactNode) => (
      <ScreenFrame step={stepIndex + 1} totalSteps={ENTRY_ORDER.length}>
        {children}
      </ScreenFrame>
    );

    switch (step) {
      case "welcome":
        return frame(
          <WelcomeScreen
            state={state}
            onContinue={() =>
              setPhase({ kind: "entry", state: { ...state, entryStep: "identify" } })
            }
          />,
        );
      case "identify":
        return frame(
          <IdentifyScreen
            state={state}
            busy={busy}
            onSubmit={(phone) =>
              void entryAction({ step: "identify", phone: phone || undefined, confirmed: true })
            }
          />,
        );
      case "rules":
        return frame(
          <RulesScreen
            busy={busy}
            onSubmit={(acks) =>
              void entryAction({ step: "rules", acknowledgments: acks, consented: true })
            }
          />,
        );
      case "accommodation":
        return frame(
          <AccommodationScreen
            busy={busy}
            contactEmail={state.accommodationContactEmail}
            onContinue={() => void entryAction({ step: "accommodation_ack" })}
          />,
        );
      case "recording_consent":
        if (skipRecording) {
          void entryAction({ step: "camera_ready" });
          return frame(<p className="text-center text-navy-400">Continuing…</p>);
        }
        return frame(
          <RecordingConsentScreen
            busy={busy}
            noticeVersion={state.recordingNoticeVersion}
            privacyContact={state.privacyContactEmail}
            onConsent={() =>
              void entryAction({
                step: "recording_consent",
                consented: true,
                noticeVersion: state.recordingNoticeVersion,
              })
            }
          />,
        );
      case "camera_test":
        if (skipRecording) {
          void entryAction({ step: "camera_ready" });
          return frame(<p className="text-center text-navy-400">Continuing…</p>);
        }
        return frame(
          <CameraTestScreen
            busy={busy}
            onReady={() => void entryAction({ step: "camera_ready" })}
          />,
        );
      case "recovery":
        return frame(
          <RecoveryScreen
            state={state}
            busy={busy}
            onContinue={() => void entryAction({ step: "recovery_ack" })}
          />,
        );
      case "instructions":
        return frame(
          <InstructionsScreen
            state={state}
            busy={busy}
            onBegin={() => void beginAssessment(state)}
          />,
        );
      default:
        return frame(
          <WelcomeScreen
            state={state}
            onContinue={() =>
              setPhase({ kind: "entry", state: { ...state, entryStep: "identify" } })
            }
          />,
        );
    }
  }

  // ---- assessment surface (intro or running) -----------------------------------
  const state = phase.state;
  const sectionNumber =
    phase.kind === "section_intro" || phase.kind === "section_running"
      ? state.sections.findIndex((s) => s.key === phase.section.key) + 1
      : 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4 sm:p-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
            FSW Talent Scout
          </p>
          <p className="text-sm font-semibold text-navy-900">
            Section {sectionNumber} of {state.sections.length}
          </p>
        </div>
        {!state.cameraExempt && (
          <div
            aria-live="polite"
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
              recStatus === "recording"
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                recStatus === "recording" ? "animate-pulse bg-red-600" : "bg-amber-500"
              }`}
            />
            {recStatus === "recording" ? "Recording" : "Camera issue"}
          </div>
        )}
      </header>

      {phase.kind === "section_intro" && (
        <Card className="p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
            Section {sectionNumber} of {state.sections.length}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-navy-900">
            {phase.section.title}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-navy-600">
            {phase.section.instructions}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-navy-100 px-3 py-1 font-semibold text-navy-700">
              {phase.section.questionCount} questions
            </span>
            {phase.section.timed && phase.section.durationSeconds ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                Timed — {Math.round(phase.section.durationSeconds / 60)} minutes
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                Untimed
              </span>
            )}
          </div>
          {phase.section.timed && (
            <p className="mt-4 text-sm text-navy-500">
              The timer starts when you select the button below and cannot be
              paused. Make sure you are ready.
            </p>
          )}
          <Button
            className="mt-6 w-full"
            disabled={busy}
            onClick={() => void openSection(state, phase.section.key)}
          >
            {phase.section.timed ? "I'm ready — start the timer" : "Start section"}
          </Button>
        </Card>
      )}

      {phase.kind === "section_running" && (
        <SectionRunner
          key={phase.section.key}
          section={phase.section}
          serverRemainingSeconds={phase.remainingSeconds}
          questions={phase.questions}
          offline={offline}
          onSectionDone={() => void onSectionDone(phase.section)}
        />
      )}

      {cameraOverlay && !state.cameraExempt && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Camera connection lost"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/80 p-6"
        >
          <Card className="max-w-md p-8 text-center">
            <h2 className="text-xl font-bold text-navy-900">
              Your camera connection was interrupted
            </h2>
            <p className="mt-3 text-sm text-navy-600">
              Please reconnect your camera to continue. Section timers continue
              to run while the camera is disconnected.
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() =>
                void recorderRef.current!
                  .restore()
                  .then(() => setCameraOverlay(false))
                  .catch(() =>
                    alert(
                      "We still can't reach your camera. Check that it is connected and allowed in your browser.",
                    ),
                  )
              }
            >
              Reconnect camera
            </Button>
          </Card>
        </div>
      )}
    </main>
  );
}

function ResumeRequired({
  invitationToken,
  recordId,
}: {
  invitationToken?: string;
  recordId: string;
}) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
      <Card className="p-8 text-center">
        <h1 className="text-xl font-bold text-navy-900">Resume your assessment</h1>
        <p className="mt-3 text-sm text-navy-600">
          An assessment is already in progress for this invitation
          {recordId ? (
            <>
              {" "}
              (Record ID <span className="font-mono font-bold">{recordId}</span>)
            </>
          ) : null}
          . To protect your session, we&apos;ll email a secure resume link to
          the address on file.
        </p>
        {sent ? (
          <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            If your assessment is on file, a resume link has been emailed to you.
            Please check your inbox.
          </p>
        ) : (
          <Button
            className="mt-5 w-full"
            disabled={busy || !invitationToken}
            onClick={() => {
              setBusy(true);
              void api("/api/candidate/resume", {
                method: "PUT",
                body: { invitationToken },
              })
                .then(() => setSent(true))
                .finally(() => setBusy(false));
            }}
          >
            Email me a resume link
          </Button>
        )}
      </Card>
    </main>
  );
}
