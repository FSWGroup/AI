import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getTeamMemberIds } from "@/lib/services/people";
import { getTeamSkillMatrix } from "@/lib/services/skills";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { PersonAvatar } from "@/components/people/avatar";
import { formatDueDate, formatShortDate } from "@/lib/dates";

export const metadata = { title: "Team" };

export default async function TeamDashboardPage() {
  const actor = await requirePermission("team.view");
  const teamIds = await getTeamMemberIds(actor.id);

  if (teamIds.length === 0) {
    return (
      <>
        <PageHeader title="Team" crumbs={[{ label: "Home", href: "/home" }, { label: "Team" }]} />
        <PageBody>
          <EmptyState
            icon={<Icon name="team" className="h-5 w-5" />}
            title="No one reports to you yet"
            description="Once people are set up with you as their manager, their training status will appear here."
          />
        </PageBody>
      </>
    );
  }

  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const since14Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const since30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    statusCounts,
    overduePeople,
    upcomingDeadlines,
    recentHires,
    certificatesExpiring,
    recentlyCompleted,
    skillMatrix,
    pendingPracticalDemos,
  ] = await Promise.all([
    prisma.assignment.groupBy({ by: ["status"], where: { userId: { in: teamIds } }, _count: { _all: true } }),
    prisma.user.findMany({
      where: { id: { in: teamIds }, assignments: { some: { status: "OVERDUE" } } },
      select: { id: true, name: true, image: true, _count: { select: { assignments: { where: { status: "OVERDUE" } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.assignment.findMany({
      where: { userId: { in: teamIds }, status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { gte: now, lte: in14Days } },
      include: {
        user: { select: { id: true, name: true, image: true } },
        course: { select: { title: true } },
        sop: { select: { title: true } },
        path: { select: { title: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.user.findMany({
      where: { id: { in: teamIds }, startDate: { gte: since30Days } },
      select: {
        id: true,
        name: true,
        image: true,
        startDate: true,
        _count: { select: { assignments: true } },
        assignments: { where: { status: "COMPLETED" }, select: { id: true } },
      },
    }),
    prisma.certificate.findMany({
      where: { userId: { in: teamIds }, revokedAt: null, expiresAt: { gte: now, lte: in60Days } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { expiresAt: "asc" },
      take: 10,
    }),
    prisma.completionRecord.findMany({
      where: { userId: { in: teamIds }, completedAt: { gte: since14Days } },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { id: true, titleSnapshot: true, completedAt: true, userSnapshot: true, userId: true },
    }),
    getTeamSkillMatrix(actor, actor.id),
    prisma.lessonProgress.findMany({
      where: { userId: { in: teamIds }, status: "COMPLETED", lesson: { type: "PRACTICAL_DEMO" } },
      include: { user: { select: { id: true, name: true } }, lesson: { select: { id: true, title: true } } },
      orderBy: { completedAt: "desc" },
      take: 20,
    }),
  ]);

  const totalAssignments = statusCounts.reduce((sum, s) => sum + s._count._all, 0);
  const completed = statusCounts.find((s) => s.status === "COMPLETED")?._count._all ?? 0;
  const completionPercent = totalAssignments > 0 ? Math.round((completed / totalAssignments) * 100) : 100;

  const peopleWithGaps = Object.entries(skillMatrix.cells).filter(([, row]) => Object.values(row).some((c) => c?.gap)).length;

  const assessedLessonIds = new Set(
    (
      await prisma.skillAssessment.findMany({
        where: { userId: { in: teamIds }, lessonId: { in: pendingPracticalDemos.map((p) => p.lessonId) } },
        select: { userId: true, lessonId: true },
      })
    ).map((a) => `${a.userId}:${a.lessonId}`),
  );
  const awaitingSignoff = pendingPracticalDemos.filter((p) => !assessedLessonIds.has(`${p.userId}:${p.lessonId}`));

  return (
    <>
      <PageHeader
        title="Team"
        description={`${teamIds.length} ${teamIds.length === 1 ? "person" : "people"} in your reporting line.`}
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team" }]}
      />
      <PageBody className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-4">
              <ProgressRing value={completionPercent} label="Team training completion" size={64} />
              <div>
                <p className="text-[0.75rem] text-[var(--text-muted)]">Team completion</p>
                <p className="text-[1.0625rem] font-semibold text-[var(--text-primary)]">
                  {completed}/{totalAssignments}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-[0.75rem] text-[var(--text-muted)]">Overdue people</p>
              <p className="text-[1.75rem] font-semibold text-danger-700">{overduePeople.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-[0.75rem] text-[var(--text-muted)]">People with skill gaps</p>
              <p className="text-[1.75rem] font-semibold text-[var(--text-primary)]">{peopleWithGaps}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-[0.75rem] text-[var(--text-muted)]">Awaiting your sign-off</p>
              <p className="text-[1.75rem] font-semibold text-[var(--text-primary)]">{awaitingSignoff.length}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Overdue</CardTitle>
            </CardHeader>
            <CardContent>
              {overduePeople.length === 0 ? (
                <p className="text-[0.8125rem] text-[var(--text-muted)]">No one on your team is overdue.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {overduePeople.map((p) => (
                    <li key={p.id}>
                      <Link href={`/people/${p.id}`} className="flex items-center justify-between gap-2 hover:underline">
                        <span className="flex items-center gap-2">
                          <PersonAvatar name={p.name} image={p.image} size={26} />
                          <span className="text-[0.8125rem] text-[var(--text-primary)]">{p.name}</span>
                        </span>
                        <Badge tone="danger">{p._count.assignments} overdue</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming deadlines (next 14 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingDeadlines.length === 0 ? (
                <p className="text-[0.8125rem] text-[var(--text-muted)]">Nothing due soon.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {upcomingDeadlines.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <PersonAvatar name={a.user.name} image={a.user.image} size={26} />
                        <span className="text-[0.8125rem] text-[var(--text-primary)]">
                          {a.user.name}
                          <span className="text-[var(--text-muted)]"> — {a.course?.title ?? a.sop?.title ?? a.path?.title}</span>
                        </span>
                      </span>
                      <span className="text-[0.75rem] text-[var(--text-muted)]">{formatDueDate(a.dueAt, actor.timezone)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Onboarding (started in the last 30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {recentHires.length === 0 ? (
                <p className="text-[0.8125rem] text-[var(--text-muted)]">No recent hires on your team.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {recentHires.map((p) => {
                    const percent = p._count.assignments > 0 ? Math.round((p.assignments.length / p._count.assignments) * 100) : 0;
                    return (
                      <li key={p.id}>
                        <Link href={`/people/${p.id}`} className="flex items-center justify-between gap-2 hover:underline">
                          <span className="flex items-center gap-2">
                            <PersonAvatar name={p.name} image={p.image} size={26} />
                            <span className="text-[0.8125rem] text-[var(--text-primary)]">{p.name}</span>
                          </span>
                          <span className="text-[0.75rem] text-[var(--text-muted)]">
                            {percent}% · started {formatShortDate(p.startDate, actor.timezone)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Certificates expiring soon</CardTitle>
            </CardHeader>
            <CardContent>
              {certificatesExpiring.length === 0 ? (
                <p className="text-[0.8125rem] text-[var(--text-muted)]">Nothing expiring in the next 60 days.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {certificatesExpiring.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                      <span className="text-[var(--text-primary)]">
                        {c.user.name} <span className="text-[var(--text-muted)]">— {c.courseTitleSnapshot}</span>
                      </span>
                      <span className="text-[0.75rem] text-warning-700">{formatShortDate(c.expiresAt, actor.timezone)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Awaiting your sign-off</CardTitle>
            </CardHeader>
            <CardContent>
              {awaitingSignoff.length === 0 ? (
                <p className="text-[0.8125rem] text-[var(--text-muted)]">No practical demos waiting on a rating.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {awaitingSignoff.map((p) => (
                    <li key={p.id}>
                      <Link href="/team/approvals" className="flex items-center justify-between gap-2 hover:underline">
                        <span className="text-[0.8125rem] text-[var(--text-primary)]">{p.user.name}</span>
                        <span className="text-[0.75rem] text-[var(--text-muted)]">{p.lesson.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recently completed</CardTitle>
            </CardHeader>
            <CardContent>
              {recentlyCompleted.length === 0 ? (
                <p className="text-[0.8125rem] text-[var(--text-muted)]">No completions in the last 14 days.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {recentlyCompleted.map((c) => {
                    const snapshot = c.userSnapshot as { name?: string } | null;
                    return (
                      <li key={c.id} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                        <span className="text-[var(--text-primary)]">
                          {snapshot?.name ?? "Someone"} <span className="text-[var(--text-muted)]">— {c.titleSnapshot}</span>
                        </span>
                        <span className="text-[0.75rem] text-success-700">{formatShortDate(c.completedAt, actor.timezone)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
