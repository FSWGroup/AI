import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { env } from '@/lib/env';
import { fmtDateTime } from '@/lib/format';
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TD, TH, THead, TRow } from '@/components/ui';
import { INDEED_BOARD, indeedApplyEnabled, indeedApplyInFeedEnabled, indeedApplyPostUrl, indeedFeedEnabled } from '@/lib/indeed';
import { RevealFeedUrl } from './reveal';

export const metadata: Metadata = { title: 'Indeed' };

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  ACCEPTED: 'green',
  DUPLICATE: 'amber',
  REJECTED: 'red',
  ERROR: 'red',
};

export default async function IndeedIntegrationPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'settings.admin');

  const [postings, deliveries] = await Promise.all([
    db.jobBoardPosting.findMany({
      where: { board: INDEED_BOARD, status: 'PUBLISHED' },
      include: { requisition: { select: { id: true, title: true, status: true } } },
      orderBy: { publishedAt: 'desc' },
    }),
    db.jobBoardDelivery.findMany({
      where: { board: INDEED_BOARD },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    }),
  ]);

  const feedOn = indeedFeedEnabled();
  const applyOn = indeedApplyEnabled();

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/admin/integrations' }, { label: 'Indeed' }]}
        title="Indeed"
        description="Publish open roles to Indeed and receive Indeed Apply candidates directly into the pipeline."
      />

      <Card className="mb-4">
        <CardHeader title="Status" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span className="flex items-center gap-2">
              Job feed {feedOn ? <Badge tone="green">on</Badge> : <Badge tone="gray">off</Badge>}
            </span>
            <span className="flex items-center gap-2">
              Indeed Apply webhook {applyOn ? <Badge tone="green">on</Badge> : <Badge tone="gray">off</Badge>}
            </span>
            <span className="flex items-center gap-2">
              Apply inside Indeed{' '}
              {indeedApplyInFeedEnabled() ? <Badge tone="green">on</Badge> : <Badge tone="gray">off</Badge>}
            </span>
          </div>

          {feedOn ? (
            <div>
              <p className="mb-2 text-[13px] text-ink-600">
                Give this URL to Indeed as your XML feed source. It contains the crawl token, so treat it like a
                password — anyone holding it can read every published job.
              </p>
              <RevealFeedUrl />
            </div>
          ) : (
            <Callout tone="info">
              Set <code>INDEED_FEED_TOKEN</code> to a long random value (<code>openssl rand -hex 32</code>) and restart
              the app. Until then the feed endpoint returns 404 and the publish controls on a job stay disabled.
            </Callout>
          )}

          {applyOn ? (
            <div className="text-[13px] text-ink-600">
              Indeed Apply posts applications to{' '}
              <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[12px]">{indeedApplyPostUrl()}</code>.
              Deliveries must be signed with <code>INDEED_APPLY_SECRET</code>; unsigned posts are rejected and logged.
            </div>
          ) : (
            <Callout tone="info">
              Set <code>INDEED_APPLY_SECRET</code> to receive applications automatically. Without it the webhook returns
              404 and candidates apply on the public careers page instead.
            </Callout>
          )}

          <div className="text-[13px] text-ink-600">
            Public careers pages:{' '}
            <Link href="/careers" className="text-brand-600 hover:underline">
              {env.APP_BASE_URL.replace(/\/$/, '')}/careers
            </Link>
          </div>

          <Callout tone="warn">
            FSW People does not push hire/reject dispositions back to Indeed. That needs Indeed&apos;s partner
            Disposition API and credentials we do not hold, so rejections are recorded here only — nothing is sent to
            Indeed on your behalf.
          </Callout>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title={`Published to Indeed (${postings.length})`} />
        <CardBody>
          {postings.length === 0 ? (
            <EmptyState title="No jobs are published" description="Publish from a job's pipeline page." />
          ) : (
            <Table>
              <THead>
                <TH>Job</TH>
                <TH>Requisition status</TH>
                <TH>Published</TH>
                <TH>Feed last fetched</TH>
              </THead>
              <tbody>
                {postings.map((p) => (
                  <TRow key={p.id}>
                    <TD>
                      <Link href={`/recruiting/jobs/${p.requisition.id}`} className="text-ink-900 hover:text-brand-600">
                        {p.publicTitle || p.requisition.title}
                      </Link>
                    </TD>
                    <TD>{p.requisition.status}</TD>
                    <TD>{fmtDateTime(p.publishedAt)}</TD>
                    <TD>{p.lastFeedAt ? fmtDateTime(p.lastFeedAt) : 'not yet'}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Delivery log"
          description="Every inbound and outbound exchange with Indeed, including rejected posts. Append-only."
        />
        <CardBody>
          {deliveries.length === 0 ? (
            <EmptyState title="Nothing yet" description="Entries appear once Indeed crawls the feed or sends a candidate." />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Result</TH>
                <TH>Detail</TH>
                <TH>Application</TH>
              </THead>
              <tbody>
                {deliveries.map((d) => (
                  <TRow key={d.id}>
                    <TD>{fmtDateTime(d.receivedAt)}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[d.status] ?? 'gray'}>{d.status.toLowerCase()}</Badge>
                    </TD>
                    <TD className="max-w-md">{d.detail ?? '—'}</TD>
                    <TD>
                      {d.applicationId ? (
                        <span className="font-mono text-[12px] text-ink-500">{d.applicationId.slice(0, 8)}…</span>
                      ) : (
                        '—'
                      )}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
