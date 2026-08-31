import Link from "next/link";
import type { Metadata } from "next";
import type { NearMissStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth/guard";
import {
  getNearMissQueue,
  getNearMissStats,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
} from "@/lib/services/near-miss";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { SEVERITY_TONE } from "@/app/(app)/near-misses/severity";

export const metadata: Metadata = { title: "Near-Miss Review Queue" };

const TABS: { label: string; value: string; statuses: NearMissStatus[] }[] = [
  { label: "Needs review", value: "open", statuses: ["REPORTED", "UNDER_REVIEW"] },
  { label: "Published", value: "published", statuses: ["PUBLISHED"] },
  { label: "Archived", value: "archived", statuses: ["ARCHIVED"] },
];

export default async function NearMissQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requirePermission("nearmiss.review");
  const params = await searchParams;
  const tab = TABS.find((option) => option.value === params.tab) ?? TABS[0]!;

  const [items, stats] = await Promise.all([
    getNearMissQueue(actor, { status: tab.statuses }),
    getNearMissStats(actor),
  ]);

  return (
    <>
      <PageHeader
        title="Near-miss review"
        description="Turn a report into a case study: take out anything that identifies a person, establish the cause, record what changed, then publish. Publication is refused while the text still names someone."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Admin" }, { label: "Near Misses" }]}
        meta={
          <>
            <Badge tone={stats.awaitingReview > 0 ? "warning" : "success"} dot>
              {stats.awaitingReview} awaiting review
            </Badge>
            <Badge tone="neutral">{stats.published} published</Badge>
            <Badge tone="neutral">{stats.recent} reported in 90 days</Badge>
          </>
        }
        actions={
          <Link href="/near-misses">
            <Button variant="outline">Open the library</Button>
          </Link>
        }
      />

      <PageBody className="flex flex-col gap-4">
        <nav aria-label="Filter by status" className="flex flex-wrap items-center gap-1.5">
          {TABS.map((option) => {
            const active = option.value === tab.value;
            return (
              <Link
                key={option.value}
                href={`/admin/near-misses?tab=${option.value}`}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "inline-flex h-9 items-center rounded-md bg-navy-800 px-3.5 text-[0.8125rem] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    : "inline-flex h-9 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 text-[0.8125rem] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                }
              >
                {option.label}
              </Link>
            );
          })}
        </nav>

        {items.length === 0 ? (
          <EmptyState
            icon={<Icon name="nearmiss" className="h-5 w-5" />}
            title={
              tab.value === "open"
                ? "Nothing is waiting for review"
                : `Nothing ${tab.label.toLowerCase()} yet`
            }
            description={
              tab.value === "open"
                ? "Every report has been published or archived. A quiet queue is only good news if people are still filing — check the 90-day count above."
                : undefined
            }
          />
        ) : (
          <ul aria-label={`Near-miss reports: ${tab.label}`} className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="navy">{item.reference}</Badge>
                        <Badge tone={SEVERITY_TONE[item.severity]}>
                          {SEVERITY_LABELS[item.severity]}
                        </Badge>
                        <Badge tone="neutral">{CATEGORY_LABELS[item.category]}</Badge>
                        <Badge tone={item.status === "REPORTED" ? "info" : "neutral"}>
                          {STATUS_LABELS[item.status]}
                        </Badge>
                        {item.anonymous && <Badge tone="neutral">Anonymous</Badge>}
                      </div>

                      <Link
                        href={`/admin/near-misses/${item.id}`}
                        className="mt-2 block rounded-sm text-[0.9375rem] font-semibold text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        {item.title}
                      </Link>

                      <p className="mt-1 text-[0.75rem] text-[var(--text-muted)]">
                        {item.departmentName ? `${item.departmentName} · ` : ""}
                        {item.waitingDays === 0
                          ? "Filed today"
                          : `Waiting ${item.waitingDays} ${item.waitingDays === 1 ? "day" : "days"}`}
                        {item.occurredOn ? ` · happened ${item.occurredOn.toLocaleDateString()}` : ""}
                      </p>
                    </div>

                    <Link href={`/admin/near-misses/${item.id}`} className="shrink-0">
                      <Button variant="secondary" size="sm">
                        {tab.value === "open" ? "Review" : "Open"}
                      </Button>
                    </Link>
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
