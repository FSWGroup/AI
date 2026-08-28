import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { reportsFor } from '@/lib/reports';
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Table, THead, TH, TRow, TD, cx } from '@/components/ui';

export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'reports.run');
  const params = await searchParams;

  const available = reportsFor(ctx);
  const selected = params.report ? available.find((r) => r.key === params.report) : undefined;
  const result = selected ? await selected.run(ctx, params) : null;

  const categories = [...new Set(available.map((r) => r.category))];

  const exportHref = selected
    ? `/api/exports?report=${selected.key}${params.start ? `&start=${params.start}` : ''}${params.end ? `&end=${params.end}` : ''}`
    : '#';

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Every report respects your permissions. Exports are audited with the report name and row count."
        actions={
          selected && can(ctx, 'reports.export') ? (
            <ButtonLink href={exportHref}>Export CSV</ButtonLink>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="h-fit lg:col-span-1">
          <CardHeader title="Report library" />
          <div className="px-2 py-2">
            {categories.map((cat) => (
              <div key={cat} className="mb-3">
                <div className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{cat}</div>
                <ul className="space-y-0.5">
                  {available
                    .filter((r) => r.category === cat)
                    .map((r) => (
                      <li key={r.key}>
                        <Link
                          href={`/reports?report=${r.key}`}
                          aria-current={selected?.key === r.key ? 'page' : undefined}
                          className={cx(
                            'block rounded px-2 py-1.5 text-[13px]',
                            selected?.key === r.key ? 'bg-brand-600 font-medium text-white' : 'text-ink-600 hover:bg-ink-100',
                          )}
                        >
                          {r.title}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <div className="lg:col-span-3">
          {!selected || !result ? (
            <Card>
              <EmptyState title="Choose a report" description="Pick one from the library to run it." />
            </Card>
          ) : (
            <Card>
              <CardHeader title={selected.title} description={`${selected.description} · ${result.rows.length} rows`} />
              {result.rows.length === 0 ? (
                <EmptyState title="No data for this report yet" />
              ) : (
                <Table>
                  <THead>
                    {result.headers.map((h) => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </THead>
                  <tbody>
                    {result.rows.slice(0, 200).map((row, i) => (
                      <TRow key={i}>
                        {row.map((cell, j) => (
                          <TD key={j} className={typeof cell === 'number' ? 'tabular-nums' : ''}>
                            {cell === null || cell === '' ? '—' : String(cell)}
                          </TD>
                        ))}
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
              {result.rows.length > 200 ? (
                <div className="border-t border-ink-100 px-4 py-2.5 text-[12px] text-ink-500">
                  Showing the first 200 of {result.rows.length} rows — export the CSV for the full set.
                </div>
              ) : null}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
