import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtMoney } from '@/lib/format';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Table, THead, TH, TRow, TD } from '@/components/ui';
import { BandForm, DeleteBandButton } from './band-forms';

export const metadata: Metadata = { title: 'Salary bands' };

export default async function BandsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'comp.bands');

  const bands = await db.salaryBand.findMany({ orderBy: [{ jobFamily: 'asc' }, { jobLevel: 'asc' }] });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Compensation', href: '/comp' }, { label: 'Salary bands' }]}
        title="Salary bands"
        description="Bands by job family, level and geography — drives compa-ratio and range penetration."
      />
      <div className="space-y-4">
        <Card>
          {bands.length === 0 ? (
            <EmptyState title="No bands yet" description="Add a band below." />
          ) : (
            <Table>
              <THead><TH>Job family</TH><TH>Level</TH><TH>Geography</TH><TH>Min</TH><TH>Mid</TH><TH>Max</TH><TH></TH></THead>
              <tbody>
                {bands.map((b) => (
                  <TRow key={b.id}>
                    <TD className="font-medium">{b.jobFamily}</TD>
                    <TD>{b.jobLevel}</TD>
                    <TD>{b.geography}</TD>
                    <TD className="tabular-nums">{fmtMoney(Number(b.minAmount), b.currency)}</TD>
                    <TD className="tabular-nums">{fmtMoney(Number(b.midAmount), b.currency)}</TD>
                    <TD className="tabular-nums">{fmtMoney(Number(b.maxAmount), b.currency)}</TD>
                    <TD><DeleteBandButton bandId={b.id} /></TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Add or update a band" description="Same family + level + geography overwrites the existing band." />
          <CardBody>
            <BandForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
