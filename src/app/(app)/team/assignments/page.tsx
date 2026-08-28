import { requireAnyPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getTeamMemberIds } from "@/lib/services/people";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { TeamAssignPanel } from "@/app/(app)/team/assignments/team-assign-panel";

export const metadata = { title: "Team Assignments" };

export default async function TeamAssignmentsPage() {
  const actor = await requireAnyPermission(["team.assign", "training.assign"]);
  const teamIds = await getTeamMemberIds(actor.id);

  if (teamIds.length === 0) {
    return (
      <>
        <PageHeader title="Assignments" crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "Assignments" }]} />
        <PageBody>
          <EmptyState icon={<Icon name="assignment" className="h-5 w-5" />} title="No one reports to you yet" />
        </PageBody>
      </>
    );
  }

  const [members, courses, sops, paths, outstandingRaw] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: teamIds }, status: "ACTIVE" }, select: { id: true, name: true, image: true }, orderBy: { name: "asc" } }),
    prisma.course.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.sop.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.learningPath.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.assignment.findMany({
      where: { userId: { in: teamIds }, status: { in: ["ASSIGNED", "IN_PROGRESS", "OVERDUE"] } },
      include: {
        user: { select: { name: true } },
        course: { select: { title: true } },
        sop: { select: { title: true } },
        path: { select: { title: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 200,
    }),
  ]);

  const outstanding = outstandingRaw.map((a) => ({
    id: a.id,
    userId: a.userId,
    userName: a.user.name,
    title: a.course?.title ?? a.sop?.title ?? a.path?.title ?? "Untitled training",
    status: a.status,
    dueAt: a.dueAt,
    reason: a.reason,
  }));

  return (
    <>
      <PageHeader
        title="Assign training"
        description="Assign, waive, or remove training for your reporting line."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "Assignments" }]}
      />
      <PageBody>
        <TeamAssignPanel members={members} courses={courses} sops={sops} paths={paths} outstanding={outstanding} timezone={actor.timezone} />
      </PageBody>
    </>
  );
}
