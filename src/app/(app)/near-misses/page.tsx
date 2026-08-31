import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { NearMissCategory, NearMissSeverity } from "@prisma/client";
import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import {
  getNearMissStats,
  getPublishedNearMisses,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "@/lib/services/near-miss";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Icon, Glyph } from "@/components/icons";
import { SEVERITY_TONE } from "@/app/(app)/near-misses/severity";

export const metadata: Metadata = { title: "Near-Miss Library" };

const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as NearMissCategory[];
const SEVERITY_VALUES = Object.keys(SEVERITY_LABELS) as NearMissSeverity[];

export default async function NearMissLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; severity?: string; department?: string }>;
}) {
  const actor = await requireActor();

  /*
   * Contractors hold nearmiss.report but not nearmiss.view: the reporting
   * channel is deliberately wider than the library. Send them to the thing
   * they can do rather than to a permission error.
   */
  if (!actor.permissions.has("nearmiss.view")) {
    if (actor.permissions.has("nearmiss.report")) redirect("/near-misses/report");
    redirect("/home");
  }

  const params = await searchParams;
  const category = CATEGORY_VALUES.find((value) => value === params.category);
  const severity = SEVERITY_VALUES.find((value) => value === params.severity);

  const [items, stats, departments] = await Promise.all([
    getPublishedNearMisses(actor, {
      q: params.q,
      category,
      severity,
      departmentId: params.department || undefined,
    }),
    getNearMissStats(actor),
    prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const hasFilters = Boolean(params.q || category || severity || params.department);
  const gaps = stats.patterns.filter((pattern) => pattern.withoutProcedure > 0);

  return (
    <>
      <PageHeader
        title="Near-miss library"
        description="What nearly went wrong here, why, and what changed because of it. Nobody is named in any of these — the record carries no fault, by design."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Near Misses" }]}
        meta={
          <>
            <Badge tone="neutral">{stats.published} case studies</Badge>
            {actor.permissions.has("nearmiss.review") && stats.awaitingReview > 0 && (
              <Badge tone="warning" dot>
                {stats.awaitingReview} awaiting review
              </Badge>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {actor.permissions.has("nearmiss.review") && (
              <Link href="/admin/near-misses">
                <Button variant="outline">Review queue</Button>
              </Link>
            )}
            <Link href="/near-misses/report">
              <Button>
                <Glyph name="plus" className="h-4 w-4" />
                Report a near miss
              </Button>
            </Link>
          </div>
        }
      />

      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <form
              method="GET"
              action="/near-misses"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_13rem_11rem_auto]"
            >
              <Field label="Search" htmlFor="nm-q">
                <Input
                  id="nm-q"
                  name="q"
                  placeholder="Reference or wording…"
                  defaultValue={params.q ?? ""}
                />
              </Field>
              <Field label="Kind" htmlFor="nm-filter-category">
                <Select id="nm-filter-category" name="category" defaultValue={category ?? ""}>
                  <option value="">All kinds</option>
                  {CATEGORY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How far it got" htmlFor="nm-filter-severity">
                <Select id="nm-filter-severity" name="severity" defaultValue={severity ?? ""}>
                  <option value="">Any outcome</option>
                  {SEVERITY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {SEVERITY_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Department" htmlFor="nm-filter-department">
                <Select id="nm-filter-department" name="department" defaultValue={params.department ?? ""}>
                  <option value="">All departments</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
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

        {/*
          The pattern worth acting on: a category that keeps recurring with no
          procedure covering it. This is the strongest signal in the library for
          what to write next, so it is above the list rather than in a report.
        */}
        {!hasFilters && gaps.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-2.5">
              <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
                Where no procedure covers what keeps happening
              </h2>
              <p className="text-[0.8125rem] text-[var(--text-muted)]">
                Case studies with no linked procedure. Each one is a candidate for something to
                write down.
              </p>
              <ul aria-label="Categories with no linked procedure" className="flex flex-col gap-1.5 pt-1">
                {gaps.map((pattern) => (
                  <li key={pattern.category} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/near-misses?category=${pattern.category}`}
                      className="rounded-sm text-[0.875rem] font-medium text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      {CATEGORY_LABELS[pattern.category]}
                    </Link>
                    <span className="text-[0.8125rem] text-[var(--text-muted)]">
                      {pattern.withoutProcedure} of {pattern.count} with no procedure linked
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {items.length === 0 ? (
          <EmptyState
            icon={<Icon name="nearmiss" className="h-5 w-5" />}
            title={hasFilters ? "Nothing matches those filters" : "No case studies yet"}
            description={
              hasFilters
                ? "Try a broader search or clear a filter."
                : "When a report is reviewed and published, it appears here. The first one is usually the hardest to get."
            }
            actions={
              hasFilters ? (
                <Link href="/near-misses">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : (
                <Link href="/near-misses/report">
                  <Button>Report a near miss</Button>
                </Link>
              )
            }
          />
        ) : (
          <ul aria-label="Near-miss case studies" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <Card className="flex h-full flex-col">
                  <CardContent className="flex flex-1 flex-col gap-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="navy">{item.reference}</Badge>
                      <Badge tone={SEVERITY_TONE[item.severity]}>
                        {SEVERITY_LABELS[item.severity]}
                      </Badge>
                      <Badge tone="neutral">{CATEGORY_LABELS[item.category]}</Badge>
                    </div>

                    <Link
                      href={`/near-misses/${item.reference}`}
                      className="rounded-sm text-[0.9375rem] font-semibold text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      {item.title}
                    </Link>

                    {item.whatChanged && (
                      <div>
                        <p className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                          What changed
                        </p>
                        <p className="mt-1 line-clamp-3 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                          {item.whatChanged}
                        </p>
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[0.75rem] text-[var(--text-muted)]">
                      {item.department?.name && <span>{item.department.name}</span>}
                      {item.occurredOn && <span>{item.occurredOn.toLocaleDateString()}</span>}
                      {item.preventingSop && <span>Linked to {item.preventingSop.sopCode}</span>}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
