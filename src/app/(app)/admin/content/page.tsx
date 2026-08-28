import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guard";
import { getContentHealth, type ContentHealthBucket } from "@/lib/services/reports";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

function BucketList({ items, valueLabel, hrefFor }: { items: ContentHealthBucket[]; valueLabel: (v: number) => string; hrefFor: (b: ContentHealthBucket) => string }) {
  if (items.length === 0) {
    return <p className="text-[0.8125rem] text-[var(--text-muted)]">Nothing to show.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={`${item.entityType}-${item.entityId}-${i}`}>
          <Link
            href={hrefFor(item)}
            className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-[0.8125rem] hover:border-[var(--border-strong)]"
          >
            <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{item.title}</span>
            <span className="shrink-0 font-medium text-[var(--text-secondary)]">{valueLabel(item.value)}</span>
          </Link>
          <p className="mt-0.5 pl-3 text-[0.75rem] text-[var(--text-muted)]">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function hrefForEntity(item: ContentHealthBucket): string {
  return item.entityType === "SOP" ? `/admin/content/sops/${item.entityId}` : `/admin/content/courses/${item.entityId}`;
}

export default async function ContentHealthPage() {
  await requireAnyPermission(["training.create", "sop.create"]);
  const health = await getContentHealth(10);

  const sections: { title: string; description: string; items: ContentHealthBucket[]; valueLabel: (v: number) => string }[] = [
    { title: "Most viewed", description: "Highest view counts, most recently recorded.", items: health.mostViewed, valueLabel: (v) => `${v} views` },
    { title: "Least viewed", description: "Published content with the fewest (or zero) views.", items: health.leastViewed, valueLabel: (v) => `${v} views` },
    { title: "Lowest rated", description: "Lowest share of “helpful” feedback.", items: health.lowestRated, valueLabel: (v) => `${v}% helpful` },
    { title: "Most reported outdated", description: "Open “report outdated” flags from learners.", items: health.mostReported, valueLabel: (v) => `${v} reports` },
    { title: "Highest quiz failure rate", description: "Quizzes with at least 3 attempts.", items: health.mostFailedQuizzes, valueLabel: (v) => `${v}% fail` },
    { title: "No owner assigned", description: "Published content with nobody accountable for it.", items: health.noOwner, valueLabel: () => "No owner" },
    { title: "Broken links", description: "External links that failed a recent automated check.", items: health.brokenLinks, valueLabel: (v) => `${v} failure(s)` },
    { title: "Review overdue", description: "Published SOPs past their scheduled review date.", items: health.reviewOverdue, valueLabel: (v) => `${v} day(s) overdue` },
  ];

  const totalFindings = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div>
      <PageHeader
        title="Content health"
        description="Views, ratings, reports, quiz failure rates, ownership, links, and review status across published SOPs and courses."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Content health" }]}
      />
      <PageBody>
        {totalFindings === 0 ? (
          <EmptyState icon={<Icon name="content" className="h-5 w-5" />} title="Nothing needs attention" description="No content health issues were found." />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {sections.map((section) => (
              <div key={section.title}>
                <SectionHeading title={section.title} description={section.description} />
                <BucketList items={section.items} valueLabel={section.valueLabel} hrefFor={hrefForEntity} />
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}
