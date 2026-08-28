"use client";

/**
 * Job description → proposed benchmark + role-tailored assessment form.
 *
 * The proposal is always reviewed by a person before it takes effect:
 * "Apply to benchmark" fills the editor below (which the admin still has to
 * save), and building a tailored form is a separate, explicit action.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { dimensionMeta } from "@/content/narratives/dimension-meta";

export interface ProposedDimension {
  construct: string;
  enabled: boolean;
  required: boolean;
  minScore: number;
  maxScore: number;
  weight: number;
  rationale: string;
}

interface Proposal {
  roleSummary: string;
  keyResponsibilities: string[];
  isSalesRole: boolean;
  leadershipModuleEnabled: boolean;
  dimensions: ProposedDimension[];
  sectionEmphasis: {
    sectionKey: string;
    include: boolean;
    questionCount: number;
    rationale: string;
  }[];
  interviewThemes: string[];
  cautions: string[];
}

const SECTION_LABELS: Record<string, string> = {
  BEHAVIORAL: "Work Style Inventory",
  MECHANICAL_INTEREST: "Technical & Mechanical Interests",
  MENTAL_ACUITY: "Reasoning & Problem Solving",
  BUSINESS_TERMS: "Business Terms & Concepts",
  AWARENESS_MEMORY: "Business Awareness & Memory",
  VOCABULARY: "Vocabulary & Comprehension",
  NUMERICAL_PERCEPTION: "Detail Checking",
};

export function JobDescriptionPanel({
  jobProfileId,
  initialJobDescription,
  aiConfigured,
  readOnly,
  tailoredFormName,
  onApplyProposal,
}: {
  jobProfileId: string;
  initialJobDescription: string;
  aiConfigured: boolean;
  readOnly: boolean;
  tailoredFormName: string | null;
  onApplyProposal: (dimensions: ProposedDimension[]) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialJobDescription);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!initialJobDescription);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/jobs/${jobProfileId}/job-description`, {
        method: "PUT",
        body: { jobDescription: text },
      });
      setMessage("Job description saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ proposal: Proposal }>(
        `/api/admin/jobs/${jobProfileId}/job-description`,
        { body: { jobDescription: text } },
      );
      setProposal(res.proposal);
      setMessage(
        "Proposal ready. Review it, then apply what you agree with — nothing changes until you save the benchmark.",
      );
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "The proposal could not be generated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function buildForm(): Promise<void> {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        name: string;
        warnings: string[];
        estimatedMinutes: number;
      }>(`/api/admin/jobs/${jobProfileId}/assessment-form`, {
        body: {
          sections: proposal.sectionEmphasis.map((s) => ({
            sectionKey: s.sectionKey,
            include: s.include,
            questionCount: s.questionCount,
          })),
        },
      });
      setMessage(
        `Created ${res.name} (about ${res.estimatedMinutes} minutes). New invitations for this role will use it.` +
          (res.warnings.length ? ` Adjustments: ${res.warnings.join(" ")}` : ""),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the form.");
    } finally {
      setBusy(false);
    }
  }

  async function revertForm(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/admin/jobs/${jobProfileId}/assessment-form`, {
        method: "DELETE",
      });
      setMessage("Reverted to the standard assessment form.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-navy-900">Job description</h3>
          <p className="mt-1 text-xs text-navy-500">
            Paste the description and FSW WorkFit will propose which dimensions
            are job-related, the desired 1-9 ranges, and how the assessment
            should be weighted for this role.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tailoredFormName && (
            <Badge tone="blue">Tailored form: {tailoredFormName}</Badge>
          )}
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : text ? "Edit" : "Add"}
          </Button>
        </div>
      </div>

      {message && (
        <p role="status" className="mt-3 rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {expanded && (
        <>
          <Textarea
            className="mt-4 font-sans"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the full job description — responsibilities, requirements, day-to-day duties…"
            disabled={readOnly}
            aria-label="Job description"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy || readOnly}
              onClick={() => void save()}
            >
              Save description
            </Button>
            <Button
              disabled={busy || readOnly || !aiConfigured || text.trim().length < 80}
              onClick={() => void generate()}
            >
              {busy ? "Analyzing…" : "Generate recommended ranges"}
            </Button>
            {tailoredFormName && (
              <Button
                variant="ghost"
                className="text-xs"
                disabled={busy || readOnly}
                onClick={() => void revertForm()}
              >
                Revert to standard form
              </Button>
            )}
          </div>
          {!aiConfigured && (
            <p className="mt-2 text-xs text-amber-700">
              Set an <code className="font-mono">ANTHROPIC_API_KEY</code> environment
              variable to enable AI proposals. You can still write the
              description and set ranges by hand.
            </p>
          )}
        </>
      )}

      {proposal && (
        <div className="mt-6 space-y-4 border-t border-navy-100 pt-5">
          <div>
            <h4 className="text-sm font-bold text-navy-900">Role summary</h4>
            <p className="mt-1 text-sm text-navy-700">{proposal.roleSummary}</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-navy-600">
              {proposal.keyResponsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              {proposal.isSalesRole && <Badge tone="blue">Sales analysis suggested</Badge>}
              {proposal.leadershipModuleEnabled && (
                <Badge tone="navy">Leadership module suggested</Badge>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-navy-900">Proposed ranges</h4>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="py-2">Dimension</th>
                    <th className="py-2">Range</th>
                    <th className="py-2">Weight</th>
                    <th className="py-2">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {proposal.dimensions.map((d) => {
                    const meta = dimensionMeta.find((m) => m.construct === d.construct);
                    return (
                      <tr key={d.construct} className={d.enabled ? "" : "opacity-45"}>
                        <td className="py-2 pr-3 font-medium text-navy-800">
                          {meta?.name ?? d.construct}
                          {d.required && d.enabled && (
                            <span className="ml-1 text-xs text-fsw-600">required</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono text-navy-700">
                          {d.enabled ? `${d.minScore}–${d.maxScore}` : "not measured"}
                        </td>
                        <td className="py-2 pr-3 text-navy-600">
                          {d.enabled ? `×${d.weight}` : "—"}
                        </td>
                        <td className="py-2 text-xs text-navy-500">{d.rationale}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button
              className="mt-3"
              disabled={readOnly}
              onClick={() => {
                onApplyProposal(proposal.dimensions);
                setMessage(
                  "Applied to the editor below. Review each range, then press Save benchmark to commit.",
                );
              }}
            >
              Apply to benchmark editor
            </Button>
          </div>

          <div>
            <h4 className="text-sm font-bold text-navy-900">
              Proposed assessment emphasis
            </h4>
            <p className="mt-1 text-xs text-navy-500">
              Creating a tailored form makes a new, versioned assessment for
              this role. Existing candidates keep the form they were served.
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {proposal.sectionEmphasis.map((s) => (
                <li
                  key={s.sectionKey}
                  className={`flex flex-wrap items-baseline justify-between gap-2 rounded border border-navy-100 p-2 ${
                    s.include ? "" : "opacity-45"
                  }`}
                >
                  <span className="font-medium text-navy-800">
                    {SECTION_LABELS[s.sectionKey] ?? s.sectionKey}
                  </span>
                  <span className="text-navy-600">
                    {s.include ? `${s.questionCount} items` : "excluded"}
                  </span>
                  <span className="w-full text-xs text-navy-500">{s.rationale}</span>
                </li>
              ))}
            </ul>
            <Button
              className="mt-3"
              variant="secondary"
              disabled={busy || readOnly}
              onClick={() => void buildForm()}
            >
              Create role-tailored assessment form
            </Button>
          </div>

          {proposal.interviewThemes.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-navy-900">Interview themes</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-navy-700">
                {proposal.interviewThemes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {proposal.cautions.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3">
              <h4 className="text-sm font-bold text-amber-900">Cautions</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
                {proposal.cautions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-navy-400">
            These are proposals from a job-description reading, not a validated
            job analysis. Review every range against what the role actually
            requires — the person who saves the benchmark owns it.
          </p>
        </div>
      )}
    </Card>
  );
}
