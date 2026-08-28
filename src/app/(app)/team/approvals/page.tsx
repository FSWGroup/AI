import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getTeamMemberIds } from "@/lib/services/people";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { PersonAvatar } from "@/components/people/avatar";
import { AssessSkillForm } from "@/app/(app)/team/approvals/assess-skill-form";

export const metadata = { title: "Team Approvals" };

export default async function TeamApprovalsPage() {
  const actor = await requireAnyPermission(["team.approve", "skills.assess"]);
  const teamIds = await getTeamMemberIds(actor.id);

  const [pendingSignoffs, members, skills] = await Promise.all([
    teamIds.length === 0
      ? Promise.resolve([])
      : prisma.lessonProgress.findMany({
          where: { userId: { in: teamIds }, status: "IN_PROGRESS", lesson: { type: { in: ["MANAGER_SIGNOFF", "PRACTICAL_DEMO"] } } },
          include: {
            user: { select: { id: true, name: true, image: true } },
            lesson: { select: { id: true, title: true, type: true, section: { select: { courseId: true, course: { select: { title: true } } } } } },
          },
          orderBy: { updatedAt: "asc" },
          take: 100,
        }),
    teamIds.length === 0
      ? Promise.resolve([])
      : prisma.user.findMany({ where: { id: { in: teamIds }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.skill.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Pending sign-offs on your reports' training, and direct skill assessments."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "Approvals" }]}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Pending sign-offs</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingSignoffs.length === 0 ? (
              <EmptyState
                icon={<Icon name="approval" className="h-5 w-5" />}
                title="Nothing waiting on you"
                description="Manager sign-off and practical demo lessons your reports have started will appear here."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {pendingSignoffs.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/courses/${p.lesson.section.courseId}/lessons/${p.lesson.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="flex items-center gap-2.5">
                        <PersonAvatar name={p.user.name} image={p.user.image} size={28} />
                        <span>
                          <span className="block text-[0.8125rem] font-medium text-[var(--text-primary)]">{p.user.name}</span>
                          <span className="block text-[0.75rem] text-[var(--text-muted)]">
                            {p.lesson.section.course.title} — {p.lesson.title}
                          </span>
                        </span>
                      </span>
                      <Badge tone={p.lesson.type === "PRACTICAL_DEMO" ? "info" : "warning"}>
                        {p.lesson.type === "PRACTICAL_DEMO" ? "Practical demo" : "Manager sign-off"}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {actor.permissions.has("skills.assess") && (
          <Card>
            <CardHeader>
              <CardTitle>Assess a skill directly</CardTitle>
            </CardHeader>
            <CardContent>
              <AssessSkillForm members={members} skills={skills} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
