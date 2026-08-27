"use client";

/** Pre-assessment entry flow screens (spec: candidate entry flow). */

import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import { pickMimeType } from "@/lib/client/recording";
import type { AttemptState } from "./types";

export function ScreenFrame({
  step,
  totalSteps,
  children,
}: {
  step: number;
  totalSteps: number;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center p-6">
      <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-navy-400">
        Step {step} of {totalSteps}
      </p>
      <Card className="p-8 sm:p-10">{children}</Card>
      <p className="mt-6 text-center text-xs text-navy-400">
        FSW WorkFit Assessment · Confidential
      </p>
    </main>
  );
}

export function WelcomeScreen({
  state,
  onContinue,
}: {
  state: AttemptState;
  onContinue: () => void;
}) {
  return (
    <div className="text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-fsw-600">
        {state.job.company}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-navy-900">
        FSW WorkFit Assessment
      </h1>
      <p className="mt-1 text-navy-500">
        {state.job.title}
      </p>
      <div className="mt-6 rounded-xl bg-fsw-50 p-4 text-sm text-fsw-900">
        Please reserve approximately <strong>1 hour and 10 minutes</strong> and
        complete the assessment in one uninterrupted sitting.
      </div>
      <ul className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm text-navy-600">
        <li>• Use a desktop or laptop computer with a reliable Internet connection.</li>
        <li>• Choose a quiet environment; set your phone aside.</li>
        <li>• Complete the assessment on your own, without outside assistance.</li>
        <li>• A working webcam is required for the duration of the assessment.</li>
      </ul>
      <p className="mt-6 text-sm text-navy-500">
        This assessment is one part of {state.job.company}&apos;s evaluation
        process. It is not the sole basis for an employment decision.
      </p>
      <Button className="mt-8 w-full" onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

export function IdentifyScreen({
  state,
  busy,
  onSubmit,
}: {
  state: AttemptState;
  busy: boolean;
  onSubmit: (phone: string) => void;
}) {
  const [phone, setPhone] = useState(state.candidate.phone ?? "");
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">Confirm your identity</h2>
      <p className="mt-2 text-sm text-navy-500">
        Please confirm this assessment is assigned to you. Contact your hiring
        representative if any of this is incorrect.
      </p>
      <dl className="mt-6 space-y-3 rounded-xl bg-navy-50 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-navy-500">Name</dt>
          <dd className="font-semibold text-navy-900">
            {state.candidate.firstName} {state.candidate.lastName}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-navy-500">Email</dt>
          <dd className="font-semibold text-navy-900">{state.candidate.email}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-navy-500">Position</dt>
          <dd className="font-semibold text-navy-900">{state.job.title}</dd>
        </div>
      </dl>
      <div className="mt-5">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="For scheduling follow-up only"
          maxLength={30}
        />
      </div>
      <Button className="mt-6 w-full" disabled={busy} onClick={() => onSubmit(phone)}>
        This is me — continue
      </Button>
    </div>
  );
}

export const RULE_ITEMS = [
  "I am the person assigned this assessment.",
  "I will complete the assessment without assistance.",
  "I will not use search engines, AI tools, another person, or a second device.",
  "I understand timed sections cannot be restarted.",
  "I understand webcam video is recorded during the assessment.",
  "I understand the recording is for assessment-integrity purposes.",
  "I understand I should contact FSW before beginning if I need an accommodation.",
];

export function RulesScreen({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (acknowledgments: string[]) => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(RULE_ITEMS.map(() => false));
  const allChecked = checked.every(Boolean);
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">Assessment rules</h2>
      <p className="mt-2 text-sm text-navy-500">
        Please read and acknowledge each item. This keeps the assessment fair
        for every candidate.
      </p>
      <div className="mt-6 space-y-3">
        {RULE_ITEMS.map((item, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-navy-100 p-3 text-sm text-navy-800 hover:bg-navy-50"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-fsw-600"
              checked={checked[i]}
              onChange={(e) => {
                const next = [...checked];
                next[i] = e.target.checked;
                setChecked(next);
              }}
            />
            <span>{item}</span>
          </label>
        ))}
      </div>
      <p className="mt-4 text-xs text-navy-400">
        Also: please do not copy questions, take screenshots, or leave the
        assessment screen during timed sections.
      </p>
      <Button
        className="mt-6 w-full"
        disabled={!allChecked || busy}
        onClick={() => onSubmit(RULE_ITEMS)}
      >
        I acknowledge the rules — continue
      </Button>
    </div>
  );
}

export function AccommodationScreen({
  busy,
  contactEmail,
  onContinue,
}: {
  busy: boolean;
  contactEmail: string | null;
  onContinue: () => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">Accommodations</h2>
      <div className="mt-4 rounded-xl border border-fsw-200 bg-fsw-50 p-4 text-sm leading-relaxed text-fsw-900">
        FSW Group provides reasonable accommodations where required. If you
        need an accommodation that may affect timing, computer use, or the
        webcam requirement, contact the hiring representative before
        beginning.
      </div>
      {contactEmail && (
        <p className="mt-4 text-sm text-navy-600">
          Accommodation contact:{" "}
          <a className="font-semibold text-fsw-700 underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        </p>
      )}
      <p className="mt-4 text-xs text-navy-400">
        You will never be asked to disclose a diagnosis in this application.
      </p>
      <Button className="mt-6 w-full" disabled={busy} onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

const RECORDING_NOTICE_POINTS = [
  "Webcam video will be recorded for the duration of the assessment.",
  "The purpose of the recording is assessment integrity only.",
  "Audio is NOT recorded.",
  "The recording is not scored and does not affect your results in any way.",
  "Your appearance is not evaluated.",
  "No facial recognition, emotion recognition, or biometric identification is performed.",
  "No inference of age, gender, race or ethnicity, disability, gaze, or personality is made from the video.",
  "Only specifically authorized personnel may view the recording, and every viewing is logged.",
  "The recording is retained under the employer's retention policy and then deleted.",
];

export function RecordingConsentScreen({
  busy,
  noticeVersion,
  privacyContact,
  onConsent,
}: {
  busy: boolean;
  noticeVersion: string;
  privacyContact: string | null;
  onConsent: () => void;
}) {
  const [consented, setConsented] = useState(false); // never pre-checked
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">Recording notice</h2>
      <p className="mt-2 text-sm text-navy-500">
        Before we request camera access, please read how the recording works.
      </p>
      <ul className="mt-5 space-y-2 rounded-xl bg-navy-50 p-4 text-sm text-navy-700">
        {RECORDING_NOTICE_POINTS.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="text-fsw-600">•</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {privacyContact && (
        <p className="mt-3 text-xs text-navy-500">
          Privacy questions:{" "}
          <a className="font-semibold text-fsw-700 underline" href={`mailto:${privacyContact}`}>
            {privacyContact}
          </a>
        </p>
      )}
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-navy-200 p-3 text-sm font-medium text-navy-900">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-fsw-600"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
        />
        <span>
          I have read the recording notice and consent to webcam video
          recording for the duration of this assessment.
        </span>
      </label>
      <p className="mt-2 text-right text-[11px] text-navy-300">
        Notice version {noticeVersion}
      </p>
      <Button className="mt-4 w-full" disabled={!consented || busy} onClick={onConsent}>
        I consent — continue
      </Button>
    </div>
  );
}

export function CameraTestScreen({
  busy,
  onReady,
}: {
  busy: boolean;
  onReady: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"idle" | "requesting" | "ok" | "denied" | "unsupported">(
    "idle",
  );
  const [uploadOk, setUploadOk] = useState<boolean | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function testCamera(): Promise<void> {
    if (!pickMimeType()) {
      setPhase("unsupported");
      return;
    }
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      // Verify the application endpoints are reachable before proceeding.
      const ping = await fetch("/api/candidate/state", { credentials: "same-origin" });
      setUploadOk(ping.ok);
      setPhase(stream.active ? "ok" : "denied");
    } catch {
      setPhase("denied");
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">Camera check</h2>
      <p className="mt-2 text-sm text-navy-500">
        We only verify that your camera produces a video stream. Nothing is
        analyzed, and nothing is recorded yet.
      </p>
      <div className="mt-5 overflow-hidden rounded-xl bg-navy-900">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className="mx-auto aspect-video w-full max-w-md object-cover"
        />
      </div>
      {phase === "idle" && (
        <Button className="mt-5 w-full" onClick={testCamera}>
          Test my camera
        </Button>
      )}
      {phase === "requesting" && (
        <p className="mt-5 text-center text-sm text-navy-500">
          Waiting for camera permission…
        </p>
      )}
      {phase === "denied" && (
        <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          We could not access your camera. Please allow camera access in your
          browser&apos;s address bar, make sure no other application is using
          the camera, then try again.
          <Button variant="secondary" className="mt-3 w-full" onClick={testCamera}>
            Try again
          </Button>
        </div>
      )}
      {phase === "unsupported" && (
        <div className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-900">
          This browser cannot record video. Please use a current version of
          Chrome, Edge, or Safari on a desktop or laptop computer.
        </div>
      )}
      {phase === "ok" && (
        <div className="mt-5">
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            ✓ Camera is working{uploadOk === false ? " — but we could not reach the server. Check your connection." : " and the connection checks out."}
          </div>
          <Button
            className="mt-4 w-full"
            disabled={busy || uploadOk === false}
            onClick={onReady}
          >
            Camera looks good — continue
          </Button>
        </div>
      )}
    </div>
  );
}

export function RecoveryScreen({
  state,
  busy,
  onContinue,
}: {
  state: AttemptState;
  busy: boolean;
  onContinue: () => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">Your Record ID</h2>
      <p className="mt-2 text-sm text-navy-500">
        If anything interrupts your assessment, this ID helps our team find
        your session. Please write it down or take note of it now.
      </p>
      <div className="mt-6 rounded-xl border-2 border-dashed border-fsw-300 bg-fsw-50 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
          Record ID
        </p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wider text-navy-900">
          {state.recordId}
        </p>
      </div>
      <p className="mt-4 text-sm text-navy-500">
        If you lose your session, reopen your invitation link and choose
        &ldquo;Email me a resume link&rdquo;. A secure link will be sent to{" "}
        <strong>{state.candidate.email}</strong> and will return you exactly
        where you left off.
      </p>
      <Button className="mt-6 w-full" disabled={busy} onClick={onContinue}>
        I&apos;ve saved my Record ID — continue
      </Button>
    </div>
  );
}

export function InstructionsScreen({
  state,
  busy,
  onBegin,
}: {
  state: AttemptState;
  busy: boolean;
  onBegin: () => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy-900">How the assessment works</h2>
      <ul className="mt-5 space-y-3 text-sm text-navy-700">
        <li className="flex gap-2"><span className="text-fsw-600">•</span> The assessment has {state.sections.length} sections. Some are untimed; several are timed.</li>
        <li className="flex gap-2"><span className="text-fsw-600">•</span> A section&apos;s timer begins only when you confirm you are ready to start it.</li>
        <li className="flex gap-2"><span className="text-fsw-600">•</span> Once a timed section begins, its timer cannot be paused or restarted.</li>
        <li className="flex gap-2"><span className="text-fsw-600">•</span> Questions left unanswered when time expires are recorded as unanswered.</li>
        <li className="flex gap-2"><span className="text-fsw-600">•</span> Refreshing your browser does not restart time. Losing your Internet connection does not restart time.</li>
        <li className="flex gap-2"><span className="text-fsw-600">•</span> Your answers save automatically as you go.</li>
      </ul>
      <div className="mt-5 rounded-lg bg-navy-50 p-3 text-xs text-navy-500">
        {state.cameraExempt
          ? "A camera exemption is on file for this attempt; recording is disabled."
          : "Recording begins when you select Begin Assessment and continues until you finish."}
      </div>
      <Button className="mt-6 w-full" disabled={busy} onClick={onBegin}>
        Begin Assessment
      </Button>
    </div>
  );
}

export function CompletionScreen() {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">
        ✓
      </div>
      <h1 className="mt-4 text-3xl font-bold text-navy-900">Assessment Complete</h1>
      <p className="mx-auto mt-4 max-w-md text-navy-600">
        Thank you. Your assessment has been submitted successfully. Your hiring
        contact will follow up regarding next steps.
      </p>
      <p className="mt-6 text-sm text-navy-400">You may now close this window.</p>
    </div>
  );
}

export function MobileBlockScreen() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center p-6">
      <Card className="p-8 text-center">
        <h1 className="text-2xl font-bold text-navy-900">
          Please switch to a laptop or desktop
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-navy-600">
          This assessment must be completed from a laptop or desktop computer.
          Several sections are timed, and screen size and input method can
          materially affect the experience — completing it on a phone or
          tablet would not give you a fair opportunity to show your best work.
        </p>
        <p className="mt-4 text-sm text-navy-600">
          Please reopen your invitation link on a computer. If you need an
          accommodation, contact your hiring representative — administrators
          can approve an accessibility exception.
        </p>
      </Card>
    </main>
  );
}
