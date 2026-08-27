import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SectionHeading } from "@/components/ui";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "MANAGE_RETENTION")) redirect("/admin");

  const [settings, retention, holds] = await Promise.all([
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
    prisma.retentionPolicy.findMany(),
    prisma.legalHold.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeading
        title="Settings"
        description="Organization configuration, retention policies, and legal holds. All changes are audited."
      />
      <p className="mt-4 rounded-lg border border-navy-200 bg-navy-50 p-4 text-xs leading-relaxed text-navy-600">
        <strong>Admin notice:</strong> Assessment instruments used for
        employment decisions should be evaluated for job relevance,
        reliability, validity, accessibility, and potential adverse impact.
        FSW WorkFit is decision-support software and should not be the sole
        basis for an employment decision.
      </p>
      <SettingsForm
        settings={{
          companyName: settings?.companyName ?? "FSW Group",
          privacyContactEmail: settings?.privacyContactEmail ?? null,
          accommodationContactEmail: settings?.accommodationContactEmail ?? null,
          hrNotificationEmail: settings?.hrNotificationEmail ?? null,
          privacyNoticeConfigured: settings?.privacyNoticeConfigured ?? false,
          storageConfigured: settings?.storageConfigured ?? false,
          httpsConfirmed: settings?.httpsConfirmed ?? false,
          recordingAccessRoles: settings?.recordingAccessRoles ?? [
            "SUPER_ADMIN",
            "HR_ADMIN",
          ],
        }}
        retention={retention.map((r) => ({
          recordType: r.recordType,
          retentionDays: r.retentionDays,
        }))}
        holds={holds.map((h) => ({
          id: h.id,
          scope: h.scope,
          reason: h.reason,
          active: h.active,
          createdAt: h.createdAt.toISOString(),
        }))}
        storageProvider={env.storageProvider}
      />
    </div>
  );
}
