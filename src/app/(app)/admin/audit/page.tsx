import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { PageHeader, PageBody } from "@/components/page-header";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import Link from "next/link";

const PAGE_SIZE = 30;

function actionTone(action: string): "danger" | "warning" | "neutral" {
  if (action.includes("revoked") || action.includes("deactivat") || action.includes("deleted") || action.includes("failed") || action.includes("forbidden")) return "danger";
  if (action.includes("override") || action.includes("changed") || action.includes("sensitive")) return "warning";
  return "neutral";
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("audit.view");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.AuditEventWhereInput = {
    ...(params.actor ? { actorEmail: { contains: params.actor, mode: "insensitive" } } : {}),
    ...(params.action ? { action: { contains: params.action, mode: "insensitive" } } : {}),
    ...(params.entityType ? { entityType: { contains: params.entityType, mode: "insensitive" } } : {}),
    ...(params.q
      ? {
          OR: [
            { actorEmail: { contains: params.q, mode: "insensitive" } },
            { action: { contains: params.q, mode: "insensitive" } },
            { entityId: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(params.dateFrom || params.dateTo
      ? {
          createdAt: {
            ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
            ...(params.dateTo ? { lte: new Date(`${params.dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (overrides: Record<string, string | number>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...overrides })) {
      if (v !== undefined && v !== "") next.set(k, String(v));
    }
    return `/admin/audit?${next.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Audit log" description="Every high-risk operation, append-only. Nothing here can be edited or deleted." crumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit log" }]} />
      <PageBody className="flex flex-col gap-4">
        <form method="get" className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Actor email" htmlFor="f-actor">
            <Input id="f-actor" name="actor" defaultValue={params.actor} placeholder="name@company.com" />
          </Field>
          <Field label="Action contains" htmlFor="f-action">
            <Input id="f-action" name="action" defaultValue={params.action} placeholder="e.g. sop.publish" />
          </Field>
          <Field label="Entity type" htmlFor="f-entity">
            <Select id="f-entity" name="entityType" defaultValue={params.entityType ?? ""}>
              <option value="">Any</option>
              {["USER", "SOP", "COURSE", "ASSIGNMENT", "CERTIFICATE", "INTEGRATION", "API_KEY", "WEBHOOK", "MEDIA", "ANNOUNCEMENT", "ROLE", "APP_SETTING", "ORGANIZATION"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="f-from">
            <Input id="f-from" type="date" name="dateFrom" defaultValue={params.dateFrom} />
          </Field>
          <Field label="To" htmlFor="f-to">
            <Input id="f-to" type="date" name="dateTo" defaultValue={params.dateTo} />
          </Field>
          <Field label="Free text" htmlFor="f-q" className="sm:col-span-2 lg:col-span-3">
            <Input id="f-q" name="q" defaultValue={params.q} placeholder="Search actor, action, or entity id" />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit">Filter</Button>
            <Link href="/admin/audit" className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">
              Clear
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<Icon name="audit" className="h-5 w-5" />} title="No matching events" description="Try widening your filters." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-[0.8125rem]">
              <thead className="bg-[var(--surface-sunken)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">When</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Actor</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Action</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Entity</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--border-subtle)] align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{row.createdAt.toLocaleString()}</td>
                    <td className="px-3 py-2">{row.actorEmail ?? <span className="text-[var(--text-muted)]">System</span>}</td>
                    <td className="px-3 py-2">
                      <Badge tone={actionTone(row.action)}>{row.action}</Badge>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {row.entityType ? (
                        <span>
                          {row.entityType}
                          {row.entityId ? ` · ${row.entityId}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2">
                      {row.metadata ? (
                        <details>
                          <summary className="cursor-pointer text-[0.75rem] font-medium text-[var(--brand-secondary)]">View</summary>
                          <pre className="mt-1 max-w-xs overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[var(--surface-sunken)] p-2 text-[0.6875rem]">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between text-[0.8125rem]">
            <p className="text-[var(--text-muted)]">
              Page {page} of {totalPages} · {total} events
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={qs({ page: page - 1 })} className="rounded-md border border-[var(--border-default)] px-3 py-1.5 hover:bg-[var(--surface-sunken)]">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={qs({ page: page + 1 })} className="rounded-md border border-[var(--border-default)] px-3 py-1.5 hover:bg-[var(--surface-sunken)]">
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
