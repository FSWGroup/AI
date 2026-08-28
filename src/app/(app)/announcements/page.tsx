import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate } from '@/lib/format';
import { audienceMatches, workerFacts, type Audience } from '@/lib/audience';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { AnnouncementForm, AckButton } from './announcement-forms';

export const metadata: Metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'announce.admin');

  const all = await db.announcement.findMany({
    where: { publishAt: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
    orderBy: [{ pinned: 'desc' }, { publishAt: 'desc' }],
    take: 30,
    include: { acks: ctx.workerId ? { where: { workerId: ctx.workerId } } : false, _count: { select: { acks: true } } },
  });

  // Audience targeting: filter to announcements addressed to this worker.
  const facts = ctx.workerId ? await workerFacts(ctx.workerId) : null;
  const announcements = all.filter((a) => {
    const audience = a.audience as Audience;
    if (!audience || Object.keys(audience).length === 0) return true;
    if (isAdmin) return true;
    return facts ? audienceMatches(audience, facts) : false;
  });

  return (
    <div>
      <PageHeader title="Announcements" description="Company news, targeted by company, department, country or team." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {announcements.length === 0 ? (
            <Card><EmptyState title="No announcements" /></Card>
          ) : (
            announcements.map((a) => {
              const myAck = ctx.workerId && Array.isArray(a.acks) ? a.acks[0] : undefined;
              return (
                <Card key={a.id}>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        {a.pinned ? <Badge tone="navy">Pinned</Badge> : null}
                        {a.title}
                      </span>
                    }
                    description={`${fmtDate(a.publishAt)}${isAdmin && a.requiresAck ? ` · ${a._count.acks} acknowledgments` : ''}`}
                    actions={
                      a.requiresAck && ctx.workerId ? (
                        myAck ? (
                          <Badge tone="green">Acknowledged</Badge>
                        ) : (
                          <AckButton announcementId={a.id} />
                        )
                      ) : undefined
                    }
                  />
                  <CardBody>
                    <div className="text-sm leading-relaxed text-ink-800" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
                  </CardBody>
                </Card>
              );
            })
          )}
        </div>
        {isAdmin ? (
          <Card className="h-fit">
            <CardHeader title="New announcement" />
            <CardBody>
              <AnnouncementForm />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
