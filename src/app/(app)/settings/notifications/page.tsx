import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import type { NotificationType } from "@prisma/client";
import { PageHeader, PageBody } from "@/components/page-header";
import { NotificationPrefsClient, type PrefRow } from "@/app/(app)/settings/notifications/notification-prefs-client";

const TYPES: { type: NotificationType; label: string; description: string }[] = [
  { type: "TRAINING_ASSIGNED", label: "Training assigned", description: "New training added to your plan." },
  { type: "TRAINING_DUE_SOON", label: "Training due soon", description: "A reminder before a due date." },
  { type: "TRAINING_OVERDUE", label: "Training overdue", description: "Training past its due date." },
  { type: "COURSE_COMPLETED", label: "Course completed", description: "Confirmation when you finish a course." },
  { type: "ASSESSMENT_FAILED", label: "Assessment failed", description: "A quiz attempt didn't pass." },
  { type: "MANAGER_APPROVAL_NEEDED", label: "Manager approval needed", description: "Something on your team needs your sign-off." },
  { type: "CERTIFICATE_EXPIRING", label: "Certificate expiring", description: "A certificate is coming up for renewal." },
  { type: "SOP_CHANGED", label: "SOP changed", description: "An SOP you follow was updated." },
  { type: "REACK_REQUIRED", label: "Re-acknowledgement required", description: "A policy needs your signature again." },
  { type: "COMMENT_MENTION", label: "Mentioned in a comment", description: "Someone @mentioned you." },
  { type: "REVIEW_REQUESTED", label: "Review requested", description: "You've been asked to review content." },
  { type: "CONTENT_REVIEW_DUE", label: "Content review due", description: "Content you own is due for review." },
  { type: "ANNOUNCEMENT", label: "Announcements", description: "Company and team announcements." },
  { type: "SYSTEM", label: "System", description: "Platform maintenance and account notices." },
];

export default async function NotificationSettingsPage() {
  const actor = await requireActor();
  const existing = await prisma.notificationPreference.findMany({ where: { userId: actor.id } });
  const byType = new Map(existing.map((p) => [p.type, p]));

  const rows: PrefRow[] = TYPES.map((t) => ({
    type: t.type,
    label: t.label,
    description: t.description,
    inApp: byType.get(t.type)?.inApp ?? true,
    email: byType.get(t.type)?.email ?? true,
  }));

  return (
    <div>
      <PageHeader title="Notification preferences" description="Choose how you're notified for each type of event. Changes save immediately." />
      <PageBody>
        <NotificationPrefsClient initial={rows} />
      </PageBody>
    </div>
  );
}
