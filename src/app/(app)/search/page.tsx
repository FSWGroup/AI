import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can, allReportIds } from '@/lib/authz';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Search' };

/**
 * Global search (§44). Every result set is permission-filtered server-side:
 * documents, tasks, candidates and equipment only appear for users whose role
 * grants access, and workers are limited to the directory the user may see.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireCtx();
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  if (query.length < 2) {
    return (
      <div>
        <PageHeader title="Search" />
        <Card>
          <EmptyState title="Type at least two characters" description="Search people, tasks, documents, policies, candidates and equipment." />
        </Card>
      </div>
    );
  }

  const like = { contains: query, mode: 'insensitive' as const };
  const reportIds = ctx.workerId ? await allReportIds(ctx.workerId) : [];

  const [workers, tasks, documents, policies, candidates, equipment] = await Promise.all([
    can(ctx, 'people.read')
      ? db.worker.findMany({
          where: {
            deletedAt: null,
            OR: [{ legalFirstName: like }, { preferredName: like }, { lastName: like }, { workEmail: like }, { employeeNumber: like }],
          },
          include: { employments: { where: { effectiveTo: null }, take: 1, include: { department: true } } },
          take: 10,
        })
      : [],
    db.task.findMany({
      where: {
        title: like,
        OR: [
          { ownerUserId: ctx.userId },
          ...(ctx.roleKeys.length ? [{ ownerRoleKey: { in: ctx.roleKeys } }] : []),
          ...(reportIds.length ? [{ workerId: { in: reportIds } }] : []),
          ...(can(ctx, 'onboarding.admin') ? [{}] : []),
        ],
      },
      take: 8,
    }),
    db.document.findMany({
      where: {
        title: like,
        deletedAt: null,
        ...(can(ctx, 'docs.read_all')
          ? {}
          : {
              OR: [
                ...(ctx.workerId ? [{ workerId: ctx.workerId }] : []),
                { workerId: null, classification: { in: ['PUBLIC_INTERNAL' as const, 'INTERNAL' as const] } },
              ],
            }),
      },
      take: 8,
    }),
    db.policy.findMany({ where: { title: like, active: true }, take: 5 }),
    can(ctx, 'recruiting.read')
      ? db.candidate.findMany({
          where: { OR: [{ firstName: like }, { lastName: like }, { email: like }] },
          include: { applications: { include: { requisition: { select: { title: true } } }, take: 1 } },
          take: 8,
        })
      : [],
    can(ctx, 'equipment.admin')
      ? db.equipmentAsset.findMany({
          where: { OR: [{ assetTag: like }, { serialNumber: like }, { model: like }] },
          take: 5,
        })
      : [],
  ]);

  const total = workers.length + tasks.length + documents.length + policies.length + candidates.length + equipment.length;

  return (
    <div>
      <PageHeader title={`Search: “${query}”`} description={`${total} result${total === 1 ? '' : 's'} you have access to`} />
      {total === 0 ? (
        <Card>
          <EmptyState title="No results" description="Try a different term. Results are limited to what your role allows you to see." />
        </Card>
      ) : (
        <div className="space-y-4">
          {workers.length > 0 ? (
            <Card>
              <CardHeader title="People" />
              <ul className="divide-y divide-ink-100">
                {workers.map((w) => (
                  <li key={w.id}>
                    <Link href={`/people/${w.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-brand-50/40">
                      <Avatar name={fullName(w)} photoUrl={w.photoUrl} size={30} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink-900">{fullName(w)}</span>
                        <span className="block text-[12px] text-ink-400">
                          {w.employments[0]?.title ?? humanize(w.workerType)} · {w.employments[0]?.department?.name ?? '—'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {tasks.length > 0 ? (
            <Card>
              <CardHeader title="Tasks" />
              <ul className="divide-y divide-ink-100">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks?task=${t.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-brand-50/40">
                      <span className="text-ink-800">{t.title}</span>
                      <Badge tone="gray">{humanize(t.category)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {documents.length > 0 ? (
            <Card>
              <CardHeader title="Documents" />
              <ul className="divide-y divide-ink-100">
                {documents.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-brand-50/40">
                      <span className="text-ink-800">{d.title}</span>
                      <span className="text-[12px] text-ink-400">{humanize(d.category)} · {fmtDate(d.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {policies.length > 0 ? (
            <Card>
              <CardHeader title="Policies" />
              <ul className="divide-y divide-ink-100">
                {policies.map((p) => (
                  <li key={p.id}>
                    <Link href={`/policies/${p.id}`} className="block px-5 py-2.5 text-sm text-ink-800 hover:bg-brand-50/40">
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {candidates.length > 0 ? (
            <Card>
              <CardHeader title="Candidates" />
              <ul className="divide-y divide-ink-100">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <Link href={`/recruiting/candidates/${c.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-brand-50/40">
                      <span className="text-ink-800">{c.firstName} {c.lastName}</span>
                      <span className="text-[12px] text-ink-400">{c.applications[0]?.requisition.title ?? 'no application'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {equipment.length > 0 ? (
            <Card>
              <CardHeader title="Equipment" />
              <ul className="divide-y divide-ink-100">
                {equipment.map((e) => (
                  <li key={e.id}>
                    <Link href="/equipment" className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-brand-50/40">
                      <span className="text-ink-800">{humanize(e.kind)} — {e.make} {e.model}</span>
                      <span className="text-[12px] text-ink-400">{e.assetTag}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
