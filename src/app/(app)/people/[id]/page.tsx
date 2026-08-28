import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getPerson } from "@/lib/services/people";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/ui/progress";
import { PersonAvatar } from "@/components/people/avatar";
import { StatusBadge, WorkerTypeBadge } from "@/components/people/badges";
import { SensitiveFieldsPanel } from "@/components/people/sensitive-fields-panel";
import { PersonProfileTabs } from "@/components/people/person-profile-tabs";
import { formatShortDate } from "@/lib/dates";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return { title: user ? user.name : "Person" };
}

export default async function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("people.view");
  const { id } = await params;

  let profile: Awaited<ReturnType<typeof getPerson>>;
  try {
    profile = await getPerson(actor, id);
  } catch {
    notFound();
  }

  const [assignmentsRaw, position] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId: id },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      include: { course: { select: { title: true } }, sop: { select: { title: true } }, path: { select: { title: true } } },
    }),
    profile.position
      ? prisma.position.findUnique({ where: { id: profile.position.id }, select: { responsibilities: true, toolsUsed: true } })
      : Promise.resolve(null),
  ]);

  const assignments = assignmentsRaw.map((a) => ({
    id: a.id,
    targetType: a.targetType,
    status: a.status,
    dueAt: a.dueAt,
    completedAt: a.completedAt,
    reason: a.reason,
    title: a.course?.title ?? a.sop?.title ?? a.path?.title ?? "Untitled training",
  }));

  const responsibilities = Array.isArray(position?.responsibilities)
    ? (position.responsibilities.filter((v): v is string => typeof v === "string"))
    : [];
  const toolsUsed = Array.isArray(position?.toolsUsed) ? position.toolsUsed.filter((v): v is string => typeof v === "string") : [];

  const total = profile.assignmentSummary.total;
  const completionPercent = total > 0 ? Math.round((profile.assignmentSummary.completed / total) * 100) : 0;

  return (
    <>
      <PageHeader
        title={profile.name}
        crumbs={[{ label: "Home", href: "/home" }, { label: "People", href: "/people" }, { label: profile.name }]}
        meta={
          <>
            <StatusBadge status={profile.status} />
            <WorkerTypeBadge workerType={profile.workerType} />
            {profile.department && <Badge tone="neutral">{profile.department.name}</Badge>}
          </>
        }
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <PersonAvatar name={profile.name} image={profile.image} size={64} />
              <div>
                <p className="text-[1.0625rem] font-semibold text-[var(--text-primary)]">{profile.name}</p>
                {profile.title && <p className="text-[0.875rem] text-[var(--text-muted)]">{profile.title}</p>}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem] text-[var(--text-muted)]">
                  <span>{profile.email}</span>
                  {profile.workPhone && <span>{profile.workPhone}</span>}
                  {profile.team && <span>{profile.team.name}</span>}
                  {profile.location && <span>{profile.location.name}</span>}
                  <span>{profile.timezone}</span>
                  {profile.startDate && <span>Started {formatShortDate(profile.startDate, profile.timezone)}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ProgressRing value={completionPercent} label="Training completion" size={56} />
              <div className="text-[0.75rem] text-[var(--text-muted)]">
                <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
                  {profile.assignmentSummary.completed}/{total}
                </p>
                <p>Training complete</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
          <PersonProfileTabs
            timezone={profile.timezone}
            responsibilities={responsibilities}
            toolsUsed={toolsUsed}
            assignments={assignments}
            skills={profile.skills}
            certificates={profile.certificates}
          />

          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col gap-3">
                <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">Reporting line</h3>
                {profile.manager ? (
                  <Link href={`/people/${profile.manager.id}`} className="flex items-center gap-2 hover:underline">
                    <PersonAvatar name={profile.manager.name} image={profile.manager.image} size={28} />
                    <span className="text-[0.8125rem] text-[var(--text-primary)]">{profile.manager.name}</span>
                  </Link>
                ) : (
                  <p className="text-[0.75rem] text-[var(--text-muted)]">No manager on file.</p>
                )}
                {profile.reports.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      Direct reports ({profile.reports.length})
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {profile.reports.map((r) => (
                        <li key={r.id}>
                          <Link href={`/people/${r.id}`} className="flex items-center gap-2 hover:underline">
                            <PersonAvatar name={r.name} image={r.image} size={24} />
                            <span className="text-[0.8125rem] text-[var(--text-primary)]">{r.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {profile.roles.length > 0 && (
              <Card>
                <CardContent className="flex flex-col gap-2">
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">Roles</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.roles.map((r) => (
                      <Badge key={r.key} tone="navy">
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {actor.permissions.has("people.sensitive_view") && <SensitiveFieldsPanel userId={profile.id} />}
      </PageBody>
    </>
  );
}
