import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { listAnnouncementsForAdmin } from "@/lib/services/announcements";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";

export default async function AnnouncementsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("announcements.manage");
  const params = await searchParams;
  const { items, total, page, pageSize } = await listAnnouncementsForAdmin({ page: Number(params.page) || 1, q: params.q });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const now = Date.now();

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Targeted messages shown on the home feed, with optional required acknowledgement."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Announcements" }]}
        actions={
          <Link
            href="/admin/announcements/new"
            className="inline-flex h-9.5 items-center gap-1.5 rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <Glyph name="plus" className="h-4 w-4" />
            New announcement
          </Link>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<Icon name="announcement" className="h-5 w-5" />}
            title="No announcements yet"
            description="Create one to reach everyone, or a specific business unit, department, team, location, or role."
            actions={
              <Link href="/admin/announcements/new" className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">
                New announcement
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((a) => {
              const status = a.expiresAt && a.expiresAt.getTime() < now ? "Expired" : a.startsAt.getTime() > now ? "Scheduled" : "Active";
              return (
                <li key={a.id}>
                  <Link
                    href={`/admin/announcements/${a.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 hover:border-[var(--border-strong)]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {a.pinned && <Glyph name="star-filled" className="h-3.5 w-3.5 text-signal-500" />}
                        <p className="truncate font-medium text-[var(--text-primary)]">{a.title}</p>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[0.8125rem] text-[var(--text-muted)]">{a.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.requiresAck && (
                        <Badge tone="info">{a._count.acks} ack{a._count.acks === 1 ? "" : "s"}</Badge>
                      )}
                      <Badge tone={status === "Active" ? "success" : status === "Expired" ? "neutral" : "warning"}>{status}</Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {totalPages > 1 && (
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            Page {page} of {totalPages} · {total} announcements
          </p>
        )}
      </PageBody>
    </div>
  );
}
