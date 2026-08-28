import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDateTime, humanize } from '@/lib/format';
import { WORKFLOW_TRIGGERS, type WorkflowAction } from '@/lib/workflows';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD,
} from '@/components/ui';
import { WORKFLOW_TEMPLATES } from './templates';
import { WorkflowBuilder, ToggleWorkflow, DeleteWorkflow, RunMaintenanceButton, InstallTemplateButton } from './workflow-ui';
import type { Audience } from '@/lib/audience';

export const metadata: Metadata = { title: 'Workflows' };

export default async function WorkflowsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'workflows.admin');

  const [workflows, runs, departments, courses, policies] = await Promise.all([
    db.workflowDefinition.findMany({
      where: { isTemplate: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
    }),
    db.workflowRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 25,
      include: { definition: { select: { name: true } } },
    }),
    db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.trainingCourse.findMany({ where: { active: true }, orderBy: { title: 'asc' } }),
    db.policy.findMany({ where: { active: true }, orderBy: { title: 'asc' } }),
  ]);

  const installedKeys = new Set(workflows.map((w) => w.name));
  const available = WORKFLOW_TEMPLATES.filter((t) => !installedKeys.has(t.name));

  return (
    <div>
      <PageHeader
        title="Workflow automation"
        description="If this → then that. Triggers fire from real HR events; scheduled triggers run in the daily sweep."
        actions={<RunMaintenanceButton />}
      />
      <Callout tone="info">
        Scheduled triggers (birthdays, anniversaries, approaching start dates, expiring documents and contracts, overdue
        training, unreturned equipment, PTO accruals) run in one idempotent daily sweep. In production, point a
        scheduler at <code>POST /api/internal/maintenance</code>; here you can run it on demand.
      </Callout>

      <div className="mt-4 space-y-4">
        <Card>
          <CardHeader title={`Workflows (${workflows.length})`} />
          {workflows.length === 0 ? (
            <EmptyState title="No workflows yet" description="Install a template below or build one from scratch." />
          ) : (
            <Table>
              <THead><TH>Workflow</TH><TH>Trigger</TH><TH>Applies to</TH><TH>Actions</TH><TH>Runs</TH><TH>Enabled</TH><TH></TH></THead>
              <tbody>
                {workflows.map((w) => {
                  const cond = w.conditions as Audience;
                  const actions = (w.actions as unknown as WorkflowAction[]) ?? [];
                  const scope = [
                    cond.countries?.length ? cond.countries.join('/') : null,
                    cond.workerTypes?.length ? cond.workerTypes.map((t) => t.toLowerCase()).join('/') : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <TRow key={w.id}>
                      <TD>
                        <span className="font-medium">{w.name}</span>
                        {w.description ? <span className="block max-w-sm text-[12px] text-ink-400">{w.description}</span> : null}
                      </TD>
                      <TD><Badge tone="blue">{humanize(w.trigger)}</Badge></TD>
                      <TD className="text-[13px] text-ink-500">{scope || 'Everyone'}</TD>
                      <TD className="text-[13px]">{actions.map((a) => humanize(a.type)).join(', ')}</TD>
                      <TD>{w._count.runs}</TD>
                      <TD>{w.enabled ? <Badge tone="green">on</Badge> : <Badge tone="gray">off</Badge>}</TD>
                      <TD>
                        <div className="flex gap-1.5">
                          <ToggleWorkflow workflowId={w.id} enabled={w.enabled} />
                          <DeleteWorkflow workflowId={w.id} />
                        </div>
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        {available.length > 0 ? (
          <Card>
            <CardHeader title="Template library" description="One click installs a working workflow you can then edit." />
            <CardBody>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {available.map((t) => (
                  <li key={t.key} className="flex items-start justify-between gap-3 rounded-md border border-ink-100 px-3.5 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink-900">{t.name}</div>
                      <div className="text-[12px] text-ink-400">{t.description}</div>
                    </div>
                    <InstallTemplateButton templateKey={t.key} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Build a workflow" />
          <CardBody>
            <WorkflowBuilder
              triggers={[...WORKFLOW_TRIGGERS]}
              departments={departments.map((d) => ({ value: d.id, label: d.name }))}
              courses={courses.map((c) => ({ value: c.id, label: c.title }))}
              policies={policies.map((p) => ({ value: p.id, label: p.title }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent runs" description="Every evaluation is logged with its step-by-step result." />
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" />
          ) : (
            <Table>
              <THead><TH>Workflow</TH><TH>Started</TH><TH>Status</TH><TH>Log</TH></THead>
              <tbody>
                {runs.map((r) => (
                  <TRow key={r.id}>
                    <TD className="font-medium">{r.definition.name}</TD>
                    <TD>{fmtDateTime(r.startedAt)}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="max-w-md text-[12px] text-ink-500">
                      {(r.log as string[])?.join(' · ') || r.error || '—'}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
