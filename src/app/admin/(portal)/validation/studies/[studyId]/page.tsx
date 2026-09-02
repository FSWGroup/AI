import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { VERDICT_LABEL, VERDICT_MEANING, type CoefficientVerdict } from "@/lib/validation/gates";
import { StudyActions } from "@/components/admin/StudyActions";

export const dynamic = "force-dynamic";

const VERDICT_TONE: Record<CoefficientVerdict, "green" | "amber" | "neutral" | "red"> = {
  SUPPORTED: "green",
  PRELIMINARY: "amber",
  NOT_SUPPORTED: "neutral",
  INSUFFICIENT: "neutral",
};

interface StudySummary {
  n?: number;
  criterionDescription?: string;
  criterionDichotomous?: boolean;
  reliabilityUsed?: number | null;
  criterionReliability?: {
    icc1: number;
    iccK: number;
    targets: number;
    meanRaters: number;
    clampedToZero: boolean;
  } | null;
  warnings?: string[];
  excludedCount?: number;
  uncomputable?: { label: string; notes: string[] }[];
  notesByPredictor?: Record<string, string[]>;
  hiresInScope?: number;
}

const r2 = (v: number | null): string => {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(2);
  return s.startsWith("0.") ? s.slice(1) : s.startsWith("-0.") ? `-${s.slice(2)}` : s;
};

const p3 = (v: number): string =>
  !Number.isFinite(v) ? "—" : v < 0.001 ? "<.001" : v.toFixed(3).replace(/^0/, "");

export default async function StudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_VALIDATION")) redirect("/admin");
  const { studyId } = await params;

  const study = await prisma.validationStudy.findUnique({
    where: { id: studyId },
    include: {
      jobProfile: { select: { name: true } },
      coefficients: { orderBy: { r: "desc" } },
    },
  });
  if (!study) notFound();

  const summary = (study.summary ?? {}) as StudySummary;
  const canManage = can(user.role, "MANAGE_VALIDATION");
  const ordered = [...study.coefficients].sort(
    (a, b) => Math.abs(b.r) - Math.abs(a.r),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/validation" className="text-sm text-fsw-700 hover:underline">
        ← Validation
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow={study.jobProfile?.name ?? "All roles"}
          title={study.name}
          description={study.description ?? undefined}
        />
      </div>

      <StudyActions studyId={study.id} canManage={canManage} computed={study.computedAt !== null} />

      {study.computedAt === null ? (
        <Card className="mt-6 p-6">
          <p className="text-sm text-navy-600">
            This study has not been computed yet. Running it gathers every hire
            in scope who has both an assessment attempt and a criterion value,
            and correlates the two.
          </p>
        </Card>
      ) : (
        <>
          {/* ---- What was measured ---- */}
          <Card className="mt-6 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
              The criterion
            </p>
            <p className="mt-1 text-sm font-semibold text-navy-900">
              {summary.criterionDescription ?? "—"}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-navy-400">Sample</p>
                <p className="text-lg font-bold text-navy-900">{summary.n ?? 0} hires</p>
                {summary.hiresInScope !== undefined && (
                  <p className="text-xs text-navy-500">
                    of {summary.hiresInScope} in scope
                    {summary.excludedCount ? `, ${summary.excludedCount} without a criterion value` : ""}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-navy-400">
                  Criterion reliability
                </p>
                <p className="text-lg font-bold text-navy-900">
                  {summary.criterionReliability
                    ? r2(summary.criterionReliability.iccK)
                    : "Not estimable"}
                </p>
                <p className="text-xs text-navy-500">
                  {summary.criterionReliability
                    ? `${summary.criterionReliability.targets} hires with 2+ raters`
                    : "Needs a second rater on some reviews"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-navy-400">Computed</p>
                <p className="text-lg font-bold text-navy-900">
                  {study.computedAt.toISOString().slice(0, 10)}
                </p>
              </div>
            </div>
          </Card>

          {/* ---- Warnings ---- */}
          {(summary.warnings ?? []).length > 0 && (
            <div className="mt-5 space-y-2">
              {(summary.warnings ?? []).map((w, i) => (
                <p key={i} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* ---- Coefficients ---- */}
          <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
            What predicted the criterion
          </h3>
          <p className="mt-1 text-sm text-navy-500">
            <span className="font-semibold">r</span> is the relationship in this
            sample. The confidence interval says how precisely it was measured —
            an interval spanning zero means the direction itself is uncertain.
            <span className="font-semibold"> q</span> is the p value adjusted for
            testing every dimension at once.
          </p>
          <Card className="mt-3 overflow-x-auto">
            {ordered.length === 0 ? (
              <p className="p-4 text-sm text-navy-500">
                No coefficient could be computed for any dimension. See the
                warnings above.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="px-4 py-3">Dimension</th>
                    <th className="px-4 py-3">n</th>
                    <th className="px-4 py-3">r</th>
                    <th className="px-4 py-3">95% CI</th>
                    <th className="px-4 py-3">q</th>
                    <th className="px-4 py-3">Corrected</th>
                    <th className="px-4 py-3">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((c) => (
                    <tr key={c.id} className="border-b border-navy-50 last:border-0 align-top">
                      <td className="px-4 py-3 font-semibold text-navy-900">
                        {c.label}
                        {(summary.notesByPredictor?.[c.construct ?? c.compositeKey ?? ""] ?? []).map(
                          (note, i) => (
                            <span key={i} className="mt-1 block text-xs font-normal text-navy-500">
                              {note}
                            </span>
                          ),
                        )}
                      </td>
                      <td className="px-4 py-3 text-navy-600">{c.n}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-navy-900">
                        {r2(c.r)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-navy-600">
                        {r2(c.ciLow)} to {r2(c.ciHigh)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-navy-600">
                        {p3(c.qValue)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-navy-600">
                        {c.rFullyCorrected !== null
                          ? r2(c.rFullyCorrected)
                          : c.rRangeCorrected !== null
                            ? r2(c.rRangeCorrected)
                            : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={VERDICT_TONE[c.verdict as CoefficientVerdict] ?? "neutral"}
                          className="whitespace-nowrap"
                        >
                          {VERDICT_LABEL[c.verdict as CoefficientVerdict] ?? c.verdict}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {(summary.uncomputable ?? []).length > 0 && (
            <Card className="mt-4 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                No coefficient could be computed for
              </p>
              <ul className="mt-2 space-y-1 text-sm text-navy-600">
                {(summary.uncomputable ?? []).map((u, i) => (
                  <li key={i}>
                    <span className="font-semibold text-navy-800">{u.label}</span> —{" "}
                    {u.notes[0] ?? "Insufficient data."}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ---- How to read it ---- */}
          <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
            How to read these verdicts
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["SUPPORTED", "PRELIMINARY", "NOT_SUPPORTED", "INSUFFICIENT"] as const).map((v) => (
              <Card key={v} className="p-4">
                <Badge tone={VERDICT_TONE[v]}>{VERDICT_LABEL[v]}</Badge>
                <p className="mt-2 text-sm text-navy-600">{VERDICT_MEANING[v]}</p>
              </Card>
            ))}
          </div>

          <p className="mt-6 rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
            <span className="font-semibold text-navy-900">
              A supported coefficient is not an instruction.
            </span>{" "}
            This study reports what moved with what. Changing a benchmark, a
            required range, or how a dimension is used in hiring is a decision a
            person makes after reading the whole study. Nothing here is applied
            automatically, and no score in this platform rejects anyone.
          </p>
        </>
      )}
    </div>
  );
}
