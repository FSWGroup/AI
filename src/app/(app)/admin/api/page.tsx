import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { env } from '@/lib/env';
import { fmtDate, fmtDateTime } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { API_SCOPES, RATE_LIMIT_PER_MINUTE, MAX_WEBHOOK_ATTEMPTS } from '@/lib/api-keys';
import { WORKFLOW_TRIGGERS } from '@/lib/workflows';
import { CreateKeyButton, RevokeKeyButton, CreateWebhookButton, ToggleWebhookButton } from './api-ui';

export const metadata: Metadata = { title: 'API & webhooks' };
export const dynamic = 'force-dynamic';

export default async function ApiAdminPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'api.admin');

  const [keys, endpoints, recentDeliveries] = await Promise.all([
    db.apiKey.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] }),
    db.webhookEndpoint.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] }),
    db.webhookDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { endpoint: { select: { name: true } } },
    }),
  ]);

  const base = env.APP_BASE_URL.replace(/\/$/, '');
  const activeKeys = keys.filter((k) => k.active && !k.revokedAt);
  const failing = recentDeliveries.filter((d) => d.status === 'FAILED' || d.status === 'ABANDONED');

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Admin', href: '/admin/settings' }, { label: 'API & webhooks' }]}
        title="API & webhooks"
        description="So other FSW systems read approved HR data instead of re-keying it."
      />

      <Callout tone="info">
        The API is <strong>read-only</strong>, and deliberately so: nothing outside this application changes an HR
        record without going through the same authorization and audit path a person does. Responses carry an explicit
        allowlist of fields — no date of birth, home address, personal contact details, compensation or identifiers,
        with no caller-controlled field selection that could widen it. Rate limit: {RATE_LIMIT_PER_MINUTE} requests per
        key per minute.
      </Callout>

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Active keys" value={activeKeys.length} />
        <StatCard label="Webhook endpoints" value={endpoints.filter((e) => e.active).length} />
        <StatCard label="Recent delivery failures" value={failing.length} tone={failing.length > 0 ? 'warn' : 'default'} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Endpoints" description="Every route requires a bearer token carrying the named scope." />
        <CardBody>
          <ul className="space-y-2 text-[13px]">
            <li>
              <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[12px]">GET {base}/api/v1/workers</code>
              <span className="ml-2 text-ink-500">workers.read · paginated by cursor, filter with updatedSince</span>
            </li>
            <li>
              <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[12px]">GET {base}/api/v1/org</code>
              <span className="ml-2 text-ink-500">org.read · departments, teams, locations, legal entities</span>
            </li>
            <li>
              <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[12px]">GET {base}/api/v1/headcount</code>
              <span className="ml-2 text-ink-500">headcount.read · aggregates only, no individual records</span>
            </li>
          </ul>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title={`API keys (${keys.length})`} actions={<CreateKeyButton scopes={Object.entries(API_SCOPES).map(([key, label]) => ({ key, label }))} />} />
        <CardBody>
          {keys.length === 0 ? (
            <EmptyState
              title="No keys issued"
              description="Issue one per consuming system, scoped to what that system needs."
              action={<CreateKeyButton scopes={Object.entries(API_SCOPES).map(([key, label]) => ({ key, label }))} />}
            />
          ) : (
            <Table>
              <THead>
                <TH>Name</TH>
                <TH>Prefix</TH>
                <TH>Scopes</TH>
                <TH>Last used</TH>
                <TH>Requests</TH>
                <TH>Status</TH>
                <TH />
              </THead>
              <tbody>
                {keys.map((key) => (
                  <TRow key={key.id} className={key.active ? undefined : 'opacity-50'}>
                    <TD>{key.name}</TD>
                    <TD><code className="text-[12px]">{key.prefix}…</code></TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        {(key.scopes as string[]).map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
                      </span>
                    </TD>
                    <TD>{key.lastUsedAt ? fmtDateTime(key.lastUsedAt) : 'never'}</TD>
                    <TD className="tabular-nums">{key.requestCount}</TD>
                    <TD>
                      {key.revokedAt ? (
                        <Badge tone="red">revoked</Badge>
                      ) : key.expiresAt && key.expiresAt < new Date() ? (
                        <Badge tone="amber">expired</Badge>
                      ) : (
                        <Badge tone="green">active{key.expiresAt ? ` to ${fmtDate(key.expiresAt)}` : ''}</Badge>
                      )}
                    </TD>
                    <TD>{key.active && !key.revokedAt ? <RevokeKeyButton keyId={key.id} /> : null}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={`Webhook endpoints (${endpoints.length})`}
          description={`Signed with HMAC-SHA256. Retried up to ${MAX_WEBHOOK_ATTEMPTS} times with backoff, then abandoned visibly.`}
          actions={<CreateWebhookButton events={[...WORKFLOW_TRIGGERS]} />}
        />
        <CardBody>
          {endpoints.length === 0 ? (
            <EmptyState title="No endpoints" description="Add one to push events to another FSW system." />
          ) : (
            <Table>
              <THead>
                <TH>Name</TH>
                <TH>URL</TH>
                <TH>Events</TH>
                <TH>Health</TH>
                <TH />
              </THead>
              <tbody>
                {endpoints.map((e) => {
                  const events = (e.events ?? []) as string[];
                  return (
                    <TRow key={e.id} className={e.active ? undefined : 'opacity-50'}>
                      <TD>{e.name}</TD>
                      <TD className="max-w-xs truncate font-mono text-[12px]">{e.url}</TD>
                      <TD className="text-[12px]">{events.length === 0 ? 'all events' : `${events.length} selected`}</TD>
                      <TD>
                        {!e.active ? (
                          <Badge tone="gray">disabled</Badge>
                        ) : e.consecutiveFailures > 0 ? (
                          <Badge tone="amber">{e.consecutiveFailures} failing</Badge>
                        ) : (
                          <Badge tone="green">healthy</Badge>
                        )}
                        {e.lastSuccessAt ? (
                          <span className="block text-[12px] text-ink-400">last ok {fmtDateTime(e.lastSuccessAt)}</span>
                        ) : null}
                      </TD>
                      <TD><ToggleWebhookButton endpointId={e.id} active={e.active} /></TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent deliveries" />
        <CardBody>
          {recentDeliveries.length === 0 ? (
            <EmptyState title="Nothing delivered yet" description="Events queue here as they happen." />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Endpoint</TH>
                <TH>Event</TH>
                <TH>Status</TH>
                <TH>Attempts</TH>
                <TH>Detail</TH>
              </THead>
              <tbody>
                {recentDeliveries.map((d) => (
                  <TRow key={d.id}>
                    <TD>{fmtDateTime(d.createdAt)}</TD>
                    <TD>{d.endpoint.name}</TD>
                    <TD className="text-[12px]">{d.event}</TD>
                    <TD>
                      <Badge tone={d.status === 'DELIVERED' ? 'green' : d.status === 'PENDING' ? 'gray' : d.status === 'FAILED' ? 'amber' : 'red'}>
                        {d.status.toLowerCase()}
                      </Badge>
                    </TD>
                    <TD className="tabular-nums">{d.attempts}</TD>
                    <TD className="max-w-xs truncate text-[12px] text-ink-500">
                      {d.error ?? (d.responseCode ? `HTTP ${d.responseCode}` : '—')}
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
