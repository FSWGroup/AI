import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getReport, resolveFilterOptions, type FilterSpec, type FilterOption } from "@/lib/services/reports";
import { PageHeader, PageBody } from "@/components/page-header";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { formatCell } from "@/app/(app)/admin/reports/_shared/format";
import { PersonFilter } from "@/app/(app)/admin/reports/_shared/person-filter";

const DEFAULT_PAGE_SIZE = 25;

function renderFilter(spec: FilterSpec, current: Record<string, string | undefined>, options: Record<string, FilterOption[]>, personLabel: string | undefined) {
  const value = current[spec.key] ?? "";
  if (spec.type === "person") {
    return <PersonFilter key={spec.key} name={spec.key} label={spec.label} defaultId={value} defaultLabel={personLabel} />;
  }
  if (spec.type === "select") {
    return (
      <Field key={spec.key} label={spec.label} htmlFor={`f-${spec.key}`}>
        <Select id={`f-${spec.key}`} name={spec.key} defaultValue={value}>
          <option value="">Any</option>
          {(options[spec.key] ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (spec.type === "date") {
    return (
      <Field key={spec.key} label={spec.label} htmlFor={`f-${spec.key}`}>
        <Input id={`f-${spec.key}`} type="date" name={spec.key} defaultValue={value} />
      </Field>
    );
  }
  if (spec.type === "boolean") {
    return (
      <Field key={spec.key} label={spec.label} htmlFor={`f-${spec.key}`}>
        <Select id={`f-${spec.key}`} name={spec.key} defaultValue={value}>
          <option value="">Any</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      </Field>
    );
  }
  return (
    <Field key={spec.key} label={spec.label} htmlFor={`f-${spec.key}`}>
      <Input id={`f-${spec.key}`} type="text" name={spec.key} defaultValue={value} placeholder={spec.placeholder} />
    </Field>
  );
}

export default async function ReportRunnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { key } = await params;
  const definition = getReport(key);
  if (!definition) notFound();

  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.permissions.has(definition.permission)) redirect(`/forbidden?permission=${encodeURIComponent(definition.permission)}`);

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.pageSize) || DEFAULT_PAGE_SIZE));

  const filters: Record<string, string | undefined> = {};
  for (const f of definition.filters) filters[f.key] = sp[f.key] || undefined;

  const personFilterKey = definition.filters.find((f) => f.type === "person")?.key;
  const [result, filterOptions, personLabel] = await Promise.all([
    definition.run(actor, { filters, page, pageSize }),
    resolveFilterOptions(definition),
    personFilterKey && filters[personFilterKey]
      ? prisma.user.findUnique({ where: { id: filters[personFilterKey] }, select: { name: true } }).then((u) => u?.name)
      : Promise.resolve(undefined),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  const buildHref = (overrides: Record<string, string | number>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...overrides })) {
      if (v !== undefined && v !== "") next.set(k, String(v));
    }
    return `/admin/reports/${key}?${next.toString()}`;
  };

  const exportHref = (format: "csv" | "xlsx" | "pdf") => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v) next.set(k, v);
    }
    next.set("format", format);
    return `/admin/reports/${key}/export?${next.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title={definition.name}
        description={definition.description}
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Reports", href: "/admin/reports" }, { label: definition.name }]}
        actions={
          <div className="flex gap-2">
            {(["csv", "xlsx", "pdf"] as const).map((format) => (
              <a
                key={format}
                href={exportHref(format)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-[0.8125rem] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <Glyph name="download" className="h-3.5 w-3.5" />
                {format.toUpperCase()}
              </a>
            ))}
          </div>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {definition.filters.length > 0 && (
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
            {definition.filters.map((f) => renderFilter(f, sp, filterOptions, f.type === "person" ? personLabel : undefined))}
            <Button type="submit" size="sm">
              Apply
            </Button>
            <Link href={`/admin/reports/${key}`} className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">
              Clear
            </Link>
          </form>
        )}

        {result.summary?.error ? (
          <div className="rounded-md border border-danger-100 bg-danger-50 p-3 text-[0.8125rem] text-danger-700">{String(result.summary.error)}</div>
        ) : result.summary?.hint ? (
          <div className="rounded-md border border-info-100 bg-info-50 p-3 text-[0.8125rem] text-info-700">{String(result.summary.hint)}</div>
        ) : null}

        {result.rows.length === 0 ? (
          <EmptyState icon={<Icon name="report" className="h-5 w-5" />} title="No rows match" description="Try widening or clearing your filters." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-[0.8125rem]">
              <thead className="bg-[var(--surface-sunken)]">
                <tr>
                  {definition.columns.map((col) => (
                    <th key={col.key} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--border-subtle)]">
                    {definition.columns.map((col) => (
                      <td key={col.key} className="whitespace-nowrap px-3 py-2 text-[var(--text-secondary)]">
                        {formatCell(row[col.key], col.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between text-[0.8125rem]">
            <p className="text-[var(--text-muted)]">
              Page {page} of {totalPages} · {result.total} rows
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={buildHref({ page: page - 1 })} className="rounded-md border border-[var(--border-default)] px-3 py-1.5 hover:bg-[var(--surface-sunken)]">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={buildHref({ page: page + 1 })} className="rounded-md border border-[var(--border-default)] px-3 py-1.5 hover:bg-[var(--surface-sunken)]">
                  Next
                </Link>
              )}
            </div>
          </nav>
        )}
      </PageBody>
    </div>
  );
}
