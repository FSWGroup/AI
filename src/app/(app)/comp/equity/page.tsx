import type { Metadata } from 'next';
import { requireCtx, assertPermission } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, Table, TD, TH, THead, TRow } from '@/components/ui';
import { payEquityGroups } from '@/lib/comp-cycle';

export const metadata: Metadata = { title: 'Pay equity' };
export const dynamic = 'force-dynamic';

export default async function PayEquityPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'comp.equity');

  const groups = await payEquityGroups();
  await audit(ctx, 'comp.equity_viewed', { metadata: { groups: groups.length } });

  const wide = groups.filter((g) => (g.spread ?? 1) >= 1.25);
  const belowMin = groups.reduce((sum, g) => sum + g.belowMinimum, 0);
  const singletons = groups.filter((g) => g.headcount === 1).length;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Compensation', href: '/comp' }, { label: 'Pay equity' }]}
        title="Pay equity"
        description="Pay dispersion inside each job family and level — where unexplained differences would show up."
      />

      <Callout tone="warn">
        <strong>What this is, and what it is not.</strong> This reports on roles, not people: it shows how widely pay
        varies inside one job family and level, which is where a difference that nobody can explain would appear. It is
        a place to start looking. It is <em>not</em> a legal pay equity audit — a defensible audit is run by counsel,
        controls for legitimate factors like tenure and performance, and is usually privileged. Nothing here should be
        used to conclude that a gap is, or is not, lawful.
      </Callout>

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Role groups analysed" value={groups.length} />
        <StatCard label="Wide spread (≥1.25×)" value={wide.length} tone={wide.length > 0 ? 'warn' : 'default'} />
        <StatCard label="People below band minimum" value={belowMin} tone={belowMin > 0 ? 'danger' : 'default'} />
        <StatCard label="Single-person levels" value={singletons} hint="No spread to report" />
      </div>

      <Card>
        <CardHeader
          title="Dispersion by job family and level"
          description="Spread is the highest pay divided by the lowest inside the same family and level. Hourly rates are annualised first."
        />
        <CardBody>
          {groups.length === 0 ? (
            <EmptyState
              title="Nothing to compare yet"
              description="This needs salary bands and workers with a job family and level recorded on their current employment."
            />
          ) : (
            <Table>
              <THead>
                <TH>Job family</TH>
                <TH>Level</TH>
                <TH>Region</TH>
                <TH>People</TH>
                <TH>Median compa</TH>
                <TH>Range</TH>
                <TH>Spread</TH>
                <TH>Below min</TH>
              </THead>
              <tbody>
                {groups.map((g) => (
                  <TRow key={`${g.jobFamily}-${g.jobLevel}-${g.geography}`}>
                    <TD>{g.jobFamily}</TD>
                    <TD>{g.jobLevel}</TD>
                    <TD>{g.geography}</TD>
                    <TD className="tabular-nums">{g.headcount}</TD>
                    <TD className="tabular-nums">{g.medianCompaRatio?.toFixed(2) ?? '—'}</TD>
                    <TD className="tabular-nums">
                      {g.minCompaRatio !== null && g.maxCompaRatio !== null
                        ? `${g.minCompaRatio.toFixed(2)} – ${g.maxCompaRatio.toFixed(2)}`
                        : '—'}
                    </TD>
                    <TD className="tabular-nums">
                      {g.spread === null ? (
                        <span className="text-ink-400">n/a</span>
                      ) : g.spread >= 1.25 ? (
                        <Badge tone="amber">{g.spread.toFixed(2)}×</Badge>
                      ) : (
                        `${g.spread.toFixed(2)}×`
                      )}
                    </TD>
                    <TD className="tabular-nums">
                      {g.belowMinimum > 0 ? <Badge tone="red">{g.belowMinimum}</Badge> : '—'}
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
