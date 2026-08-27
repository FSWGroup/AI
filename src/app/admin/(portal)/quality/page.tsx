import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Minimum sample before statistics stop being labeled provisional. */
const PROVISIONAL_BELOW_N = 100;

export default async function QualityPage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_QUALITY")) redirect("/admin");

  const stats = await prisma.itemStatistic.findMany({
    include: {
      questionVersion: {
        select: { construct: true, subtype: true, difficulty: true, prompt: true },
      },
    },
    orderBy: { administered: "desc" },
    take: 200,
  });

  const byConstruct = new Map<
    string,
    { administered: number; correct: number; unanswered: number; items: number }
  >();
  for (const s of stats) {
    const c = s.questionVersion.construct;
    const agg = byConstruct.get(c) ?? {
      administered: 0,
      correct: 0,
      unanswered: 0,
      items: 0,
    };
    agg.administered += s.administered;
    agg.correct += s.correctCount;
    agg.unanswered += s.unansweredCount;
    agg.items++;
    byConstruct.set(c, agg);
  }

  const normTables = await prisma.normTable.findMany({
    orderBy: { effectiveDate: "desc" },
  });
  const totalAdministered = stats.reduce((a, s) => a + s.administered, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeading
        title="Assessment Quality"
        description="Anonymous aggregate item statistics for psychometric calibration. No candidate identities appear here."
      />

      {totalAdministered < PROVISIONAL_BELOW_N && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Provisional: fewer than {PROVISIONAL_BELOW_N} administrations have been
          recorded. Do not treat these statistics as stable until an adequate
          sample exists. Reliability coefficients and norms are never fabricated
          — install norm tables only from real calibration data.
        </p>
      )}

      <Card className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
            <tr>
              <th className="px-4 py-3">Construct</th>
              <th className="px-4 py-3">Items with data</th>
              <th className="px-4 py-3">Administered</th>
              <th className="px-4 py-3">% correct</th>
              <th className="px-4 py-3">Missing rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {[...byConstruct.entries()].map(([c, agg]) => (
              <tr key={c}>
                <td className="px-4 py-3 font-semibold text-navy-800">{c}</td>
                <td className="px-4 py-3 text-navy-600">{agg.items}</td>
                <td className="px-4 py-3 text-navy-600">{agg.administered}</td>
                <td className="px-4 py-3 text-navy-600">
                  {agg.administered > 0
                    ? `${Math.round((agg.correct / agg.administered) * 100)}%`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-navy-600">
                  {agg.administered > 0
                    ? `${Math.round((agg.unanswered / agg.administered) * 100)}%`
                    : "—"}
                </td>
              </tr>
            ))}
            {byConstruct.size === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-navy-400">
                  No item statistics yet — they accumulate as candidates complete
                  assessments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="mt-8">
        <SectionHeading
          title="Norm tables"
          description="Validated stanine conversion applies only where a norm table exists. Until then, 1-9 scores are provisional internal bands."
        />
        <Card className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Construct</th>
                <th className="px-4 py-3">Population</th>
                <th className="px-4 py-3">Sample</th>
                <th className="px-4 py-3">Methodology</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {normTables.map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-3 font-semibold text-navy-800">{n.construct}</td>
                  <td className="px-4 py-3 text-navy-600">{n.population}</td>
                  <td className="px-4 py-3 text-navy-600">{n.sampleSize}</td>
                  <td className="px-4 py-3 text-navy-600">{n.methodology}</td>
                  <td className="px-4 py-3 text-navy-600">
                    {n.effectiveDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={n.status === "ACTIVE" ? "green" : "neutral"}>
                      {n.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {normTables.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-navy-400">
                    No norm tables installed. All reports use provisional 1-9
                    bands. Import calibrated norms via the API or seed tooling
                    once real normative data exists.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
