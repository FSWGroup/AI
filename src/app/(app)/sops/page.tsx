import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { listSopsForLibrary, listSopCategories } from "@/lib/services/sop";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Icon, Glyph } from "@/components/icons";
import { FavoriteButton } from "@/app/(app)/sops/favorite-button";

export const metadata = { title: "SOP & Policy Library" };

function buildQuery(base: Record<string, string | undefined>, overrides: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "" && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function SopLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; department?: string; category?: string; kind?: string; page?: string }>;
}) {
  const actor = await requirePermission("sop.view");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const kind = params.kind === "SOP" || params.kind === "POLICY" ? params.kind : undefined;

  const [result, categories, departments] = await Promise.all([
    listSopsForLibrary(actor, {
      q: params.q,
      department: params.department || undefined,
      category: params.category || undefined,
      kind,
      page,
    }),
    listSopCategories(),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasFilters = Boolean(params.q || params.department || params.category || params.kind);

  return (
    <>
      <PageHeader
        title="SOP & Policy Library"
        description="Standard procedures and policies — always the current, approved version."
        crumbs={[{ label: "Home", href: "/home" }, { label: "SOP Library" }]}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <form method="GET" action="/sops" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_9rem_auto]">
              <Field label="Search" htmlFor="sop-search">
                <Input id="sop-search" name="q" placeholder="Title or code…" defaultValue={params.q ?? ""} />
              </Field>
              <Field label="Department" htmlFor="sop-department">
                <Select id="sop-department" name="department" defaultValue={params.department ?? ""}>
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category" htmlFor="sop-category">
                <Select id="sop-category" name="category" defaultValue={params.category ?? ""}>
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" htmlFor="sop-kind">
                <Select id="sop-kind" name="kind" defaultValue={params.kind ?? ""}>
                  <option value="">SOPs &amp; Policies</option>
                  <option value="SOP">SOPs only</option>
                  <option value="POLICY">Policies only</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full lg:w-auto">
                  <Glyph name="search" className="h-4 w-4" />
                  Search
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {result.items.length === 0 ? (
          <EmptyState
            icon={<Icon name="sop" className="h-5 w-5" />}
            title={hasFilters ? "No SOPs match those filters" : "No SOPs are published yet"}
            description={
              hasFilters
                ? "Try a broader search or clear a filter."
                : "Published SOPs and policies will appear here as they become available."
            }
            actions={hasFilters ? <Link href="/sops"><Button variant="secondary">Clear filters</Button></Link> : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((sop) => (
              <Card key={sop.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="navy">{sop.sopCode}</Badge>
                      <Badge tone={sop.kind === "POLICY" ? "info" : "neutral"}>{sop.kind === "POLICY" ? "Policy" : "SOP"}</Badge>
                    </div>
                    <FavoriteButton sopId={sop.id} initialFavorited={sop.favorited} />
                  </div>
                  <Link href={`/sops/${sop.id}`} className="text-[0.9375rem] font-semibold text-[var(--text-primary)] hover:underline">
                    {sop.title}
                  </Link>
                  {sop.summary && <p className="line-clamp-2 text-[0.8125rem] text-[var(--text-muted)]">{sop.summary}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[0.75rem] text-[var(--text-muted)]">
                    {sop.category && <span>{sop.category}</span>}
                    {sop.departmentName && <span>{sop.departmentName}</span>}
                    <span>
                      Last reviewed {sop.lastReviewedAt ? new Date(sop.lastReviewedAt).toLocaleDateString() : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {result.items.length > 0 && totalPages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
            <p className="text-[0.8125rem] text-[var(--text-muted)]">
              Page {result.page} of {totalPages} · {result.total} total
            </p>
            <div className="flex items-center gap-2">
              <Link
                aria-disabled={page <= 1}
                className={page <= 1 ? "pointer-events-none" : undefined}
                href={`/sops${buildQuery(params, { page: page - 1 })}`}
              >
                <Button variant="outline" size="sm" disabled={page <= 1}>
                  <Glyph name="chevron-left" className="h-4 w-4" /> Previous
                </Button>
              </Link>
              <Link
                aria-disabled={page >= totalPages}
                className={page >= totalPages ? "pointer-events-none" : undefined}
                href={`/sops${buildQuery(params, { page: page + 1 })}`}
              >
                <Button variant="outline" size="sm" disabled={page >= totalPages}>
                  Next <Glyph name="chevron-right" className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </nav>
        )}
      </PageBody>
    </>
  );
}
