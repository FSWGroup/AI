import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { NotificationsClient } from "@/app/(app)/notifications/notifications-client";

export default async function NotificationsPage() {
  const actor = await requireActor();
  const rows = await prisma.notification.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader title="Notifications" description="Training assignments, reminders, approvals, and announcements." />
      <PageBody>
        <NotificationsClient
          initial={rows.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            linkUrl: n.linkUrl,
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt ? n.readAt.toISOString() : null,
          }))}
        />
      </PageBody>
    </div>
  );
}
