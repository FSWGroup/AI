"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatShortDate } from "@/lib/dates";
import { bulkAssignNonCompliantAction, verifyRuleAction } from "@/app/(app)/admin/compliance/actions";
import type { ComplianceRuleStatus } from "@/lib/services/compliance";

export function ComplianceRuleCard({ rule }: { rule: ComplianceRuleStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState(`Assigned to reach compliance: ${rule.name}`);

  const compliancePercent =
    rule.affectedCount > 0 ? Math.round(((rule.compliantCount + rule.exemptCount) / rule.affectedCount) * 100) : 100;

  function verify() {
    startTransition(async () => {
      const result = await verifyRuleAction(rule.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Marked verified today.");
      router.refresh();
    });
  }

  function bulkAssign() {
    if (!rule.courseId) return;
    startTransition(async () => {
      const result = await bulkAssignNonCompliantAction({
        userIds: rule.nonCompliantPeople.map((p) => p.id),
        courseId: rule.courseId as string,
        reason,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assigned to ${result.data.assigned.length} people.`);
      router.refresh();
    });
  }

  return (
    <details className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">{rule.name}</p>
          <p className="text-[0.75rem] text-[var(--text-muted)]">
            {rule.jurisdiction} · {rule.requirement}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{rule.affectedCount} affected</Badge>
          <Badge tone="success">{rule.compliantCount} compliant</Badge>
          {rule.expiringSoonCount > 0 && <Badge tone="warning">{rule.expiringSoonCount} expiring soon</Badge>}
          {rule.nonCompliantCount > 0 && <Badge tone="danger">{rule.nonCompliantCount} non-compliant</Badge>}
          {rule.exemptCount > 0 && <Badge tone="info">{rule.exemptCount} exempt</Badge>}
          <span className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{compliancePercent}%</span>
        </div>
      </summary>

      <div className="flex flex-col gap-4 border-t border-[var(--border-subtle)] p-4">
        {!rule.hasLinkedCourse && (
          <p className="rounded-md bg-[var(--surface-sunken)] p-2.5 text-[0.75rem] text-[var(--text-muted)]">
            This requirement has no linked course, so compliance evidence can't be tracked automatically here. Affected
            population is shown; track evidence manually or link a course.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-[0.75rem] sm:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">Frequency</dt>
            <dd className="text-[var(--text-primary)]">{rule.frequencyMonths ? `Every ${rule.frequencyMonths} months` : "Once"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Retention</dt>
            <dd className="text-[var(--text-primary)]">{rule.retentionYears ? `${rule.retentionYears} years` : "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Owner</dt>
            <dd className="text-[var(--text-primary)]">{rule.ownerName ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Last verified</dt>
            <dd className="text-[var(--text-primary)]">{rule.lastVerifiedAt ? formatShortDate(rule.lastVerifiedAt, "UTC") : "Never"}</dd>
          </div>
        </dl>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={verify} loading={pending}>
            Mark verified today
          </Button>
        </div>

        {rule.nonCompliantCount > 0 && (
          <div className="rounded-md border border-danger-100 bg-danger-50 p-3">
            <p className="mb-2 text-[0.8125rem] font-medium text-danger-800">
              {rule.nonCompliantCount} people are non-compliant
            </p>
            <div className="mb-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {rule.nonCompliantPeople.map((p) => (
                <Badge key={p.id} tone="danger">
                  {p.name}
                </Badge>
              ))}
            </div>
            {rule.hasLinkedCourse && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Assignment reason" htmlFor={`reason-${rule.id}`} className="min-w-56 flex-1">
                  <Input id={`reason-${rule.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button size="sm" variant="danger" onClick={bulkAssign} loading={pending}>
                  Assign to all non-compliant
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
