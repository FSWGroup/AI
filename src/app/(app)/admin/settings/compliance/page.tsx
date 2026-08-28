import Link from "next/link";
import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { SectionHeading } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function ComplianceSettingsPage() {
  await requireActor();
  const [activeRules, activeExemptions, overdueSops] = await Promise.all([
    prisma.complianceRule.count({ where: { isActive: true } }),
    prisma.trainingExemption.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { lt: new Date() } } }),
  ]);

  return (
    <div>
      <SectionHeading
        title="Compliance"
        description="Compliance rules, exemptions, and jurisdictions are managed in the Compliance workspace. This page shows a live summary."
      />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-[0.75rem] text-[var(--text-muted)]">Active compliance rules</p>
            <p className="mt-1 text-[1.5rem] font-semibold text-[var(--text-primary)]">{activeRules}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-[0.75rem] text-[var(--text-muted)]">Active exemptions</p>
            <p className="mt-1 text-[1.5rem] font-semibold text-[var(--text-primary)]">{activeExemptions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-[0.75rem] text-[var(--text-muted)]">SOPs overdue for review</p>
            <p className="mt-1 text-[1.5rem] font-semibold text-danger-700">{overdueSops}</p>
          </CardContent>
        </Card>
      </div>
      <div className="mt-4">
        <Link
          href="/admin/compliance"
          className="inline-flex h-9.5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] shadow-xs hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          Open the Compliance workspace
        </Link>
      </div>
    </div>
  );
}
