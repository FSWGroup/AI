"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import {
  Button,
  Card,
  Checkbox,
  ErrorText,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import {
  DEFAULT_CYCLE_CRITERIA,
  PERFORMANCE_CRITERIA,
} from "@/content/performance-criteria";

export function NewCycleForm() {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("90-day review");
  const [kind, setKind] = useState("DAY_90");
  const [criteria, setCriteria] = useState<string[]>(DEFAULT_CYCLE_CRITERIA);
  const [instructions, setInstructions] = useState("");

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New review cycle
      </Button>
    );
  }

  const toggle = (key: string) =>
    setCriteria((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-navy-900">New review cycle</h3>
      <p className="mt-1 text-sm text-navy-500">
        A cycle is one round of ratings. Tenure-anchored cycles fall due per
        person — everyone gets a 90-day review 90 days in.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cycleName">Name</Label>
          <Input id="cycleName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cycleKind">When it falls due</Label>
          <Select id="cycleKind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="DAY_30">30 days after hire</option>
            <option value="DAY_90">90 days after hire</option>
            <option value="DAY_180">180 days after hire</option>
            <option value="ANNUAL">One year after hire</option>
            <option value="AD_HOC">Any time (ad hoc)</option>
          </Select>
        </div>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-navy-400">
        Criteria rated in this cycle
      </p>
      <p className="mt-1 text-xs text-navy-500">
        Every criterion adds a rating a manager has to think about. Nine is
        already a long form; a form nobody finishes produces no criterion at all.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {PERFORMANCE_CRITERIA.map((c) => (
          <label key={c.key} className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-1"
              checked={criteria.includes(c.key)}
              onChange={() => toggle(c.key)}
            />
            <span>
              <span className="font-medium text-navy-800">{c.label}</span>
              {c.appliesTo !== "ALL" && (
                <span className="ml-1 text-xs text-navy-400">
                  ({c.appliesTo.toLowerCase()} roles)
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4">
        <Label htmlFor="cycleInstructions">Instructions to raters (optional)</Label>
        <Textarea
          id="cycleInstructions"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      {error && <ErrorText className="mt-3">{error}</ErrorText>}
      <div className="mt-4 flex gap-3">
        <Button
          disabled={busy || criteria.length === 0}
          onClick={async () => {
            await run(async () => {
              await api("/api/admin/performance/cycles", {
                method: "POST",
                body: {
                  name,
                  kind,
                  criterionKeys: criteria,
                  instructions: instructions || null,
                },
              });
              setOpen(false);
            }, { fallback: "Could not create the cycle." });
          }}
        >
          {busy ? "Creating…" : "Create as draft"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function NewStudyForm({
  jobProfiles,
  hasCycles,
}: {
  jobProfiles: { id: string; name: string }[];
  hasCycles: boolean;
}) {
  const { busy, error, run, router } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobProfileId, setJobProfileId] = useState("");
  const [criterionKind, setCriterionKind] = useState("OVERALL_RATING");
  const [criterionKey, setCriterionKey] = useState(PERFORMANCE_CRITERIA[0].key);
  const [compositeKeys, setCompositeKeys] = useState<string[]>(
    DEFAULT_CYCLE_CRITERIA.slice(0, 4),
  );
  const [metricKey, setMetricKey] = useState("");
  const [retentionDays, setRetentionDays] = useState(365);
  const [correctRR, setCorrectRR] = useState(true);
  const [correctAtt, setCorrectAtt] = useState(true);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          New study
        </Button>
        <NewCycleForm />
        {!hasCycles && (
          <span className="text-sm text-navy-500">
            Create a cycle first — a study with no ratings behind it has nothing
            to correlate against.
          </span>
        )}
      </div>
    );
  }

  const keysForKind = (): string[] => {
    switch (criterionKind) {
      case "COMPETENCY_RATING":
        return [criterionKey];
      case "COMPOSITE_RATING":
        return compositeKeys;
      case "METRIC":
        return [metricKey];
      default:
        return [];
    }
  };

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-navy-900">New validity study</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="studyName">Name</Label>
          <Input
            id="studyName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Inside Sales — 90-day effectiveness, 2026"
          />
        </div>
        <div>
          <Label htmlFor="studyProfile">Job profile</Label>
          <Select
            id="studyProfile"
            value={jobProfileId}
            onChange={(e) => setJobProfileId(e.target.value)}
          >
            <option value="">All roles</option>
            {jobProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="studyDesc">What question is this study answering?</Label>
        <Textarea
          id="studyDesc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="mt-4">
        <Label htmlFor="studyKind">Criterion</Label>
        <Select
          id="studyKind"
          value={criterionKind}
          onChange={(e) => setCriterionKind(e.target.value)}
        >
          <option value="OVERALL_RATING">Overall effectiveness rating</option>
          <option value="COMPETENCY_RATING">One performance criterion</option>
          <option value="COMPOSITE_RATING">Composite of several criteria</option>
          <option value="METRIC">An objective metric</option>
          <option value="RETENTION">Still employed after N days</option>
        </Select>
      </div>

      {criterionKind === "COMPETENCY_RATING" && (
        <div className="mt-3">
          <Label htmlFor="studyCriterion">Which criterion</Label>
          <Select
            id="studyCriterion"
            value={criterionKey}
            onChange={(e) => setCriterionKey(e.target.value)}
          >
            {PERFORMANCE_CRITERIA.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {criterionKind === "COMPOSITE_RATING" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PERFORMANCE_CRITERIA.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={compositeKeys.includes(c.key)}
                onChange={() =>
                  setCompositeKeys((prev) =>
                    prev.includes(c.key)
                      ? prev.filter((k) => k !== c.key)
                      : [...prev, c.key],
                  )
                }
              />
              {c.label}
            </label>
          ))}
        </div>
      )}

      {criterionKind === "METRIC" && (
        <div className="mt-3">
          <Label htmlFor="studyMetric">Metric key</Label>
          <Input
            id="studyMetric"
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value)}
            placeholder="quota_attainment"
          />
        </div>
      )}

      {criterionKind === "RETENTION" && (
        <div className="mt-3">
          <Label htmlFor="studyDays">Tenure horizon (days)</Label>
          <Input
            id="studyDays"
            type="number"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-navy-500">
            Anyone still employed but not yet at this horizon is excluded rather
            than counted as a success or a failure they have not reached.
          </p>
        </div>
      )}

      <div className="mt-5 space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-1"
            checked={correctRR}
            onChange={(e) => setCorrectRR(e.target.checked)}
          />
          <span>
            Correct for range restriction
            <span className="block text-xs text-navy-500">
              We hired the people who scored well, so hires vary less than
              applicants. The applicant-pool spread is measured from this
              platform&apos;s own records, not assumed.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-1"
            checked={correctAtt}
            onChange={(e) => setCorrectAtt(e.target.checked)}
          />
          <span>
            Correct for criterion unreliability
            <span className="block text-xs text-navy-500">
              Applied only where two or more raters actually rated the same
              people, so the reliability can be measured instead of invented.
            </span>
          </span>
        </label>
      </div>

      {error && <ErrorText className="mt-3">{error}</ErrorText>}
      <div className="mt-5 flex gap-3">
        <Button
          disabled={busy || name.trim().length === 0}
          onClick={async () => {
            await run(async () => {
              const out = await api<{ id: string }>("/api/admin/validation/studies", {
                method: "POST",
                body: {
                  name,
                  description: description || null,
                  jobProfileId: jobProfileId || null,
                  criterionKind,
                  criterionKeys: keysForKind(),
                  retentionDays: criterionKind === "RETENTION" ? retentionDays : null,
                  cycleKinds: [],
                  correctRangeRestriction: correctRR,
                  correctAttenuation: correctAtt,
                },
              });
              router.push(`/admin/validation/studies/${out.id}`);
            }, { fallback: "Could not create the study.", refresh: false });
          }}
        >
          {busy ? "Creating…" : "Create study"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
