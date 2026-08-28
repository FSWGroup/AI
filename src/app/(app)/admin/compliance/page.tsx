import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { COMPLIANCE_DISCLAIMER, getComplianceStatus } from "@/lib/services/compliance";
import { PageHeader, PageBody } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { ComplianceRuleCard } from "@/app/(app)/admin/compliance/compliance-rule-card";
import { NewRuleForm } from "@/app/(app)/admin/compliance/new-rule-form";

export const metadata = { title: "Compliance Center" };

export default async function ComplianceCenterPage() {
  const actor = await requirePermission("compliance.view");

  const [rules, courses, owners] = await Promise.all([
    getComplianceStatus(actor),
    prisma.course.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);

  const totalAffected = rules.reduce((sum, r) => sum + r.affectedCount, 0);
  const totalNonCompliant = rules.reduce((sum, r) => sum + r.nonCompliantCount, 0);

  return (
    <>
      <PageHeader
        title="Compliance Center"
        description="Configured training requirements and the evidence behind them."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Compliance" }]}
        actions={
          <Link href="/admin/compliance/matrix">
            <Button variant="outline">
              <Icon name="matrix" className="h-4 w-4" /> Requirements matrix
            </Button>
          </Link>
        }
      />
      <PageBody className="flex flex-col gap-5">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 p-4 text-[0.8125rem] text-warning-800">
          <Glyph name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{COMPLIANCE_DISCLAIMER}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            {rules.length} active rule{rules.length === 1 ? "" : "s"} · {totalAffected} people in scope ·{" "}
            <span className={totalNonCompliant > 0 ? "font-semibold text-danger-700" : ""}>{totalNonCompliant} non-compliant</span>
          </p>
          {actor.permissions.has("compliance.manage") && <NewRuleForm courses={courses} owners={owners} />}
        </div>

        {rules.length === 0 ? (
          <EmptyState
            icon={<Icon name="compliance" className="h-5 w-5" />}
            title="No compliance rules yet"
            description="Add a rule to start tracking a training requirement and its evidence."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {rules.map((rule) => (
              <ComplianceRuleCard key={rule.id} rule={rule} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
