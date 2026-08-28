import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guard";
import { listSopsForAdmin, listPeopleForPicker } from "@/lib/services/sop";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { AdminSopTable } from "@/app/(app)/admin/sops/admin-sop-table";

export const metadata = { title: "Manage SOPs" };

const STATUS_OPTIONS = ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "PUBLISHED", "ARCHIVED"] as const;

function buildQuery(base: Record<string, string | undefined>, overrides: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "" && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function AdminSopsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; owner?: string; q?: string; sort?: string; direction?: string; page?: string }>;
}) {
  const actor = await requireAnyPermission(["sop.create", "sop.approve", "sop.publish"]);
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const sort = (["title", "updatedAt", "nextReviewAt", "status"] as const).includes(params.sort as never)
    ? (params.sort as "title" | "updatedAt" | "nextReviewAt" | "status")
    : "updatedAt";
  const direction = params.direction === "asc" ? "asc" : "desc";
  const status = STATUS_OPTIONS.includes(params.status as never) ? (params.status as (typeof STATUS_OPTIONS)[number]) : undefined;

  const [result, people] = await Promise.all([
    listSopsForAdmin(actor, {
      status,
      ownerId: params.owner === "UNASSIGNED" ? "UNASSIGNED" : params.owner || undefined,
      q: params.q,
      sort,
      direction,
      page,
    }),
    listPeopleForPicker(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function sortHref(column: typeof sort) {
    const nextDirection = sort === column && direction === "asc" ? "desc" : "asc";
    return `/admin/sops${buildQuery(params, { sort: column, direction: nextDirection, page: undefined })}`;
  }

  return (
    <>
      <PageHeader
        title="Manage SOPs"
        description="Create, review, and publish standard procedures and policies."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Admin" }, { label: "SOPs" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/sops/review">
              <Button variant="secondary" size="sm">
                <Glyph name="alert" className="h-4 w-4" />
                Review dashboard
              </Button>
            </Link>
            {actor.permissions.has("ai.generate") && (
              <Link href="/admin/ai-studio?type=sop">
                <Button variant="secondary" size="sm">
                  <Glyph name="sparkle" className="h-4 w-4" />
                  Draft with AI
                </Button>
              </Link>
            )}
            {actor.permissions.has("sop.create") && (
              <Link href="/admin/sops/new">
                <Button size="sm">
                  <Glyph name="plus" className="h-4 w-4" />
                  New SOP
                </Button>
              </Link>
            )}
          </div>
        }
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <form method="GET" action="/admin/sops" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_12rem_auto]">
              <Field label="Search" htmlFor="admin-sop-search">
                <Input id="admin-sop-search" name="q" placeholder="Title or code…" defaultValue={params.q ?? ""} />
              </Field>
              <Field label="Status" htmlFor="admin-sop-status">
                <Select id="admin-sop-status" name="status" defaultValue={params.status ?? ""}>
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Owner" htmlFor="admin-sop-owner">
                <Select id="admin-sop-owner" name="owner" defaultValue={params.owner ?? ""}>
                  <option value="">All owners</option>
                  <option value="UNASSIGNED">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full lg:w-auto">
                  <Glyph name="search" className="h-4 w-4" />
                  Filter
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {result.items.length === 0 ? (
          <EmptyState
            icon={<Icon name="sop" className="h-5 w-5" />}
            title="No SOPs match these filters"
            description="Create a new SOP or adjust your filters."
            actions={
              actor.permissions.has("sop.create") ? (
                <Link href="/admin/sops/new">
                  <Button>New SOP</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-[0.75rem] text-[var(--text-muted)]">
              <span>Sort:</span>
              {(["title", "status", "updatedAt", "nextReviewAt"] as const).map((column) => (
                <Link key={column} href={sortHref(column)} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] hover:underline">
                  {column === "updatedAt" ? "Updated" : column === "nextReviewAt" ? "Next review" : column === "title" ? "Title" : "Status"}
                  {sort === column && <Glyph name={direction === "asc" ? "chevron-down" : "chevron-down"} className={direction === "asc" ? "h-3 w-3 rotate-180" : "h-3 w-3"} />}
                </Link>
              ))}
            </div>
            <AdminSopTable items={result.items} ownerOptions={people} />
            {totalPages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
                <p className="text-[0.8125rem] text-[var(--text-muted)]">
                  Page {result.page} of {totalPages} · {result.total} total
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    aria-disabled={page <= 1}
                    className={page <= 1 ? "pointer-events-none" : undefined}
                    href={`/admin/sops${buildQuery(params, { page: page - 1 })}`}
                  >
                    <Button variant="outline" size="sm" disabled={page <= 1}>
                      <Glyph name="chevron-left" className="h-4 w-4" /> Previous
                    </Button>
                  </Link>
                  <Link
                    aria-disabled={page >= totalPages}
                    className={page >= totalPages ? "pointer-events-none" : undefined}
                    href={`/admin/sops${buildQuery(params, { page: page + 1 })}`}
                  >
                    <Button variant="outline" size="sm" disabled={page >= totalPages}>
                      Next <Glyph name="chevron-right" className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </nav>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
