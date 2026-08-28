import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDateTime, fullName } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { RegisterKioskButton, RevokeKioskButton } from './kiosk-ui';

export const metadata: Metadata = { title: 'Kiosks' };
export const dynamic = 'force-dynamic';

export default async function KiosksPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'settings.admin');

  const [devices, locations, recentPunches, withPin] = await Promise.all([
    db.kioskDevice.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] }),
    db.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.kioskPunch.findMany({
      orderBy: { at: 'desc' },
      take: 25,
      include: {
        device: { select: { name: true } },
        worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      },
    }),
    db.worker.count({ where: { kioskPinHash: { not: null }, deletedAt: null } }),
  ]);

  const active = devices.filter((d) => d.active && !d.revokedAt);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Admin', href: '/admin/settings' }, { label: 'Kiosks' }]}
        title="Time clock kiosks"
        description="Shared tablets for the crew who have no desk, no laptop and no work email."
        actions={<RegisterKioskButton locations={locations} />}
      />

      <Callout tone="info">
        A kiosk authenticates the <strong>device</strong>, not a person: a registered tablet plus a 4-digit PIN is
        enough to punch a clock and deliberately nothing else. A kiosk holds no session, and there is no page it can
        reach that shows pay, personal details or anyone&rsquo;s record. Revoking a device cuts it off immediately.
      </Callout>

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Active kiosks" value={active.length} />
        <StatCard label="Workers with a PIN" value={withPin} />
        <StatCard label="Punches recorded" value={recentPunches.length >= 25 ? '25+' : recentPunches.length} hint="most recent" />
      </div>

      <Card className="mb-4">
        <CardHeader title="Registered devices" />
        <CardBody>
          {devices.length === 0 ? (
            <EmptyState
              title="No kiosks yet"
              description="Register a tablet, then open its one-time setup link on the device itself."
              action={<RegisterKioskButton locations={locations} />}
            />
          ) : (
            <Table>
              <THead>
                <TH>Device</TH>
                <TH>Status</TH>
                <TH>Last seen</TH>
                <TH />
              </THead>
              <tbody>
                {devices.map((d) => (
                  <TRow key={d.id} className={d.active ? undefined : 'opacity-50'}>
                    <TD>{d.name}</TD>
                    <TD>
                      {d.revokedAt ? <Badge tone="red">revoked</Badge> : d.active ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}
                    </TD>
                    <TD>{d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : 'never claimed'}</TD>
                    <TD>{d.active && !d.revokedAt ? <RevokeKioskButton deviceId={d.id} /> : null}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Recent punches"
          description="Kept as evidence independently of the timesheet, and append-only — a disputed hour is settled from here."
        />
        <CardBody>
          {recentPunches.length === 0 ? (
            <EmptyState title="No punches yet" />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Person</TH>
                <TH>Direction</TH>
                <TH>Device</TH>
              </THead>
              <tbody>
                {recentPunches.map((p) => (
                  <TRow key={p.id}>
                    <TD>{fmtDateTime(p.at)}</TD>
                    <TD>{fullName(p.worker)}</TD>
                    <TD>
                      <Badge tone={p.kind === 'IN' ? 'green' : 'gray'}>{p.kind === 'IN' ? 'clocked in' : 'clocked out'}</Badge>
                    </TD>
                    <TD>{p.device.name}</TD>
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
