"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";

interface Option {
  id: string;
  name: string;
}

export function NewRequisitionForm({
  departments,
  locations,
  profiles,
  approvers,
}: {
  departments: Option[];
  locations: Option[];
  profiles: Option[];
  approvers: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    departmentId: "",
    locationId: "",
    employmentType: "FULL_TIME",
    workArrangement: "ONSITE",
    openings: 1,
    salaryMin: "",
    salaryMax: "",
    salaryPeriod: "MONTH",
    salaryPublish: true,
    summary: "",
    description: "",
    responsibilities: "",
    requirements: "",
    benefits: "",
    jobProfileId: "",
  });
  const [selectedApprovers, setSelectedApprovers] = useState<string[]>([]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ requisitionId: string }>("/api/admin/requisitions", {
        body: {
          title: form.title,
          departmentId: form.departmentId || null,
          locationId: form.locationId || null,
          employmentType: form.employmentType,
          workArrangement: form.workArrangement,
          openings: Number(form.openings),
          salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
          salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
          salaryPeriod: form.salaryPeriod,
          salaryPublish: form.salaryPublish,
          summary: form.summary || null,
          description: form.description || null,
          responsibilities: form.responsibilities || null,
          requirements: form.requirements || null,
          benefits: form.benefits || null,
          jobProfileId: form.jobProfileId || null,
          approverIds: selectedApprovers,
        },
      });
      router.push(`/admin/recruiting/requisitions/${res.requisitionId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the requisition.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      )}

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">The role</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Job title</Label>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Inside Technical Sales Representative"
            />
          </div>
          <div>
            <Label>Department</Label>
            <Select
              value={form.departmentId}
              onChange={(e) => set("departmentId", e.target.value)}
            >
              <option value="">Select…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Location</Label>
            <Select
              value={form.locationId}
              onChange={(e) => set("locationId", e.target.value)}
            >
              <option value="">Select…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Employment type</Label>
            <Select
              value={form.employmentType}
              onChange={(e) => set("employmentType", e.target.value)}
            >
              {["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERNSHIP"].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Work arrangement</Label>
            <Select
              value={form.workArrangement}
              onChange={(e) => set("workArrangement", e.target.value)}
            >
              {["ONSITE", "HYBRID", "REMOTE"].map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Number of openings</Label>
            <Input
              type="number"
              min={1}
              value={form.openings}
              onChange={(e) => set("openings", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Assessment benchmark (optional)</Label>
            <Select
              value={form.jobProfileId}
              onChange={(e) => set("jobProfileId", e.target.value)}
            >
              <option value="">No assessment</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Compensation</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>Minimum</Label>
            <Input
              type="number"
              min={0}
              value={form.salaryMin}
              onChange={(e) => set("salaryMin", e.target.value)}
            />
          </div>
          <div>
            <Label>Maximum</Label>
            <Input
              type="number"
              min={0}
              value={form.salaryMax}
              onChange={(e) => set("salaryMax", e.target.value)}
            />
          </div>
          <div>
            <Label>Per</Label>
            <Select
              value={form.salaryPeriod}
              onChange={(e) => set("salaryPeriod", e.target.value)}
            >
              {["HOUR", "DAY", "MONTH", "YEAR"].map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label className="mt-4 flex gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={form.salaryPublish}
            onChange={(e) => set("salaryPublish", e.target.checked)}
          />
          <span>
            <span className="font-medium text-navy-900">Publish the range</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-navy-500">
              Shown on the careers page and sent to job boards. Pay transparency
              is now required in a growing number of jurisdictions, and postings
              that state a range tend to draw better-matched applicants.
            </span>
          </span>
        </label>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Public description</h3>
        <div className="mt-4 space-y-4">
          <div>
            <Label>One-line summary</Label>
            <Input
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              placeholder="Sell technical products to business customers, from first contact through to close."
            />
          </div>
          <div>
            <Label>About the role</Label>
            <Textarea
              rows={4}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div>
            <Label>Responsibilities</Label>
            <Textarea
              rows={4}
              value={form.responsibilities}
              onChange={(e) => set("responsibilities", e.target.value)}
              placeholder="One per line."
            />
          </div>
          <div>
            <Label>Requirements</Label>
            <Textarea
              rows={4}
              value={form.requirements}
              onChange={(e) => set("requirements", e.target.value)}
              placeholder="One per line. Describe what the work needs, not a wish list — every extra requirement narrows your applicant pool."
            />
          </div>
          <div>
            <Label>Benefits</Label>
            <Textarea
              rows={3}
              value={form.benefits}
              onChange={(e) => set("benefits", e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Approvers</h3>
        <p className="mt-1 text-xs leading-relaxed text-navy-500">
          In order. Each is asked only once the one before has approved, so a
          rejection stops the chain rather than wasting everyone&rsquo;s time.
          Leave empty to open the role without approval.
        </p>
        <div className="mt-3 space-y-1.5">
          {approvers.map((a) => {
            const index = selectedApprovers.indexOf(a.id);
            return (
              <label
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-navy-100 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Checkbox
                    checked={index >= 0}
                    onChange={(e) =>
                      setSelectedApprovers((prev) =>
                        e.target.checked
                          ? [...prev, a.id]
                          : prev.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.name}
                  <span className="text-xs text-navy-400">
                    {a.role.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
                {index >= 0 && (
                  <span className="text-xs font-semibold text-fsw-700">
                    Step {index + 1}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Card>

      <Button disabled={busy || form.title.trim().length < 2} onClick={() => void submit()}>
        {busy ? "Creating…" : "Create requisition"}
      </Button>
    </div>
  );
}
