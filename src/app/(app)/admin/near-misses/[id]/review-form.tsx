"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, PromptDialog } from "@/components/ui/dialog";
import { Glyph } from "@/components/icons";
import type { IdentifierFinding } from "@/lib/services/near-miss-redaction";
import {
  archiveNearMissAction,
  checkNearMissNarrativeAction,
  publishNearMissAction,
  reopenNearMissAction,
  saveNearMissReviewAction,
} from "@/app/(app)/admin/near-misses/[id]/actions";

/**
 * The reviewer's editor.
 *
 * The blameless check runs continuously against what is on screen rather than
 * only at publish time: a reviewer who learns at the last step that the text
 * names someone has to re-read four paragraphs to find out where. Findings name
 * the field and the words.
 */

interface Option {
  id: string;
  name: string;
}

export interface NearMissReviewValue {
  id: string;
  reference: string;
  status: "REPORTED" | "UNDER_REVIEW" | "PUBLISHED" | "ARCHIVED";
  title: string;
  category: string;
  severity: string;
  whatHappened: string;
  howItWasCaught: string;
  whyItHappened: string;
  whatChanged: string;
  occurredOn: string;
  departmentId: string;
  businessUnitId: string;
  locationId: string;
  preventingSopId: string;
  teachingCourseId: string;
}

const CATEGORY_OPTIONS: [string, string][] = [
  ["PRODUCT_SELECTION", "Product selection"],
  ["ORDER_ACCURACY", "Order accuracy"],
  ["WAREHOUSE_SAFETY", "Warehouse safety"],
  ["CUSTOMER_COMMITMENT", "Customer commitment"],
  ["DATA_SECURITY", "Data security"],
  ["SUPPLIER", "Supplier"],
  ["OTHER", "Other"],
];

const SEVERITY_OPTIONS: [string, string][] = [
  ["NEAR_MISS", "Caught in time"],
  ["MINOR", "Reached the customer, no loss"],
  ["SIGNIFICANT", "Cost money or time"],
  ["SERIOUS", "Injury or real loss"],
];

function FindingsPanel({ findings }: { findings: IdentifierFinding[] }) {
  const blocking = findings.filter((finding) => finding.blocking);
  const warnings = findings.filter((finding) => !finding.blocking);

  if (findings.length === 0) {
    return (
      <div
        role="status"
        className="rounded-md border border-success-100 bg-success-50 px-4 py-3 text-[0.8125rem] text-success-700"
      >
        <p className="font-semibold">Nothing identifying, nothing that reads as blame.</p>
        <p className="mt-1">Ready to publish once there is a cause and a change recorded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {blocking.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700"
        >
          <p className="font-semibold">
            {blocking.length === 1
              ? "One thing must be removed before this can be published"
              : `${blocking.length} things must be removed before this can be published`}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {blocking.map((finding, index) => (
              <li key={`${finding.kind}-${finding.match}-${index}`}>
                <span className="font-medium">{finding.field}:</span>{" "}
                <span className="rounded bg-danger-100 px-1 py-0.5 font-mono text-[0.75rem]">
                  {finding.match}
                </span>{" "}
                — {finding.advice}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          role="status"
          className="rounded-md border border-warning-100 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-700"
        >
          <p className="font-semibold">
            Worth a second look — these do not block publication
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {warnings.map((finding, index) => (
              <li key={`${finding.kind}-${finding.match}-${index}`}>
                <span className="font-medium">{finding.field}:</span>{" "}
                <span className="rounded bg-warning-100 px-1 py-0.5 font-mono text-[0.75rem]">
                  {finding.match}
                </span>{" "}
                — {finding.advice}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function NearMissReviewForm({
  initial,
  departments,
  locations,
  sops,
  courses,
  reporterName,
  initialFindings,
}: {
  initial: NearMissReviewValue;
  departments: Option[];
  locations: Option[];
  sops: { id: string; label: string }[];
  courses: { id: string; label: string }[];
  /** Null for an anonymous report — there is nothing to show. */
  reporterName: string | null;
  initialFindings: IdentifierFinding[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [findings, setFindings] = useState<IdentifierFinding[]>(initialFindings);
  const [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, startTransition] = useTransition();

  const published = value.status === "PUBLISHED";
  const archived = value.status === "ARCHIVED";
  const readOnly = published || archived;

  const blocking = findings.filter((finding) => finding.blocking);
  const hasCause = value.whyItHappened.trim().length >= 10;
  const hasChange = value.whatChanged.trim().length >= 10;
  const publishable = blocking.length === 0 && hasCause && hasChange && !published;

  function patch(next: Partial<NearMissReviewValue>) {
    setValue((current) => ({ ...current, ...next }));
  }

  // Debounced live check of the narrative on screen.
  useEffect(() => {
    if (readOnly) return;
    setChecking(true);
    const handle = setTimeout(() => {
      checkNearMissNarrativeAction({
        title: value.title,
        whatHappened: value.whatHappened,
        howItWasCaught: value.howItWasCaught,
        whyItHappened: value.whyItHappened,
        whatChanged: value.whatChanged,
      })
        .then((result) => {
          if (result.ok) setFindings(result.data.findings);
        })
        .finally(() => setChecking(false));
    }, 600);
    return () => clearTimeout(handle);
  }, [
    readOnly,
    value.title,
    value.whatHappened,
    value.howItWasCaught,
    value.whyItHappened,
    value.whatChanged,
  ]);

  function payload() {
    return {
      title: value.title,
      category: value.category,
      severity: value.severity,
      whatHappened: value.whatHappened,
      howItWasCaught: value.howItWasCaught.trim() || undefined,
      whyItHappened: value.whyItHappened.trim() || undefined,
      whatChanged: value.whatChanged.trim() || undefined,
      occurredOn: value.occurredOn || null,
      departmentId: value.departmentId || null,
      businessUnitId: value.businessUnitId || null,
      locationId: value.locationId || null,
      preventingSopId: value.preventingSopId || null,
      teachingCourseId: value.teachingCourseId || null,
    };
  }

  function save(onDone?: () => void) {
    setErrors({});
    startTransition(async () => {
      const result = await saveNearMissReviewAction(value.id, payload());
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      setFindings(result.data.findings);
      patch({ status: value.status === "REPORTED" ? "UNDER_REVIEW" : value.status });
      toast.success("Saved.");
      router.refresh();
      onDone?.();
    });
  }

  function publish() {
    setConfirmPublish(false);
    startTransition(async () => {
      // Save first so publication validates exactly what is on screen.
      const saved = await saveNearMissReviewAction(value.id, payload());
      if (!saved.ok) {
        setErrors(saved.fieldErrors ?? {});
        toast.error(saved.error);
        return;
      }
      const result = await publishNearMissAction(value.id);
      if (!result.ok) {
        toast.error(result.error);
        setFindings(saved.data.findings);
        return;
      }
      toast.success(`${value.reference} published to the library.`);
      patch({ status: "PUBLISHED" });
      router.refresh();
    });
  }

  function archive(reason: string) {
    setConfirmArchive(false);
    startTransition(async () => {
      const result = await archiveNearMissAction(value.id, reason || undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Archived.");
      patch({ status: "ARCHIVED" });
      router.refresh();
    });
  }

  function reopen() {
    startTransition(async () => {
      const result = await reopenNearMissAction(value.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reopened for editing. It is no longer in the library.");
      patch({ status: "UNDER_REVIEW" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {readOnly && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)] px-4 py-3 text-[0.8125rem] text-[var(--text-secondary)]"
        >
          <p>
            {published
              ? "This is published and read-only. Reopen it to make changes — it leaves the library and the AI corpus while it is open."
              : "This is archived and read-only. Reopen it to bring it back into review."}
          </p>
          <div className="flex items-center gap-2">
            {published && (
              <Link href={`/near-misses/${value.reference}`}>
                <Button variant="outline" size="sm">
                  View in library
                </Button>
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={reopen} loading={pending}>
              Reopen
            </Button>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
              Blameless check
            </h2>
            {checking && (
              <span className="text-[0.75rem] text-[var(--text-muted)]" role="status">
                checking…
              </span>
            )}
          </div>
          <FindingsPanel findings={findings} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>The case study</CardTitle>
          <CardDescription>
            Rewrite in terms of roles, not people. Keep the specifics that teach — part numbers,
            pressure classes, the exact step — and drop the ones that only identify.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Summary" htmlFor="nmr-title" required error={errors.title}>
            <Input
              id="nmr-title"
              value={value.title}
              disabled={readOnly}
              maxLength={160}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>

          <Field
            label="What happened"
            htmlFor="nmr-what"
            required
            error={errors.whatHappened}
          >
            <Textarea
              id="nmr-what"
              value={value.whatHappened}
              disabled={readOnly}
              rows={5}
              maxLength={4000}
              onChange={(event) => patch({ whatHappened: event.target.value })}
            />
          </Field>

          <Field
            label="How it was caught"
            htmlFor="nmr-caught"
            hint="The control that worked. Worth keeping even when it worked by luck — say so."
            error={errors.howItWasCaught}
          >
            <Textarea
              id="nmr-caught"
              value={value.howItWasCaught}
              disabled={readOnly}
              rows={3}
              maxLength={2000}
              onChange={(event) => patch({ howItWasCaught: event.target.value })}
            />
          </Field>

          <Field
            label="Why it happened"
            htmlFor="nmr-why"
            required
            hint="Required to publish. A condition, not a person: what made the wrong action the easy one?"
            error={errors.whyItHappened}
          >
            <Textarea
              id="nmr-why"
              value={value.whyItHappened}
              disabled={readOnly}
              rows={3}
              maxLength={2000}
              onChange={(event) => patch({ whyItHappened: event.target.value })}
            />
          </Field>

          <Field
            label="What changed"
            htmlFor="nmr-changed"
            required
            hint="Required to publish. Without a change this is a story, not a lesson. “Nothing yet, and here is why” is an acceptable answer."
            error={errors.whatChanged}
          >
            <Textarea
              id="nmr-changed"
              value={value.whatChanged}
              disabled={readOnly}
              rows={3}
              maxLength={2000}
              onChange={(event) => patch({ whatChanged: event.target.value })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Classification and links</CardTitle>
          <CardDescription>
            Linking the procedure is what makes a case study reusable: it shows up on the SOP
            page, so the step that reads like bureaucracy sits next to the day it would have
            saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Kind" htmlFor="nmr-category">
              <Select
                id="nmr-category"
                value={value.category}
                disabled={readOnly}
                onChange={(event) => patch({ category: event.target.value })}
              >
                {CATEGORY_OPTIONS.map(([option, label]) => (
                  <option key={option} value={option}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How far it got" htmlFor="nmr-severity">
              <Select
                id="nmr-severity"
                value={value.severity}
                disabled={readOnly}
                onChange={(event) => patch({ severity: event.target.value })}
              >
                {SEVERITY_OPTIONS.map(([option, label]) => (
                  <option key={option} value={option}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="When it happened" htmlFor="nmr-date">
              <Input
                id="nmr-date"
                type="date"
                value={value.occurredOn}
                disabled={readOnly}
                onChange={(event) => patch({ occurredOn: event.target.value })}
              />
            </Field>
            <Field label="Department" htmlFor="nmr-department">
              <Select
                id="nmr-department"
                value={value.departmentId}
                disabled={readOnly}
                onChange={(event) => patch({ departmentId: event.target.value })}
              >
                <option value="">Not recorded</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor="nmr-location">
              <Select
                id="nmr-location"
                value={value.locationId}
                disabled={readOnly}
                onChange={(event) => patch({ locationId: event.target.value })}
              >
                <option value="">Not recorded</option>
                {locations.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Procedure that would have prevented it"
              htmlFor="nmr-sop"
              hint="Leave empty if none covers it — that gap is reported on the library page."
            >
              <Select
                id="nmr-sop"
                value={value.preventingSopId}
                disabled={readOnly}
                onChange={(event) => patch({ preventingSopId: event.target.value })}
              >
                <option value="">No procedure covers this</option>
                {sops.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Training that teaches it" htmlFor="nmr-course">
              <Select
                id="nmr-course"
                value={value.teachingCourseId}
                disabled={readOnly}
                onChange={(event) => patch({ teachingCourseId: event.target.value })}
              >
                <option value="">No course linked</option>
                {courses.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who filed it</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {reporterName ? (
            <>
              <p className="text-[0.875rem] text-[var(--text-primary)]">{reporterName}</p>
              <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                Visible to reviewers so you can ask a question. Never published, and never part
                of the AI corpus. They get a notification when this is published.
              </p>
            </>
          ) : (
            <>
              <div>
                <Badge tone="neutral">Filed anonymously</Badge>
              </div>
              <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                No link to the reporter exists — not on the record, not in the audit log. There
                is nobody to ask a follow-up question, so publish what you have or archive it
                with a note.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!publishable && (
            <p className="text-[0.75rem] text-[var(--text-muted)]">
              {blocking.length > 0
                ? "Remove the identifying detail above to publish."
                : !hasCause
                  ? "Fill in why it happened to publish."
                  : "Fill in what changed to publish."}
            </p>
          )}
          <Button variant="outline" onClick={() => setConfirmArchive(true)} disabled={pending}>
            Archive
          </Button>
          <Button variant="secondary" onClick={() => save()} loading={pending}>
            Save draft
          </Button>
          <Button onClick={() => setConfirmPublish(true)} disabled={!publishable || pending}>
            <Glyph name="check" className="h-4 w-4" />
            Publish to library
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`Publish ${value.reference}?`}
        description="It becomes readable by everyone who holds the library capability, appears on the linked procedure, and joins the AI knowledge base. You can withdraw it later."
        confirmLabel="Publish"
        onConfirm={publish}
        loading={pending}
      />

      <PromptDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${value.reference}?`}
        /*
         * A reason is required, not optional. Withdrawing a lesson from the
         * library is exactly the kind of act that should not be unexplained —
         * it goes into the audit record.
         */
        label="Why it is being archived"
        description="Archiving withdraws it from the library and the AI corpus. The record and its audit trail are kept."
        placeholder="Superseded by the new procedure"
        confirmLabel="Archive"
        onConfirm={archive}
        loading={pending}
      />
    </div>
  );
}
