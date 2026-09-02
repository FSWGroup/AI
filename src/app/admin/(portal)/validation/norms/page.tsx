import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import {
  MIN_N_NORM_ACTIVE,
  MIN_N_NORM_DRAFT,
  normGateExplanation,
} from "@/lib/validation/gates";
import { previewNormTables, constructLabel } from "@/lib/validation/service";
import { NormActions, GenerateNormsButton } from "@/components/admin/NormActions";

export const dynamic = "force-dynamic";

export default async function NormsPage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_VALIDATION")) redirect("/admin");
  const canManage = can(user.role, "MANAGE_VALIDATION");

  const [previews, tables] = await Promise.all([
    previewNormTables({ population: "APPLICANTS" }),
    prisma.normTable.findMany({
      orderBy: [{ status: "asc" }, { effectiveDate: "desc" }],
      include: { sourceStudy: { select: { name: true } } },
    }),
  ]);

  const activatable = previews.filter((p) => p.table?.gate === "ACTIVATABLE").length;
  const normable = previews.length;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/validation" className="text-sm text-fsw-700 hover:underline">
        ← Validation
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow="Validation"
          title="Norm tables"
          description="Until a dimension has a norm table, its 1-9 band is provisional: a documented but arbitrary conversion, labelled as such on every report. A norm table replaces it with a stanine against a real, named reference group."
        />
      </div>

      <p className="mt-4 rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
        <span className="font-semibold text-navy-900">
          Norms come from the applicant pool, not from your hires.
        </span>{" "}
        The band on a candidate&apos;s report is used to compare them with the
        other people who applied. Norming on people who already got through
        would compare an applicant against a pre-selected group, make almost
        everyone look below average, and quietly change what the number claims.
      </p>

      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        What a table would look like today
      </h3>
      <p className="mt-1 text-sm text-navy-500">
        Built from every scored attempt in the system. {activatable} of{" "}
        {normable} dimensions have enough data to activate ({MIN_N_NORM_ACTIVE}{" "}
        cases); drafting starts at {MIN_N_NORM_DRAFT}. Distortion and
        Equivocation are absent on purpose — they flag how to read a profile,
        not where someone stands, so they stay on the provisional conversion
        permanently.
      </p>

      <Card className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
            <tr>
              <th className="px-4 py-3">Dimension</th>
              <th className="px-4 py-3">Scored attempts</th>
              <th className="px-4 py-3">Would move band</th>
              <th className="px-4 py-3">Gate</th>
            </tr>
          </thead>
          <tbody>
            {previews.map((p) => (
              <tr key={p.construct} className="border-b border-navy-50 last:border-0 align-top">
                <td className="px-4 py-3 font-semibold text-navy-900">{p.label}</td>
                <td className="px-4 py-3 text-navy-600">{p.sampleSize}</td>
                <td className="px-4 py-3 text-navy-600">
                  {p.shift ? (
                    <>
                      {p.shift.moved} of {p.shift.moved + p.shift.unchanged}
                      {p.shift.maxShift > 0 && (
                        <span className="block text-xs text-navy-400">
                          largest move: {p.shift.maxShift} band
                          {p.shift.maxShift === 1 ? "" : "s"}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    tone={
                      p.table?.gate === "ACTIVATABLE"
                        ? "green"
                        : p.table?.gate === "DRAFT_ONLY"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {p.table?.gate === "ACTIVATABLE"
                      ? "Ready"
                      : p.table?.gate === "DRAFT_ONLY"
                        ? "Draft only"
                        : "Blocked"}
                  </Badge>
                  {p.table?.gate !== "ACTIVATABLE" && (
                    <span className="mt-1 block text-xs text-navy-500">
                      {normGateExplanation(p.sampleSize)}
                    </span>
                  )}
                  {(p.table?.warnings ?? []).map((w, i) => (
                    <span key={i} className="mt-1 block text-xs text-amber-800">
                      {w}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {canManage && (
        <div className="mt-5">
          <GenerateNormsButton />
        </div>
      )}

      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        Saved tables
      </h3>
      <Card className="mt-3 overflow-x-auto">
        {tables.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            No norm tables exist. Every band this platform reports is
            provisional, and every report says so.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Dimension</th>
                <th className="px-4 py-3">Reference group</th>
                <th className="px-4 py-3">n</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id} className="border-b border-navy-50 last:border-0">
                  <td className="px-4 py-3 font-semibold text-navy-900">
                    {constructLabel(t.construct)}
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {t.population}
                    {t.sourceStudy && (
                      <span className="block text-xs text-navy-400">
                        from “{t.sourceStudy.name}”
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-600">{t.sampleSize}</td>
                  <td className="px-4 py-3 text-navy-600">
                    {t.effectiveDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          t.status === "ACTIVE"
                            ? "green"
                            : t.status === "DRAFT"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {t.status}
                      </Badge>
                      {canManage && (
                        <NormActions
                          normTableId={t.id}
                          status={t.status}
                          sampleSize={t.sampleSize}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
