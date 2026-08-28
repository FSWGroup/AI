"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Icon } from "@/components/icons";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface AckContent {
  statement: string;
  requireTypedSignature?: boolean;
}

/** Handles both ACKNOWLEDGEMENT (statement + checkbox, optional signature) and SIGNATURE (typed e-signature). */
export function AcknowledgementPlayer({ lesson, progress, onComplete, acknowledge }: LessonPlayerProps) {
  const isSignatureOnly = lesson.type === "SIGNATURE";
  const content = lesson.content as AckContent;
  const requireSignature = isSignatureOnly || content.requireTypedSignature === true;

  const [checked, setChecked] = React.useState(false);
  const [signature, setSignature] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const alreadyDone = progress?.status === "COMPLETED";

  const canSubmit = !isSignatureOnly ? checked && (!requireSignature || signature.trim().length > 1) : signature.trim().length > 1;

  async function submit() {
    if (!acknowledge) {
      toast.error("Acknowledgement isn't available right now.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await acknowledge({ typedSignature: requireSignature ? signature.trim() : undefined });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't record your acknowledgement.");
        return;
      }
      toast.success(isSignatureOnly ? "Signed." : "Acknowledged.");
      onComplete();
    } finally {
      setSubmitting(false);
    }
  }

  if (alreadyDone) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-success-100 bg-success-50 p-6">
        <div className="flex items-center gap-2 text-success-700">
          <Icon name="approval" className="h-5 w-5" />
          <p className="text-[0.9375rem] font-semibold">{isSignatureOnly ? "Signed" : "Acknowledged"}</p>
        </div>
        <p className="text-[0.875rem] text-[var(--text-secondary)]">{content.statement}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
        <p className="text-[0.9375rem] leading-relaxed text-[var(--text-primary)]">{content.statement}</p>
      </div>

      {!isSignatureOnly && (
        <label className="flex items-start gap-3 text-[0.875rem] text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand-primary)]"
          />
          I have read and understand this statement.
        </label>
      )}

      {requireSignature && (
        <Field
          label="Typed signature"
          htmlFor="typed-signature"
          hint="Type your full legal name to sign."
          required
        >
          <Input id="typed-signature" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Your full name" />
        </Field>
      )}

      <div>
        <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
          {isSignatureOnly ? "Sign" : "Acknowledge"}
        </Button>
      </div>
    </div>
  );
}
