import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fullName } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { PolicyForm } from './policy-form';

export const metadata: Metadata = { title: 'Policies' };

export default async function PoliciesPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'policies.admin');

  const policies = await db.policy.findMany({
    where: { active: true },
    orderBy: { title: 'asc' },
    include: {
      versions: {
        where: { publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        take: 1,
        include: {
          acks: ctx.workerId && !isAdmin ? { where: { workerId: ctx.workerId } } : true,
        },
      },
    },
  });

  const outstanding = isAdmin
    ? await db.policyAcknowledgment.findMany({
        where: { acknowledgedAt: null, policyVersion: { publishedAt: { not: null } } },
        include: {
          worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
          policyVersion: { include: { policy: true } },
        },
        take: 50,
      })
    : [];

  return (
    <div>
      <PageHeader
        title="Policies"
        description="Company policies with versioned acknowledgment history."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Policy library" />
            {policies.length === 0 ? (
              <EmptyState title="No policies published" description={isAdmin ? 'Publish the first policy from the panel on the right.' : undefined} />
            ) : (
              <ul className="divide-y divide-ink-100">
                {policies.map((p) => {
                  const v = p.versions[0];
                  if (!v) return null;
                  const myAck = ctx.workerId ? v.acks.find((a) => a.workerId === ctx.workerId) : undefined;
                  const totalAcks = v.acks.filter((a) => a.acknowledgedAt).length;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                      <div>
                        <Link href={`/policies/${p.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-600">
                          {p.title}
                        </Link>
                        <div className="text-[12px] text-ink-400">
                          v{v.version} · effective {fmtDate(v.effectiveAt)}
                          {isAdmin ? ` · ${totalAcks}/${v.acks.length} acknowledged` : ''}
                        </div>
                      </div>
                      {myAck ? (
                        myAck.acknowledgedAt ? (
                          <Badge tone="green">Acknowledged</Badge>
                        ) : (
                          <Badge tone="amber">Action needed</Badge>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {isAdmin && outstanding.length > 0 ? (
            <Card>
              <CardHeader title={`Outstanding acknowledgments (${outstanding.length})`} />
              <ul className="divide-y divide-ink-100">
                {outstanding.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span>
                      <Link href={`/people/${a.worker.id}`} className="font-medium text-ink-800 hover:text-brand-600">
                        {fullName(a.worker)}
                      </Link>{' '}
                      — {a.policyVersion.policy.title} (v{a.policyVersion.version})
                    </span>
                    <span className="text-[12px] text-ink-400">
                      {a.viewedAt ? `viewed ${fmtDate(a.viewedAt)}` : 'not viewed'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        {isAdmin ? (
          <Card className="h-fit">
            <CardHeader title="Publish a policy" description="Publishing a new version preserves prior versions and their acknowledgment history." />
            <CardBody>
              <PolicyForm existing={policies.map((p) => ({ value: p.id, label: p.title }))} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
