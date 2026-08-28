"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { PersonRef } from "@/lib/services/sop";

export interface SopIdentityValue {
  title: string;
  summary: string;
  category: string;
  departmentId: string;
  businessUnitId: string;
  ownerId: string;
  smeId: string;
  reviewerId: string;
  approverId: string;
  language: string;
  reviewCycleDays: string;
}

const REVIEW_CYCLE_OPTIONS = [
  { value: "", label: "Use default" },
  { value: "90", label: "Every 90 days" },
  { value: "180", label: "Every 180 days" },
  { value: "365", label: "Every year" },
  { value: "730", label: "Every 2 years" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fil", label: "Filipino" },
];

export function SopIdentityFields({
  value,
  onChange,
  people,
  departments,
  businessUnits,
  titleError,
}: {
  value: SopIdentityValue;
  onChange: (patch: Partial<SopIdentityValue>) => void;
  people: PersonRef[];
  departments: { id: string; name: string }[];
  businessUnits: { id: string; name: string }[];
  titleError?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Title" htmlFor="sop-title" required error={titleError}>
        <Input id="sop-title" value={value.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field label="Summary" htmlFor="sop-summary" hint="One or two sentences shown on the library card.">
        <Textarea id="sop-summary" rows={2} value={value.summary} onChange={(e) => onChange({ summary: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="sop-category">
          <Input id="sop-category" value={value.category} onChange={(e) => onChange({ category: e.target.value })} placeholder="e.g. Safety, Sales, Onboarding" />
        </Field>
        <Field label="Language" htmlFor="sop-language">
          <Select id="sop-language" value={value.language} onChange={(e) => onChange({ language: e.target.value })}>
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department" htmlFor="sop-department">
          <Select id="sop-department" value={value.departmentId} onChange={(e) => onChange({ departmentId: e.target.value })}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Business unit" htmlFor="sop-business-unit">
          <Select id="sop-business-unit" value={value.businessUnitId} onChange={(e) => onChange({ businessUnitId: e.target.value })}>
            <option value="">None</option>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" htmlFor="sop-owner" hint="Accountable for keeping this current.">
          <Select id="sop-owner" value={value.ownerId} onChange={(e) => onChange({ ownerId: e.target.value })}>
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject matter expert" htmlFor="sop-sme">
          <Select id="sop-sme" value={value.smeId} onChange={(e) => onChange({ smeId: e.target.value })}>
            <option value="">None</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reviewer" htmlFor="sop-reviewer">
          <Select id="sop-reviewer" value={value.reviewerId} onChange={(e) => onChange({ reviewerId: e.target.value })}>
            <option value="">None</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Approver" htmlFor="sop-approver">
          <Select id="sop-approver" value={value.approverId} onChange={(e) => onChange({ approverId: e.target.value })}>
            <option value="">None</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Review cycle" htmlFor="sop-review-cycle" hint="How often this SOP must be re-reviewed after publishing.">
          <Select id="sop-review-cycle" value={value.reviewCycleDays} onChange={(e) => onChange({ reviewCycleDays: e.target.value })}>
            {REVIEW_CYCLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
