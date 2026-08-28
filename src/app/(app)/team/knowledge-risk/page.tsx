import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { getKnowledgeRisks, type KnowledgeRiskLevel } from "@/lib/services/insights";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Knowledge Risk" };

const LEVEL_LABEL: Record<KnowledgeRiskLevel, string> = {
  NOBODY: "Nobody covers this",
  SINGLE_HOLDER: "One person only",
  THIN: "Two people only",
};

const LEVEL_TONE: Record<KnowledgeRiskLevel, "danger" | "warning" | "blue"> = {
  NOBODY: "danger",
  SINGLE_HOLDER: "danger",
  THIN: "warning",
};

export default async function KnowledgeRiskPage() {
  const actor = await requirePermission("skills.view");
  const risks = await getKnowledgeRisks(actor);

  const nobody = risks.filter((r) => r.level === "NOBODY").length;
  const single = risks.filter((r) => r.level === "SINGLE_HOLDER").length;

  return (
    <>
      <PageHeader
        title="Knowledge risk"
        description="Skills the work depends on that too few people hold. A skills matrix shows who has what; this shows where losing one person would hurt."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "Knowledge Risk" }]}
        meta={
          risks.length > 0 ? (
            <>
              {nobody > 0 && (
                <Badge tone="danger" dot>
                  {nobody} uncovered
                </Badge>
              )}
              {single > 0 && (
                <Badge tone="danger" dot>
                  {single} single point{single === 1 ? "" : "s"} of failure
                </Badge>
              )}
            </>
          ) : undefined
        }
      />

      <PageBody className="flex flex-col gap-4">
        {risks.length === 0 ? (
          <EmptyState
            icon={<Icon name="matrix" className="h-5 w-5" />}
            title="No thin coverage to report"
            description="Every skill required by a position in your scope is held by at least three active people at the level the work needs. This page only reports skills a position actually requires — if it looks empty, check that positions carry skill requirements."
            actions={
              <Link
                href="/team/skills"
                className="inline-flex h-9.5 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                Open the skills matrix
              </Link>
            }
          />
        ) : (
          <>
            <p className="max-w-3xl text-[0.8125rem] text-[var(--text-muted)]">
              Ordered worst first. &ldquo;Depends on&rdquo; means a position requires the skill — the
              organization saying out loud that the work needs it. Cross-training the people who
              already depend on a skill is usually faster than hiring for it.
            </p>

            <ul aria-label="Skills at risk" className="flex flex-col gap-3">
              {risks.map((risk) => (
                <li key={risk.skillId}>
                  <Card>
                    <CardContent className="flex flex-col gap-3 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
                          {risk.skillName}
                        </h2>
                        <Badge tone={LEVEL_TONE[risk.level]}>{LEVEL_LABEL[risk.level]}</Badge>
                        {risk.category && <Badge tone="neutral">{risk.category}</Badge>}
                      </div>

                      <dl className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <dt className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                            Level the work needs
                          </dt>
                          <dd className="mt-0.5 text-[0.875rem] text-[var(--text-primary)]">
                            {risk.requiredLevel}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                            People who depend on it
                          </dt>
                          <dd className="mt-0.5 text-[0.875rem] text-[var(--text-primary)]">
                            {risk.dependentCount}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                            Who holds it
                          </dt>
                          <dd className="mt-0.5 text-[0.875rem] text-[var(--text-primary)]">
                            {risk.holders.length === 0 ? (
                              <span className="text-[var(--text-muted)]">Nobody, at this level</span>
                            ) : (
                              risk.holders.map((holder, index) => (
                                <span key={holder.id}>
                                  {index > 0 && ", "}
                                  <Link
                                    href={`/people/${holder.id}`}
                                    className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                                  >
                                    {holder.name}
                                  </Link>
                                </span>
                              ))
                            )}
                          </dd>
                        </div>
                      </dl>

                      {risk.howToSpread.length > 0 ? (
                        <div className="border-t border-[var(--border-subtle)] pt-3">
                          <p className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                            How to spread it
                          </p>
                          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {risk.howToSpread.map((course) => (
                              <li key={course.courseId} className="text-[0.8125rem]">
                                <Link
                                  href={`/courses/${course.courseId}`}
                                  className="rounded-sm text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                                >
                                  {course.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="border-t border-[var(--border-subtle)] pt-3 text-[0.8125rem] text-[var(--text-muted)]">
                          No published course covers this skill yet. Until one exists, spreading it
                          means shadowing whoever holds it — which is worth scheduling deliberately
                          rather than hoping it happens.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </PageBody>
    </>
  );
}
