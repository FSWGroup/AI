"use client";

/**
 * Runs one assessment section:
 *  - server-authoritative countdown (deadline = now + server remainingSeconds)
 *  - autosave with an offline retry queue (answers survive disconnects)
 *  - memory study cards with fixed study time
 *  - Likert pages (groups of 5) for statement sections, one-at-a-time for
 *    cognitive sections
 *  - accessible timer warnings at sensible intervals
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Button, Card, ProgressBar } from "@/components/ui";
import { LIKERT_LABELS, type QuestionPayload, type SectionState } from "./types";

interface PendingSave {
  attemptQuestionId: string;
  value: number;
  responseTimeMs?: number;
}

const QUEUE_KEY = "fsw_pending_saves";

function loadQueue(): PendingSave[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as PendingSave[];
  } catch {
    return [];
  }
}
function storeQueue(queue: PendingSave[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage unavailable — server retry loop still covers us.
  }
}

export function SectionRunner({
  section,
  serverRemainingSeconds,
  questions,
  offline,
  onSectionDone,
}: {
  section: SectionState;
  serverRemainingSeconds: number | null;
  questions: QuestionPayload[];
  offline: boolean;
  onSectionDone: () => void;
}) {
  const deadlineRef = useRef<number | null>(
    serverRemainingSeconds !== null ? Date.now() + serverRemainingSeconds * 1000 : null,
  );
  const [remaining, setRemaining] = useState<number | null>(serverRemainingSeconds);
  const [expired, setExpired] = useState(false);
  const [answers, setAnswers] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const q of questions) {
      if (q.answeredValue !== null) m.set(q.id, q.answeredValue);
    }
    return m;
  });
  const [warning, setWarning] = useState<string | null>(null);
  const announcedRef = useRef<Set<number>>(new Set());
  const viewStartRef = useRef<number>(Date.now());
  const queueRef = useRef<PendingSave[]>([]);
  const flushingRef = useRef(false);

  const isLikert = section.key === "BEHAVIORAL" || section.key === "MECHANICAL_INTEREST";

  // Study cards must be consumed in order before the questions behind them.
  const [cursor, setCursor] = useState(() => {
    const firstUn = questions.findIndex(
      (q) => q.answeredValue === null,
    );
    return firstUn === -1 ? questions.length - 1 : firstUn;
  });

  // ---- countdown (derived from the server deadline, never client-extended) --
  useEffect(() => {
    if (deadlineRef.current === null) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((deadlineRef.current! - Date.now()) / 1000));
      setRemaining(secs);
      const points = [300, 120, 60, 30];
      for (const p of points) {
        if (secs === p && !announcedRef.current.has(p)) {
          announcedRef.current.add(p);
          setWarning(
            p >= 60 ? `${p / 60} minute${p > 60 ? "s" : ""} remaining` : `${p} seconds remaining`,
          );
          setTimeout(() => setWarning(null), 5000);
        }
      }
      if (secs <= 0) setExpired(true);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  // ---- expiration: lock and advance ----------------------------------------
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(() => onSectionDone(), 2500);
    return () => clearTimeout(t);
  }, [expired, onSectionDone]);

  // ---- autosave queue --------------------------------------------------------
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current[0];
        try {
          await api("/api/candidate/response", { body: item });
          queueRef.current.shift();
          storeQueue(queueRef.current);
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === 409 || status === 422) {
            // Section closed or invalid — drop rather than loop forever.
            queueRef.current.shift();
            storeQueue(queueRef.current);
          } else {
            break; // network trouble: retry later
          }
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  useEffect(() => {
    queueRef.current = loadQueue();
    void flushQueue();
    const id = setInterval(() => void flushQueue(), 4000);
    return () => clearInterval(id);
  }, [flushQueue]);

  const saveAnswer = useCallback(
    (questionId: string, value: number) => {
      setAnswers((prev) => new Map(prev).set(questionId, value));
      const item: PendingSave = {
        attemptQuestionId: questionId,
        value,
        responseTimeMs: Math.min(3_600_000, Date.now() - viewStartRef.current),
      };
      queueRef.current = [
        ...queueRef.current.filter((p) => p.attemptQuestionId !== questionId),
        item,
      ];
      storeQueue(queueRef.current);
      void flushQueue();
    },
    [flushQueue],
  );

  // ---- section finished? ------------------------------------------------------
  const scorable = useMemo(
    () => questions.filter((q) => q.kind !== "MEMORY_STUDY"),
    [questions],
  );
  const answeredCount = scorable.filter((q) => answers.has(q.id)).length;
  const allAnswered = answeredCount === scorable.length;

  async function finishSection(): Promise<void> {
    await flushQueue();
    onSectionDone();
  }

  // ---- render -----------------------------------------------------------------
  const timerDisplay =
    remaining !== null ? (
      <div
        aria-live="polite"
        className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${
          remaining <= 60 ? "bg-red-100 text-red-800" : "bg-navy-100 text-navy-800"
        }`}
      >
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      </div>
    ) : (
      <span className="text-xs font-semibold uppercase tracking-wide text-navy-400">
        Untimed
      </span>
    );

  if (expired) {
    return (
      <Card className="p-10 text-center">
        <h2 className="text-xl font-bold text-navy-900">Time is up for this section</h2>
        <p className="mt-2 text-sm text-navy-500">
          Your saved answers have been recorded. Moving to the next section…
        </p>
      </Card>
    );
  }

  return (
    <div
      className="select-none"
      onCopy={(e) => {
        e.preventDefault();
        void api("/api/candidate/event", {
          body: { type: "COPY_ATTEMPT", meta: { sectionKey: section.key } },
        }).catch(() => undefined);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        void api("/api/candidate/event", {
          body: { type: "CONTEXT_MENU_BLOCKED", meta: { sectionKey: section.key } },
        }).catch(() => undefined);
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-navy-900">{section.title}</p>
          <p className="text-xs text-navy-400">
            {answeredCount} of {scorable.length} answered
          </p>
        </div>
        {timerDisplay}
      </div>
      <ProgressBar value={answeredCount} max={scorable.length} label="Section progress" />

      {warning && (
        <div
          role="alert"
          className="mt-3 rounded-lg bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900"
        >
          {warning}
        </div>
      )}
      {offline && (
        <div role="alert" className="mt-3 rounded-lg bg-navy-800 px-4 py-2 text-center text-sm text-white">
          Connection lost. Your responses are saved locally and will synchronize
          when the connection returns. Timers continue to run.
        </div>
      )}

      <div className="mt-5">
        {isLikert ? (
          <LikertPager
            questions={scorable}
            answers={answers}
            onAnswer={saveAnswer}
            onDone={finishSection}
          />
        ) : (
          <SequentialRunner
            questions={questions}
            cursor={cursor}
            setCursor={(c) => {
              viewStartRef.current = Date.now();
              setCursor(c);
            }}
            answers={answers}
            onAnswer={saveAnswer}
            onDone={finishSection}
            allAnswered={allAnswered}
            mono={section.key === "NUMERICAL_PERCEPTION"}
          />
        )}
      </div>
    </div>
  );
}

/** Behavioral / mechanical statements: pages of 5 on a 5-point scale. */
function LikertPager({
  questions,
  answers,
  onAnswer,
  onDone,
}: {
  questions: QuestionPayload[];
  answers: Map<string, number>;
  onAnswer: (id: string, value: number) => void;
  onDone: () => void;
}) {
  const PAGE = 5;
  const [page, setPage] = useState(() => {
    const firstUn = questions.findIndex((q) => q.answeredValue === null);
    return firstUn === -1 ? 0 : Math.floor(firstUn / PAGE);
  });
  const pages = Math.ceil(questions.length / PAGE);
  const slice = questions.slice(page * PAGE, page * PAGE + PAGE);
  const sliceDone = slice.every((q) => answers.has(q.id));
  const allDone = questions.every((q) => answers.has(q.id));

  return (
    <div>
      <Card className="divide-y divide-navy-100">
        {slice.map((q) => (
          <fieldset key={q.id} className="p-5">
            <legend className="text-[15px] font-medium leading-relaxed text-navy-900">
              {q.prompt}
            </legend>
            <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-5">
              {LIKERT_LABELS.map((label, value) => {
                const selected = answers.get(q.id) === value;
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors ${
                      selected
                        ? "border-fsw-600 bg-fsw-600 text-white"
                        : "border-navy-200 bg-white text-navy-700 hover:bg-navy-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      className="sr-only"
                      checked={selected}
                      onChange={() => onAnswer(q.id, value)}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </Card>
      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="secondary"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Back
        </Button>
        <span className="text-xs text-navy-400">
          Page {page + 1} of {pages}
        </span>
        {page < pages - 1 ? (
          <Button disabled={!sliceDone} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        ) : (
          <Button disabled={!allDone} onClick={onDone}>
            Finish section
          </Button>
        )}
      </div>
    </div>
  );
}

/** Cognitive sections: one question at a time (with study-card support). */
function SequentialRunner({
  questions,
  cursor,
  setCursor,
  answers,
  onAnswer,
  onDone,
  allAnswered,
  mono,
}: {
  questions: QuestionPayload[];
  cursor: number;
  setCursor: (c: number) => void;
  answers: Map<string, number>;
  onAnswer: (id: string, value: number) => void;
  onDone: () => void;
  allAnswered: boolean;
  mono?: boolean;
}) {
  const q = questions[cursor];
  const [studyLeft, setStudyLeft] = useState<number | null>(null);

  useEffect(() => {
    if (q?.kind !== "MEMORY_STUDY") {
      setStudyLeft(null);
      return;
    }
    let left = q.studySeconds ?? 60;
    setStudyLeft(left);
    const id = setInterval(() => {
      left -= 1;
      setStudyLeft(left);
      if (left <= 0) {
        clearInterval(id);
        onAnswer(q.id, 0); // marks the card consumed server-side (unscored)
        setCursor(Math.min(questions.length - 1, cursor + 1));
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id]);

  if (!q) return null;

  if (q.kind === "MEMORY_STUDY") {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-fsw-600">
            Study this information
          </p>
          <span className="rounded-full bg-navy-100 px-3 py-1 font-mono text-sm font-bold text-navy-800">
            {studyLeft ?? q.studySeconds}s
          </span>
        </div>
        <p className="mt-2 text-xs text-navy-400">
          You will be asked about this later in the section. It will not be
          shown again.
        </p>
        <div className="mt-4 whitespace-pre-wrap rounded-xl bg-navy-50 p-5 text-[15px] leading-relaxed text-navy-900">
          {q.prompt}
        </div>
        <Button
          className="mt-5 w-full"
          variant="secondary"
          onClick={() => {
            onAnswer(q.id, 0);
            setCursor(Math.min(questions.length - 1, cursor + 1));
          }}
        >
          I&apos;m ready — continue
        </Button>
      </Card>
    );
  }

  const selected = answers.get(q.id);
  const scorableIndex =
    questions.slice(0, cursor + 1).filter((x) => x.kind !== "MEMORY_STUDY").length;
  const scorableTotal = questions.filter((x) => x.kind !== "MEMORY_STUDY").length;
  const isLast = cursor === questions.length - 1;
  const prevIsStudy = cursor > 0 && questions[cursor - 1].kind === "MEMORY_STUDY";

  return (
    <Card className="p-6">
      <p className="text-xs font-semibold text-navy-400">
        Question {scorableIndex} of {scorableTotal}
      </p>
      <p
        className={`mt-3 whitespace-pre-wrap text-[17px] font-medium leading-relaxed text-navy-900 ${
          mono ? "font-mono tracking-wide" : ""
        }`}
      >
        {q.prompt}
      </p>
      <div className="mt-5 space-y-2">
        {(q.choices ?? []).map((choice, value) => (
          <label
            key={value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-[15px] transition-colors ${
              selected === value
                ? "border-fsw-600 bg-fsw-50 text-navy-900"
                : "border-navy-200 bg-white text-navy-800 hover:bg-navy-50"
            }`}
          >
            <input
              type="radio"
              name={q.id}
              className="mt-1 h-4 w-4 accent-fsw-600"
              checked={selected === value}
              onChange={() => onAnswer(q.id, value)}
            />
            <span className={`whitespace-pre-wrap ${mono ? "font-mono tracking-wide" : ""}`}>
              {choice}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <Button
          variant="secondary"
          disabled={cursor === 0 || prevIsStudy}
          onClick={() => setCursor(Math.max(0, cursor - 1))}
        >
          Back
        </Button>
        {isLast ? (
          <Button disabled={!allAnswered && selected === undefined} onClick={onDone}>
            Finish section
          </Button>
        ) : (
          <Button
            disabled={selected === undefined}
            onClick={() => setCursor(Math.min(questions.length - 1, cursor + 1))}
          >
            Next
          </Button>
        )}
      </div>
    </Card>
  );
}
