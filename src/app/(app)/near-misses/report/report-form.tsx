"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Glyph } from "@/components/icons";
import { reportNearMissAction } from "@/app/(app)/near-misses/report/actions";

/**
 * The report form.
 *
 * Designed around one number: how many people abandon it. So the required set
 * is four fields, everything else is explicitly optional and says so, the
 * anonymity choice is on the form rather than buried in a policy page, and the
 * copy never asks who was involved. Categorization and cause analysis are the
 * reviewer's job.
 */

const CATEGORIES: { value: string; label: string; hint: string }[] = [
  { value: "PRODUCT_SELECTION", label: "Product selection", hint: "Wrong item, material, size or pressure class" },
  { value: "ORDER_ACCURACY", label: "Order accuracy", hint: "Wrong quantity, wrong address, wrong shipment" },
  { value: "WAREHOUSE_SAFETY", label: "Warehouse safety", hint: "Anything physical: lifting, stacking, vehicles" },
  { value: "CUSTOMER_COMMITMENT", label: "Customer commitment", hint: "A promise the business could not keep" },
  { value: "DATA_SECURITY", label: "Data security", hint: "Wrong recipient, a link clicked, data shared" },
  { value: "SUPPLIER", label: "Supplier", hint: "Something upstream that reached us" },
  { value: "OTHER", label: "Other", hint: "Not on this list" },
];

const SEVERITIES: { value: string; label: string; hint: string }[] = [
  { value: "NEAR_MISS", label: "Caught in time", hint: "It never left the building" },
  { value: "MINOR", label: "Reached the customer, no loss", hint: "Noticed, but nothing was lost" },
  { value: "SIGNIFICANT", label: "Cost money, time or credibility", hint: "There was a real consequence" },
  { value: "SERIOUS", label: "Injury, or a loss the business felt", hint: "Tell your manager too — do not rely on this form alone" },
];

interface Option {
  id: string;
  name: string;
}

export function NearMissReportForm({
  departments,
  locations,
  canViewLibrary,
}: {
  departments: Option[];
  locations: Option[];
  canViewLibrary: boolean;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("PRODUCT_SELECTION");
  const [severity, setSeverity] = useState("NEAR_MISS");
  const [whatHappened, setWhatHappened] = useState("");
  const [howItWasCaught, setHowItWasCaught] = useState("");
  const [whyItHappened, setWhyItHappened] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filed, setFiled] = useState<{ reference: string; anonymous: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedSeverity = SEVERITIES.find((option) => option.value === severity);
  const ready = title.trim().length >= 6 && whatHappened.trim().length >= 20;

  function submit() {
    setErrors({});
    startTransition(async () => {
      const result = await reportNearMissAction({
        title,
        category,
        severity,
        whatHappened,
        howItWasCaught: howItWasCaught.trim() || undefined,
        whyItHappened: whyItHappened.trim() || undefined,
        occurredOn: occurredOn || undefined,
        departmentId: departmentId || undefined,
        locationId: locationId || undefined,
        anonymous,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      setFiled(result.data);
    });
  }

  if (filed) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 py-8 text-center">
          <div
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success-50 text-success-700"
            aria-hidden="true"
          >
            <Glyph name="check" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[1.0625rem] font-semibold text-[var(--text-primary)]">
              Filed as {filed.reference}
            </h2>
            <p className="mx-auto mt-2 max-w-prose text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
              {filed.anonymous
                ? "It was filed with no link to you — not in the record, and not in the audit log. Because of that, nobody can come back to you with a question, so if there is more to say, file a second report or tell your manager."
                : "A reviewer will turn it into a case study, remove anything that identifies a person, and publish it to the library. You will get a notification when that happens."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFiled(null);
                setTitle("");
                setWhatHappened("");
                setHowItWasCaught("");
                setWhyItHappened("");
                setOccurredOn("");
              }}
            >
              File another
            </Button>
            {canViewLibrary && (
              <Link href="/near-misses">
                <Button variant="outline">Back to the library</Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>What happened</CardTitle>
          <CardDescription>
            Write it the way you would tell a colleague. Do not name anyone — a reviewer will
            take names out anyway, and the library is more useful without them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            label="One-line summary"
            htmlFor="nm-title"
            required
            hint="What nearly went wrong, in a sentence."
            error={errors.title}
          >
            <Input
              id="nm-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              placeholder="Wrong pressure class nearly shipped"
            />
          </Field>

          <Field
            label="What happened"
            htmlFor="nm-what"
            required
            hint="A couple of sentences is plenty. Describe the work, not the person."
            error={errors.whatHappened}
          >
            <Textarea
              id="nm-what"
              value={whatHappened}
              onChange={(event) => setWhatHappened(event.target.value)}
              rows={5}
              maxLength={4000}
            />
          </Field>

          <Field
            label="How it was caught"
            htmlFor="nm-caught"
            hint="Optional — but this is often the most useful part, because it is the control that worked."
            error={errors.howItWasCaught}
          >
            <Textarea
              id="nm-caught"
              value={howItWasCaught}
              onChange={(event) => setHowItWasCaught(event.target.value)}
              rows={3}
              maxLength={2000}
            />
          </Field>

          <Field
            label="Why you think it happened"
            htmlFor="nm-why"
            hint="Optional. A guess is fine — you were there."
            error={errors.whyItHappened}
          >
            <Textarea
              id="nm-why"
              value={whyItHappened}
              onChange={(event) => setWhyItHappened(event.target.value)}
              rows={3}
              maxLength={2000}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Classify it roughly</CardTitle>
          <CardDescription>
            A rough answer is fine. The reviewer will correct it if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Kind of thing"
              htmlFor="nm-category"
              hint={CATEGORIES.find((option) => option.value === category)?.hint}
            >
              <Select
                id="nm-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {CATEGORIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="How far it got" htmlFor="nm-severity" hint={selectedSeverity?.hint}>
              <Select
                id="nm-severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
              >
                {SEVERITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {severity === "SERIOUS" && (
            <div
              role="status"
              className="rounded-md border border-warning-100 bg-warning-50 px-4 py-3 text-[0.8125rem] leading-relaxed text-warning-700"
            >
              <p className="font-semibold">This form is not an emergency channel.</p>
              <p className="mt-1">
                If someone was hurt, or there is an ongoing risk, tell your manager or the
                safety contact now. File this as well, not instead.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="When" htmlFor="nm-date" hint="Optional. Roughly is fine.">
              <Input
                id="nm-date"
                type="date"
                value={occurredOn}
                onChange={(event) => setOccurredOn(event.target.value)}
              />
            </Field>
            <Field label="Department" htmlFor="nm-department" hint="Optional.">
              <Select
                id="nm-department"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Not saying</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor="nm-location" hint="Optional.">
              <Select
                id="nm-location"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <option value="">Not saying</option>
                {locations.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your name</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/*
            A real choice, presented plainly, with the trade-off stated. An
            anonymity promise nobody understands is not reassuring.
          */}
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--border-default)] px-4 py-3 has-checked:border-fswblue-300 has-checked:bg-fswblue-50">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent-strong)]"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
            />
            <span>
              <span className="block text-[0.875rem] font-medium text-[var(--text-primary)]">
                File this anonymously
              </span>
              <span className="mt-1 block text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                No link to you is stored — not on the report, not in the audit log. Nobody can
                ask you a follow-up question, and you will not get a notification when it is
                published.
              </span>
            </span>
          </label>

          {!anonymous && (
            <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
              Your name is visible to the reviewers only, so they can ask you a question. It is
              never part of the published case study.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge tone="neutral">No fault is recorded</Badge>
            <Badge tone="neutral">Names are removed before publication</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!ready && (
          <p className="text-[0.75rem] text-[var(--text-muted)]">
            A summary and a couple of sentences about what happened, and you are done.
          </p>
        )}
        <Button onClick={submit} loading={pending} disabled={!ready}>
          <Glyph name="check" className="h-4 w-4" />
          File the report
        </Button>
      </div>
    </div>
  );
}
