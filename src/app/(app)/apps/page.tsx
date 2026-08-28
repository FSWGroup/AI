import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDate, fmtMoney, fullName } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, THead, TH, TRow, TD } from '@/components/ui';
import { AppForm, GrantForm, RevokeButton } from './app-forms';

export const metadata: Metadata = { title: 'App access' };

export default async function AppsPage({
  searchParams,
}: {
  searchParams: Promise<{ grant?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'apps.admin');
  const params = await searchParams;

  const [apps, workers] = await Promise.all([
    db.softwareApp.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: {
        grants: {
          where: { revokedAt: null },
          include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true, status: true } } },
        },
      },
    }),
    db.worker.findMany({
      where: { status: { notIn: ['TERMINATED'] }, deletedAt: null },
      select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    }),
  ]);
  const workerOptions = workers.map((w) => ({ value: w.id, label: fullName(w) }));

  return (
    <div>
      <PageHeader
        title="Application access"
        description="Who has access to what. Offboarding generates revoke tasks; grants here are the system of record."
      />
      <div className="space-y-4">
        {apps.map((app) => (
          <Card key={app.id}>
            <CardHeader
              title={app.name}
              description={
                <>
                  {app.grants.length} active user{app.grants.length === 1 ? '' : 's'}
                  {app.monthlyCostPerSeat ? ` · ${fmtMoney(Number(app.monthlyCostPerSeat))}/seat/mo (${fmtMoney(app.grants.length * Number(app.monthlyCostPerSeat))}/mo total)` : ''}
                  {app.renewalDate ? ` · renews ${fmtDate(app.renewalDate)}` : ''}
                  {app.autoProvisionOnboarding ? ' · auto-provisioned in onboarding' : ''}
                </>
              }
              actions={<GrantForm appId={app.id} workers={workerOptions} preselect={params.grant} />}
            />
            {app.grants.length === 0 ? (
              <CardBody><p className="text-[13px] text-ink-400">No active grants.</p></CardBody>
            ) : (
              <Table>
                <THead><TH>Worker</TH><TH>Level</TH><TH>Granted</TH><TH></TH></THead>
                <tbody>
                  {app.grants.map((g) => (
                    <TRow key={g.id}>
                      <TD>
                        <Link href={`/people/${g.worker.id}?tab=assets`} className="font-medium text-ink-900 hover:text-brand-600">
                          {fullName(g.worker)}
                        </Link>
                        {g.worker.status === 'OFFBOARDING' ? <Badge tone="red">offboarding — revoke!</Badge> : null}
                      </TD>
                      <TD>{g.accessLevel.toLowerCase()}</TD>
                      <TD>{fmtDate(g.grantedAt)}</TD>
                      <TD><RevokeButton grantId={g.id} /></TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ))}
        {apps.length === 0 ? <Card><EmptyState title="No applications in the catalog" /></Card> : null}

        <Card>
          <CardHeader title="Add / update application" />
          <CardBody>
            <AppForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
