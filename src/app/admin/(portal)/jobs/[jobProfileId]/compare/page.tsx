import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { scopedJobProfileIds } from "@/lib/auth/scope";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { dimensionMeta } from "@/content/narratives/dimension-meta";
import { classifyAgainstRange } from "@/lib/scoring/benchmark";

export const dynamic = "force-dynamic";

/**
 * Side-by-side benchmark comparison for candidates on the same opening.
 * Deliberately NOT a ranking: candidates appear alphabetically, there is no
 * composite ordering, and no #1/#2/#3 labels — benchmark comparison only.
 */
export default async function ComparePage({
  params,
}: {
  params: Promise<{ jobProfileId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_REPORTS")) redirect("/admin");
  const { jobProfileId } = await params;
  const scoped = await scopedJobProfileIds(user);
  if (scoped !== null && !scoped.includes(jobProfileId)) redirect("/admin");

  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
    include: {
      benchmarks: { where: { enabled: true } },
      openings: {
        include: {
          attempts: {
            where: { status: "COMPLETED" },
            include: { candidate: true, scores: true },
          },
        },
      },
    },
  });
  if (!profile) notFound();

  const attempts = profile.openings
    .flatMap((o) => o.attempts)
    .sort((a, b) =>
      `${a.candidate.lastName} ${a.candidate.firstName}`.localeCompare(
        `${b.candidate.lastName} ${b.candidate.firstName}`,
      ),
    );
  const dims = dimensionMeta.filter(
    (d) =>
      d.category !== "VALIDITY" &&
      profile.benchmarks.some((b) => b.construct === d.construct),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <SectionHeading
        eyebrow={profile.name}
        title="Candidate comparison"
        description="Candidates are listed alphabetically and compared against the job benchmark — this view does not rank candidates."
      />
      <Card className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
            <tr>
              <th className="px-4 py-3">Dimension</th>
              <th className="px-4 py-3">Desired</th>
              {attempts.map((a) => (
                <th key={a.id} className="px-4 py-3">
                  {a.candidate.firstName} {a.candidate.lastName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {dims.map((d) => {
              const bm = profile.benchmarks.find((b) => b.construct === d.construct)!;
              return (
                <tr key={d.construct}>
                  <td className="px-4 py-3 font-semibold text-navy-800">{d.name}</td>
                  <td className="px-4 py-3 text-navy-500">
                    {bm.minScore}–{bm.maxScore}
                  </td>
                  {attempts.map((a) => {
                    const score = a.scores.find((s) => s.construct === d.construct);
                    if (!score) {
                      return (
                        <td key={a.id} className="px-4 py-3 text-navy-300">
                          —
                        </td>
                      );
                    }
                    const pos = classifyAgainstRange(score.band, bm);
                    return (
                      <td key={a.id} className="px-4 py-3">
                        <span className="mr-2 font-bold text-navy-900">{score.band}</span>
                        <Badge tone={pos === "WITHIN" ? "green" : pos === "BELOW" ? "amber" : "blue"}>
                          {pos === "WITHIN" ? "In" : pos === "BELOW" ? "Below" : "Above"}
                        </Badge>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {attempts.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-navy-400">
            No completed assessments for this profile yet.
          </p>
        )}
      </Card>
    </div>
  );
}
