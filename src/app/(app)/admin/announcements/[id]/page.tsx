import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getAnnouncement, getAcknowledgementReport, targetModeFromAnnouncement } from "@/lib/services/announcements";
import { ROLE_LABELS, type RoleKey } from "@/lib/permissions";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { AnnouncementForm, type TargetOptions } from "@/app/(app)/admin/announcements/announcement-form";
import { DeleteAnnouncementButton } from "@/app/(app)/admin/announcements/[id]/delete-button";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export default async function AnnouncementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("announcements.manage");
  const { id } = await params;
  const announcement = await getAnnouncement(id);
  if (!announcement) notFound();

  const [businessUnits, departments, teams, locations, roles, ackReport] = await Promise.all([
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ select: { key: true, name: true }, orderBy: { name: "asc" } }),
    announcement.requiresAck ? getAcknowledgementReport(id) : Promise.resolve(null),
  ]);

  const options: TargetOptions = {
    businessUnits,
    departments,
    teams,
    locations,
    roles: roles.map((r) => ({ key: r.key, name: ROLE_LABELS[r.key as RoleKey] ?? r.name })),
  };

  const targetMode = targetModeFromAnnouncement(announcement);
  const targetId = announcement.businessUnitId ?? announcement.departmentId ?? announcement.teamId ?? announcement.locationId ?? announcement.roleKey ?? null;

  return (
    <div>
      <PageHeader
        title={announcement.title}
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Announcements", href: "/admin/announcements" }, { label: "Edit" }]}
        actions={<DeleteAnnouncementButton id={id} />}
      />
      <PageBody className="flex flex-col gap-8">
        <div>
          <SectionHeading title="Edit" />
          <AnnouncementForm
            initial={{
              id: announcement.id,
              title: announcement.title,
              body: announcement.body,
              targetMode,
              targetId,
              startsAt: announcement.startsAt.toISOString(),
              expiresAt: announcement.expiresAt?.toISOString() ?? null,
              pinned: announcement.pinned,
              requiresAck: announcement.requiresAck,
            }}
            options={options}
          />
        </div>

        {announcement.requiresAck && (
          <div>
            <SectionHeading title="Acknowledgement report" description="Who has and hasn't acknowledged this announcement yet." />
            {!ackReport ? (
              <EmptyState icon={<Icon name="approval" className="h-5 w-5" />} title="No one is targeted yet" />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="max-w-sm">
                  <div className="mb-1 flex items-center justify-between text-[0.8125rem]">
                    <span className="font-medium text-[var(--text-primary)]">
                      {ackReport.acknowledgedCount} of {ackReport.targetedCount} acknowledged
                    </span>
                    <span className="text-[var(--text-muted)]">{ackReport.rate}%</span>
                  </div>
                  <ProgressBar value={ackReport.rate} label="Acknowledgement rate" tone={ackReport.rate >= 90 ? "success" : ackReport.rate >= 50 ? "brand" : "warning"} />
                </div>
                {ackReport.outstanding.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[0.8125rem] font-medium text-[var(--text-primary)]">
                      Outstanding ({ackReport.outstandingTotal})
                    </p>
                    <ul className="max-h-64 overflow-y-auto rounded-md border border-[var(--border-subtle)]">
                      {ackReport.outstanding.map((u) => (
                        <li key={u.id} className="flex justify-between border-b border-[var(--border-subtle)] px-3 py-1.5 text-[0.8125rem] last:border-0">
                          <span className="text-[var(--text-primary)]">{u.name}</span>
                          <span className="text-[var(--text-muted)]">{u.department ?? u.email}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </PageBody>
    </div>
  );
}
