"use client";

/**
 * The public application form.
 *
 * Kept deliberately short. Every extra field costs applications — the people
 * most likely to abandon a long form are the ones with other offers, which is
 * to say the ones you most want. Name, email, phone, résumé, and whatever
 * screening questions the role genuinely needs.
 *
 * Attribution is captured here at submit time because it cannot be
 * reconstructed later: the referrer and the campaign parameters exist only in
 * this browser, on this page load.
 */

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";

export interface FormQuestion {
  id: string;
  prompt: string;
  kind: string;
  required: boolean;
  choices: string[];
  helpText: string | null;
}

interface AnswerState {
  text?: string;
  number?: number;
  list?: string[];
}

export function ApplicationForm({
  requisitionId,
  reference,
  questions,
}: {
  requisitionId: string;
  reference: string;
  questions: FormQuestion[];
}) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const captured: Record<string, string> = {};
    for (const key of ["src", "utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const value = params.get(key);
      if (value) captured[key] = value;
    }
    if (document.referrer) captured.referrer = document.referrer;
    setAttribution(captured);
  }, []);

  function setAnswer(id: string, value: AnswerState): void {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssues({});
    try {
      const payload = new FormData();
      payload.set("requisitionId", requisitionId);
      payload.set("firstName", form.firstName);
      payload.set("lastName", form.lastName);
      payload.set("email", form.email);
      payload.set("phone", form.phone);
      payload.set("attribution", JSON.stringify(attribution));
      payload.set(
        "answers",
        JSON.stringify(
          questions.map((q) => ({
            questionId: q.id,
            text: answers[q.id]?.text ?? null,
            number: answers[q.id]?.number ?? null,
            list: answers[q.id]?.list ?? [],
          })),
        ),
      );
      if (resume) payload.set("resume", resume);

      const res = await fetch("/api/careers/apply", { method: "POST", body: payload });
      const body = (await res.json()) as {
        reference?: string;
        error?: string;
        issues?: { questionId: string; message: string }[];
      };
      if (!res.ok) {
        if (body.issues) {
          setIssues(Object.fromEntries(body.issues.map((i) => [i.questionId, i.message])));
        }
        throw new Error(body.error ?? "We could not submit your application.");
      }
      setDone(body.reference ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <Card className="mt-6 p-8">
        <h3 className="text-lg font-bold text-navy-900">Application received</h3>
        <p className="mt-3 leading-relaxed text-navy-600">
          Thank you. Our recruiting team has your application and will be in
          touch about next steps.
        </p>
        {done && (
          <p className="mt-4 text-sm text-navy-500">
            Your reference is <strong className="text-navy-900">{done}</strong>. Quote
            it if you need to contact us about this application.
          </p>
        )}
      </Card>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      )}

      <Card className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              required
              autoComplete="given-name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              required
              autoComplete="family-name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="09XX XXX XXXX"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-4">
          <Label htmlFor="resume">Résumé (PDF or Word, optional)</Label>
          <input
            id="resume"
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-navy-700 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy-800 hover:file:bg-navy-200"
          />
        </div>
      </Card>

      {questions.length > 0 && (
        <Card className="p-6">
          <h3 className="text-sm font-bold text-navy-900">A few questions</h3>
          <div className="mt-4 space-y-5">
            {questions.map((q) => (
              <div key={q.id}>
                <Label htmlFor={`q-${q.id}`}>
                  {q.prompt}
                  {!q.required && (
                    <span className="ml-1.5 font-normal text-navy-400">(optional)</span>
                  )}
                </Label>
                {q.helpText && (
                  <p className="mb-1.5 text-xs text-navy-500">{q.helpText}</p>
                )}

                {q.kind === "LONG_TEXT" && (
                  <Textarea
                    id={`q-${q.id}`}
                    rows={4}
                    required={q.required}
                    value={answers[q.id]?.text ?? ""}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  />
                )}
                {q.kind === "SHORT_TEXT" && (
                  <Input
                    id={`q-${q.id}`}
                    required={q.required}
                    value={answers[q.id]?.text ?? ""}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  />
                )}
                {q.kind === "NUMBER" && (
                  <Input
                    id={`q-${q.id}`}
                    type="number"
                    min={0}
                    required={q.required}
                    value={answers[q.id]?.number ?? ""}
                    onChange={(e) =>
                      setAnswer(q.id, {
                        number: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                )}
                {q.kind === "YES_NO" && (
                  <Select
                    id={`q-${q.id}`}
                    required={q.required}
                    value={answers[q.id]?.text ?? ""}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  >
                    <option value="">Select…</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </Select>
                )}
                {q.kind === "SINGLE_CHOICE" && (
                  <Select
                    id={`q-${q.id}`}
                    required={q.required}
                    value={answers[q.id]?.text ?? ""}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {q.choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                )}
                {q.kind === "MULTI_CHOICE" && (
                  <div className="mt-1 space-y-1.5">
                    {q.choices.map((c) => {
                      const list = answers[q.id]?.list ?? [];
                      return (
                        <label key={c} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={list.includes(c)}
                            onChange={(e) =>
                              setAnswer(q.id, {
                                list: e.target.checked
                                  ? [...list, c]
                                  : list.filter((x) => x !== c),
                              })
                            }
                          />
                          {c}
                        </label>
                      );
                    })}
                  </div>
                )}

                {issues[q.id] && (
                  <p className="mt-1 text-xs text-amber-800">{issues[q.id]}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit application"}
        </Button>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-navy-500">
          We use what you send here to consider you for this role and to contact
          you about it. Reference <strong>{reference}</strong>. You can ask us at
          any time to tell you what we hold about you, or to delete it.
        </p>
      </div>
    </form>
  );
}
