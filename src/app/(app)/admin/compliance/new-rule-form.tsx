"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { createComplianceRuleAction } from "@/app/(app)/admin/compliance/actions";

const DEFAULT_CRITERIA = JSON.stringify({ all: [{ field: "status", op: "eq", value: "ACTIVE" }] }, null, 2);

export function NewRuleForm({
  courses,
  owners,
}: {
  courses: { id: string; title: string }[];
  owners: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [criteriaText, setCriteriaText] = useState(DEFAULT_CRITERIA);
  const [criteriaError, setCriteriaError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    let criteria: Record<string, unknown>;
    try {
      criteria = JSON.parse(criteriaText);
    } catch {
      setCriteriaError("Criteria must be valid JSON.");
      return;
    }
    setCriteriaError(null);

    startTransition(async () => {
      const result = await createComplianceRuleAction({
        name: String(formData.get("name") ?? "").trim(),
        jurisdiction: String(formData.get("jurisdiction") ?? "").trim(),
        requirement: String(formData.get("requirement") ?? "").trim(),
        sourceReference: String(formData.get("sourceReference") ?? "").trim() || null,
        courseId: (formData.get("courseId") as string) || null,
        criteria,
        frequencyMonths: formData.get("frequencyMonths") ? Number(formData.get("frequencyMonths")) : null,
        effectiveDate: formData.get("effectiveDate") ? new Date(String(formData.get("effectiveDate"))) : null,
        expirationDate: formData.get("expirationDate") ? new Date(String(formData.get("expirationDate"))) : null,
        retentionYears: formData.get("retentionYears") ? Number(formData.get("retentionYears")) : null,
        ownerId: (formData.get("ownerId") as string) || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Compliance rule created.");
      setOpen(false);
      setCriteriaText(DEFAULT_CRITERIA);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Glyph name="plus" className="h-4 w-4" /> New compliance rule
      </Button>
    );
  }

  return (
    <Card>
      <CardContent>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="rule-name" required>
              <Input id="rule-name" name="name" required />
            </Field>
            <Field label="Jurisdiction" htmlFor="rule-jurisdiction" required hint='e.g. "US-CA", "US-Federal", "FSW Group policy"'>
              <Input id="rule-jurisdiction" name="jurisdiction" required />
            </Field>
          </div>
          <Field label="Requirement" htmlFor="rule-requirement" required>
            <Textarea id="rule-requirement" name="requirement" rows={2} required />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Source reference" htmlFor="rule-source" hint="Statute, regulation, or policy citation">
              <Input id="rule-source" name="sourceReference" />
            </Field>
            <Field label="Linked course" htmlFor="rule-course" hint="Needed for automatic compliance tracking">
              <Select id="rule-course" name="courseId" defaultValue="">
                <option value="">None</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Frequency (months)" htmlFor="rule-frequency" hint="Blank = once">
              <Input id="rule-frequency" name="frequencyMonths" type="number" min={1} />
            </Field>
            <Field label="Effective date" htmlFor="rule-effective">
              <Input id="rule-effective" name="effectiveDate" type="date" />
            </Field>
            <Field label="Retention (years)" htmlFor="rule-retention">
              <Input id="rule-retention" name="retentionYears" type="number" min={1} />
            </Field>
          </div>
          <Field label="Owner" htmlFor="rule-owner">
            <Select id="rule-owner" name="ownerId" defaultValue="">
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Population criteria (JSON)"
            htmlFor="rule-criteria"
            error={criteriaError ?? undefined}
            hint='Same shape as assignment rules: {"all":[{"field":"departmentName","op":"eq","value":"Sales"}]}'
          >
            <Textarea
              id="rule-criteria"
              rows={6}
              className="font-mono text-[0.75rem]"
              value={criteriaText}
              onChange={(e) => setCriteriaText(e.target.value)}
            />
          </Field>
          <Field label="Notes" htmlFor="rule-notes">
            <Textarea id="rule-notes" name="notes" rows={2} />
          </Field>

          <p className="text-[0.75rem] text-[var(--text-muted)]">
            This platform tracks configured requirements and evidence. It does not determine legal applicability — verify
            requirement with qualified legal/safety advisor before relying on it.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Create rule
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
