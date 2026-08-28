import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { getSkill, getSkillGaps } from "@/lib/services/skills";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { formatShortDate } from "@/lib/dates";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const skill = await prisma.skill.findUnique({ where: { id }, select: { name: true } });
  return { title: skill ? skill.name : "Skill" };
}

export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("skills.view");
  const { id } = await params;

  let skill: Awaited<ReturnType<typeof getSkill>>;
  try {
    skill = await getSkill(actor, id);
  } catch {
    notFound();
  }

  const [myUserSkill, skillLevels, gaps] = await Promise.all([
    prisma.userSkill.findUnique({ where: { userId_skillId: { userId: actor.id, skillId: id } } }),
    prisma.skillLevel.findMany({ orderBy: { value: "asc" } }),
    getSkillGaps(actor, actor.id),
  ]);

  const levelNameByValue = new Map(skillLevels.map((l) => [l.value, l.name]));
  const myGap = gaps.find((g) => g.skillId === id);
  const publishedCourses = skill.courses.filter((c) => c.course.status === "PUBLISHED");

  return (
    <>
      <PageHeader
        title={skill.name}
        description={skill.description ?? undefined}
        crumbs={[{ label: "Home", href: "/home" }, { label: "Skills", href: "/skills" }, { label: skill.name }]}
        meta={skill.category ? <Badge tone="neutral">{skill.category}</Badge> : undefined}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>My proficiency</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {myUserSkill ? (
              <>
                <Badge tone="blue">{levelNameByValue.get(myUserSkill.level) ?? myUserSkill.level}</Badge>
                <span className="text-[0.75rem] text-[var(--text-muted)]">
                  Source: {myUserSkill.source.replace(/_/g, " ").toLowerCase()} · Updated{" "}
                  {formatShortDate(myUserSkill.updatedAt, actor.timezone)}
                </span>
              </>
            ) : (
              <span className="text-[0.8125rem] text-[var(--text-muted)]">You haven&apos;t demonstrated this skill yet.</span>
            )}
            {myGap && (
              <Badge tone="warning">
                Gap: needs level {levelNameByValue.get(myGap.requiredLevel) ?? myGap.requiredLevel} for your position
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to earn it</CardTitle>
          </CardHeader>
          <CardContent>
            {publishedCourses.length === 0 ? (
              <EmptyState
                icon={<Icon name="training" className="h-5 w-5" />}
                title="No linked training yet"
                description="This skill isn't currently granted by any published course. It may be assessed directly by a manager."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {publishedCourses.map((c) => (
                  <li key={c.course.id}>
                    <Link
                      href={`/catalog/${c.course.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="text-[0.8125rem] font-medium text-[var(--text-primary)]">{c.course.title}</span>
                      {c.levelValue != null && (
                        <Badge tone="success">Grants {levelNameByValue.get(c.levelValue) ?? c.levelValue}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {skill.requirements.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Required by positions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {skill.requirements.map((r) => (
                <Badge key={r.position.id} tone="neutral">
                  {r.position.title} ({levelNameByValue.get(r.requiredLevel) ?? r.requiredLevel})
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
