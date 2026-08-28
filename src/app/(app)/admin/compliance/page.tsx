import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { retentionEligibility } from '@/lib/compliance';
import { fmtDate, fullName, humanize, startOfUTCDay } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, StatusBadge, Table, THead, TH, TRow, TD, cx,
} from '@/components/ui';
import { RuleForm, SyncButton, ItemStatusForm, RetentionForm, DestructionForm } from './compliance-ui';
import type { Audience } from '@/lib/audience';

export const metadata: Metadata = { title: 'Compliance' };

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'compliance.admin');
  const { tab = 'items' } = await searchParams;
  const today = startOfUTCDay();

  const [rules, items, openCount, overdueCount, retentionPolicies] = await Promise.all([
    db.complianceRule.findMany({ orderBy: [{ severity: 'desc' }, { name: 'asc' }] }),
    db.complianceItem.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
      take: 100,
      include: {
        rule: true,
        worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      },
    }),
    db.complianceItem.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    db.complianceItem.count({ where: { status: 'OVERDUE' } }),
    db.retentionPolicy.findMany({ where: { active: true }, orderBy: { recordType: 'asc' } }),
  ]);

  const dueReview = rules.filter((r) => r.nextReviewAt && r.nextReviewAt <= today);
  const retention = tab === 'retention' && can(ctx, 'retention.admin') ? await retentionEligibility() : [];
  const eligibleTotal = retention.reduce((s, r) => s + r.eligible.length, 0);

  const tabs = [
    { key: 'items', label: `Open items (${openCount + overdueCount})` },
    { key: 'rules', label: `Rules (${rules.length})` },
    ...(can(ctx, 'retention.admin') ? [{ key: 'retention', label: 'Retention' }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Compliance center"
        description="A workflow and risk-management tool — not a substitute for legal counsel."
        actions={<SyncButton />}
      />
      <Callout tone="warn">
        Compliance rules are <strong>data</strong>, not code: each carries a jurisdiction, an authoritative source, a
        responsible owner and a review date so HR can update them as laws change. Always verify a requirement with
        HR/legal/your payroll provider before relying on it.
      </Callout>

      <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open items" value={openCount} />
        <StatCard label="Overdue" value={overdueCount} tone={overdueCount > 0 ? 'danger' : 'ok'} />
        <StatCard label="Active rules" value={rules.filter((r) => r.status === 'ACTIVE').length} />
        <StatCard label="Rules due for review" value={dueReview.length} tone={dueReview.length > 0 ? 'warn' : undefined} />
      </div>

      <nav aria-label="Compliance views" className="mb-4 flex w-fit rounded-md border border-ink-200 bg-white p-0.5">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/compliance?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cx(
              'rounded px-3 py-1.5 text-[13px] font-medium',
              tab === t.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'items' ? (
        <Card>
          <CardHeader title="Outstanding compliance items" />
          {items.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="Run the sync to materialize items for your active rules." />
          ) : (
            <Table>
              <THead><TH>Item</TH><TH>Jurisdiction</TH><TH>Severity</TH><TH>Owner</TH><TH>Due</TH><TH>Status</TH><TH></TH></THead>
              <tbody>
                {items.map((i) => (
                  <TRow key={i.id}>
                    <TD>
                      <span className="font-medium">{i.rule.name}</span>
                      {i.worker ? (
                        <Link href={`/people/${i.worker.id}`} className="block text-[12px] text-brand-600 hover:underline">
                          {fullName(i.worker)}
                        </Link>
                      ) : null}
                    </TD>
                    <TD>
                      {i.rule.jurisdiction}
                      {i.rule.sourceUrl ? (
                        <a href={i.rule.sourceUrl} target="_blank" rel="noreferrer" className="block text-[12px] text-brand-600 hover:underline">
                          {i.rule.source ?? 'source'} ↗
                        </a>
                      ) : null}
                    </TD>
                    <TD><StatusBadge status={i.rule.severity} /></TD>
                    <TD>{humanize(i.rule.ownerRoleKey)}</TD>
                    <TD>{fmtDate(i.dueDate)}</TD>
                    <TD><StatusBadge status={i.status} /></TD>
                    <TD><ItemStatusForm itemId={i.id} /></TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}

      {tab === 'rules' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Compliance rules" description="Jurisdiction-aware, source-linked, and review-dated." />
            <Table>
              <THead><TH>Rule</TH><TH>Category</TH><TH>Jurisdiction</TH><TH>Applies to</TH><TH>Deadline</TH><TH>Severity</TH><TH>Reviewed</TH><TH>Status</TH></THead>
              <tbody>
                {rules.map((r) => {
                  const applies = r.appliesTo as Audience;
                  const deadline = r.deadlineRule as { anchor?: string; offsetDays?: number };
                  return (
                    <TRow key={r.id}>
                      <TD>
                        <span className="font-medium">{r.name}</span>
                        <span className="block max-w-md text-[12px] text-ink-400">{r.description}</span>
                      </TD>
                      <TD>{humanize(r.category)}</TD>
                      <TD>
                        {r.jurisdiction}
                        {r.sourceUrl ? (
                          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="block text-[12px] text-brand-600 hover:underline">
                            {r.source} ↗
                          </a>
                        ) : null}
                      </TD>
                      <TD className="text-[13px] text-ink-500">
                        {[
                          applies.countries?.join('/'),
                          applies.workerTypes?.map((t) => t.toLowerCase()).join('/'),
                          applies.workStates?.join('/'),
                        ].filter(Boolean).join(' · ') || 'Everyone'}
                      </TD>
                      <TD className="text-[13px]">
                        {deadline.anchor ? `${humanize(deadline.anchor)} ${deadline.offsetDays ? `+${deadline.offsetDays}d` : ''}` : '—'}
                      </TD>
                      <TD><StatusBadge status={r.severity} /></TD>
                      <TD className="text-[13px]">
                        {fmtDate(r.lastReviewedAt)}
                        {r.nextReviewAt && r.nextReviewAt <= today ? <Badge tone="amber">review due</Badge> : null}
                      </TD>
                      <TD><StatusBadge status={r.status} /></TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Add a compliance rule" description="Store the authoritative source and a review date — never freeze a government requirement into code." />
            <CardBody>
              <RuleForm />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'retention' && can(ctx, 'retention.admin') ? (
        <div className="space-y-4">
          <Callout tone="danger">
            FSW People calculates destruction <em>eligibility</em> only. Permanent destruction always requires an
            explicit, documented approval below, and even then employment history is preserved so historical reporting
            stays honest.
          </Callout>
          <Card>
            <CardHeader title="Retention policies" />
            <Table>
              <THead><TH>Record type</TH><TH>Jurisdiction</TH><TH>Anchor</TH><TH>Retain</TH><TH>Eligible now</TH><TH>Note</TH></THead>
              <tbody>
                {retentionPolicies.map((p) => {
                  const r = retention.find((x) => x.policyId === p.id);
                  return (
                    <TRow key={p.id}>
                      <TD className="font-medium">{humanize(p.recordType)}</TD>
                      <TD>{p.jurisdiction}</TD>
                      <TD>{humanize(p.anchor)}</TD>
                      <TD>{Number(p.retainYears)} years</TD>
                      <TD>{r?.eligible.length ?? 0}</TD>
                      <TD className="max-w-sm text-[12px] text-ink-500">
                        {p.note}
                        {p.sourceUrl ? (
                          <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-brand-600 hover:underline">
                            source ↗
                          </a>
                        ) : null}
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title={`Records eligible for destruction (${eligibleTotal})`} />
            {eligibleTotal === 0 ? (
              <EmptyState title="Nothing is eligible yet" description="Records become eligible once their retention period elapses." />
            ) : (
              <Table>
                <THead><TH>Worker</TH><TH>Record type</TH><TH>Anchor date</TH><TH>Eligible since</TH><TH></TH></THead>
                <tbody>
                  {retention.flatMap((r) =>
                    r.eligible.map((e) => (
                      <TRow key={`${r.policyId}-${e.workerId}`}>
                        <TD>
                          <Link href={`/people/${e.workerId}`} className="font-medium text-ink-900 hover:text-brand-600">
                            {e.name}
                          </Link>
                        </TD>
                        <TD>{humanize(r.recordType)}</TD>
                        <TD>{fmtDate(e.anchorDate)}</TD>
                        <TD>{fmtDate(e.destroyAfter)}</TD>
                        <TD><DestructionForm workerId={e.workerId} name={e.name} /></TD>
                      </TRow>
                    )),
                  )}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Add a retention policy" />
            <CardBody>
              <RetentionForm />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
