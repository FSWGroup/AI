import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCtx, assertPermission } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { fmtMoney } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { earlyAttritionCohorts, timeToFill, compaRatios, retentionSignals } from '@/lib/analytics/workforce';

export const metadata: Metadata = { title: 'Workforce analytics' };
export const dynamic = 'force-dynamic';

const BAND_TONE = { ELEVATED: 'red', MODERATE: 'amber', LOW: 'gray' } as const;
const POSITION_TONE = { BELOW_MIN: 'red', LOW: 'amber', IN_RANGE: 'green', HIGH: 'blue', ABOVE_MAX: 'blue' } as const;

export default async function WorkforceAnalyticsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'insights.workforce');

  const [cohorts, fill, compa, signals] = await Promise.all([
    earlyAttritionCohorts(),
    timeToFill(),
    compaRatios(),
    retentionSignals(),
  ]);

  // Retention signals name individuals against a risk band. Looking at that
  // list is worth recording, the same as revealing an encrypted identifier.
  await audit(ctx, 'insights.retention_viewed', {
    metadata: { population: signals.length, elevated: signals.filter((s) => s.signal.band === 'ELEVATED').length },
  });

  const elevated = signals.filter((s) => s.signal.band === 'ELEVATED').sort((a, b) => b.signal.score - a.signal.score);
  const moderate = signals.filter((s) => s.signal.band === 'MODERATE');
  const belowMin = compa.filter((c) => c.position === 'BELOW_MIN');
  const matured = cohorts.filter((c) => c.ninetyDayAttritionPct !== null);
  const latestNinetyDay = matured.at(-1)?.ninetyDayAttritionPct ?? null;
  const openReqs = fill.reduce((sum, r) => sum + r.openNow, 0);

  return (
    <div>
      <PageHeader
        title="Workforce analytics"
        description="Leading indicators, built from effective-dated history rather than today's snapshot."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="90-day attrition"
          value={latestNinetyDay === null ? '—' : `${latestNinetyDay.toFixed(0)}%`}
          hint="most recent matured cohort"
          tone={latestNinetyDay !== null && latestNinetyDay > 20 ? 'danger' : 'default'}
        />
        <StatCard label="Elevated retention signals" value={elevated.length} tone={elevated.length > 0 ? 'warn' : 'default'} />
        <StatCard label="Paid below band minimum" value={belowMin.length} tone={belowMin.length > 0 ? 'danger' : 'default'} />
        <StatCard label="Requisitions open now" value={openReqs} />
      </div>

      <Callout tone="warn">
        <strong>How to read the retention signals.</strong> These are named, job-related conditions the company can act
        on — pay that has not moved, a missing 1:1, a manager carrying too many people. They are a prompt for a
        conversation or a pay review, never a basis for adverse action, and they are not a prediction about any
        individual. No characteristic of a person is used: age, date of birth, gender, ethnicity, national origin,
        disability, marital or family status and citizenship are never read by this analysis.
      </Callout>

      <Card className="mt-4 mb-4">
        <CardHeader
          title={`Retention signals (${elevated.length} elevated, ${moderate.length} moderate)`}
          description="Every factor names what it is and what could be done about it."
        />
        <CardBody>
          {elevated.length === 0 && moderate.length === 0 ? (
            <EmptyState title="Nothing elevated" description="No active worker currently matches enough conditions to flag." />
          ) : (
            <ul className="space-y-3">
              {[...elevated, ...moderate].slice(0, 25).map((row) => (
                <li key={row.workerId} className="rounded-md border border-ink-100 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link href={`/people/${row.workerId}`} className="text-sm font-semibold text-ink-900 hover:text-brand-600">
                        {row.name}
                      </Link>
                      <span className="ml-2 text-[12px] text-ink-500">
                        {row.title ?? '—'}
                        {row.department ? ` · ${row.department}` : ''}
                      </span>
                    </div>
                    <Badge tone={BAND_TONE[row.signal.band]}>{row.signal.band.toLowerCase()}</Badge>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {row.signal.factors.map((f) => (
                      <li key={f.id} className="text-[13px] text-ink-700">
                        <span className="font-medium">{f.label}</span>
                        <span className="block text-[12px] text-ink-500">{f.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Early attrition by hire cohort"
            description="A cohort younger than its own 90-day window reports “too early” rather than a flattering zero."
          />
          <CardBody>
            {cohorts.length === 0 ? (
              <EmptyState title="No hires in range" />
            ) : (
              <Table>
                <THead>
                  <TH>Cohort</TH>
                  <TH>Hired</TH>
                  <TH>Left ≤90d</TH>
                  <TH>Left ≤1y</TH>
                  <TH>Rate</TH>
                </THead>
                <tbody>
                  {cohorts.map((c) => (
                    <TRow key={c.cohort}>
                      <TD>{c.cohort}</TD>
                      <TD className="tabular-nums">{c.hired}</TD>
                      <TD className="tabular-nums">{c.leftWithin90Days}</TD>
                      <TD className="tabular-nums">{c.leftWithin1Year}</TD>
                      <TD className="tabular-nums">
                        {c.ninetyDayAttritionPct === null ? (
                          <span className="text-ink-400">too early</span>
                        ) : (
                          `${c.ninetyDayAttritionPct.toFixed(0)}%`
                        )}
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hiring velocity" description="Median days from opening a requisition to an accepted offer." />
          <CardBody>
            {fill.length === 0 ? (
              <EmptyState title="No requisitions opened yet" />
            ) : (
              <Table>
                <THead>
                  <TH>Department</TH>
                  <TH>Filled</TH>
                  <TH>Median days</TH>
                  <TH>Open</TH>
                  <TH>Oldest</TH>
                </THead>
                <tbody>
                  {fill.map((r) => (
                    <TRow key={r.key}>
                      <TD>{r.key}</TD>
                      <TD className="tabular-nums">{r.filled}</TD>
                      <TD className="tabular-nums">{r.medianDays ?? '—'}</TD>
                      <TD className="tabular-nums">{r.openNow}</TD>
                      <TD className="tabular-nums">{r.oldestOpenDays === null ? '—' : `${r.oldestOpenDays}d`}</TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Pay position against band"
          description="Compa-ratio is pay ÷ band midpoint. Hourly rates are annualised at 2,080 hours so they compare like for like."
        />
        <CardBody>
          {compa.length === 0 ? (
            <EmptyState
              title="No bands to compare against"
              description="Define salary bands under Compensation → Salary Bands and this fills in."
            />
          ) : (
            <Table>
              <THead>
                <TH>Person</TH>
                <TH>Role</TH>
                <TH>Pay</TH>
                <TH>Band mid</TH>
                <TH>Compa</TH>
                <TH>Position</TH>
              </THead>
              <tbody>
                {compa.slice(0, 30).map((row) => (
                  <TRow key={row.workerId}>
                    <TD>
                      <Link href={`/people/${row.workerId}`} className="text-ink-900 hover:text-brand-600">
                        {row.name}
                      </Link>
                    </TD>
                    <TD>{`${row.jobFamily} ${row.jobLevel}`}</TD>
                    <TD className="tabular-nums">{fmtMoney(row.amount, row.currency)}</TD>
                    <TD className="tabular-nums">{fmtMoney(row.bandMid, row.currency)}</TD>
                    <TD className="tabular-nums">{row.compaRatio.toFixed(2)}</TD>
                    <TD>
                      <Badge tone={POSITION_TONE[row.position]}>{row.position.replace('_', ' ').toLowerCase()}</Badge>
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
