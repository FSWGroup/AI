import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guard";
import { getReviewDashboardData, type ReviewBucket } from "@/lib/services/sop";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export const metadata = { title: "SOP Review Dashboard" };

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "blue",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

function BucketSection({
  title,
  description,
  bucket,
  emptyText,
}: {
  title: string;
  description: string;
  bucket: ReviewBucket;
  emptyText: string;
}) {
  return (
    <Card>
      <CardContent>
        <SectionHeading title={`${title} (${bucket.count})`} description={description} level={3} />
        {bucket.items.length === 0 ? (
          <p className="py-4 text-[0.8125rem] text-[var(--text-muted)]">{emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">SOP</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Status</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Owner</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Next review</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Last reviewed</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 pr-3 text-left">Updated</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] py-2 text-left">Open reports</th>
                </tr>
              </thead>
              <tbody>
                {bucket.items.map((item) => (
                  <tr key={item.id}>
                    <td className="border-b border-[var(--border-subtle)] py-2 pr-3">
                      <Link href={`/admin/sops/${item.id}/edit`} className="font-medium text-[var(--brand-secondary)] hover:underline">
                        {item.sopCode} — {item.title}
                      </Link>
                    </td>
                    <td className="border-b border-[var(--border-subtle)] py-2 pr-3">
                      <Badge tone={STATUS_TONE[item.status] ?? "neutral"}>{item.status.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="border-b border-[var(--border-subtle)] py-2 pr-3">{item.ownerName ?? "Unassigned"}</td>
                    <td className="border-b border-[var(--border-subtle)] py-2 pr-3">{item.nextReviewAt ? new Date(item.nextReviewAt).toLocaleDateString() : "—"}</td>
                    <td className="border-b border-[var(--border-subtle)] py-2 pr-3">{item.lastReviewedAt ? new Date(item.lastReviewedAt).toLocaleDateString() : "Never"}</td>
                    <td className="border-b border-[var(--border-subtle)] py-2 pr-3">{new Date(item.updatedAt).toLocaleDateString()}</td>
                    <td className="border-b border-[var(--border-subtle)] py-2">{item.openReportCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bucket.count > bucket.items.length && (
              <p className="mt-2 text-[0.75rem] text-[var(--text-muted)]">Showing {bucket.items.length} of {bucket.count}.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function SopReviewDashboardPage() {
  const actor = await requireAnyPermission(["sop.approve", "sop.publish", "sop.create"]);
  const data = await getReviewDashboardData(actor);

  const totalNeedingAttention =
    data.overdue.count + data.withoutOwners.count + data.neverReviewed.count + data.frequentlyReported.count;

  return (
    <>
      <PageHeader
        title="SOP Review Dashboard"
        description="Where the content library needs attention — reviews coming due, gaps in ownership, and repeated outdated reports."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Admin" }, { label: "SOPs", href: "/admin/sops" }, { label: "Review dashboard" }]}
      />
      <PageBody className="flex flex-col gap-5">
        {totalNeedingAttention === 0 && data.dueForReview.count === 0 ? (
          <EmptyState
            icon={<Icon name="approval" className="h-5 w-5" />}
            title="Everything looks current"
            description="No overdue reviews, ownership gaps, or repeated outdated reports right now."
          />
        ) : null}

        <BucketSection
          title="Overdue for review"
          description="Published SOPs whose review date has passed."
          bucket={data.overdue}
          emptyText="Nothing overdue."
        />
        <BucketSection
          title="Due for review soon"
          description="Review date falls within the next 30 days."
          bucket={data.dueForReview}
          emptyText="Nothing due in the next 30 days."
        />
        <BucketSection
          title="Without an owner"
          description="No one is accountable for keeping these current."
          bucket={data.withoutOwners}
          emptyText="Every SOP has an owner."
        />
        <BucketSection
          title="Never reviewed"
          description="Has not gone through a review cycle since creation."
          bucket={data.neverReviewed}
          emptyText="Nothing outstanding."
        />
        <BucketSection
          title="Frequently reported outdated"
          description="Two or more open outdated-content reports."
          bucket={data.frequentlyReported}
          emptyText="No SOP has multiple open reports."
        />
        <BucketSection
          title="Recently modified"
          description="Updated in the last 14 days."
          bucket={data.recentlyModified}
          emptyText="No recent edits."
        />
        <BucketSection
          title="Current"
          description="Published and on schedule for review."
          bucket={data.current}
          emptyText="No published SOPs are currently on schedule."
        />
      </PageBody>
    </>
  );
}
