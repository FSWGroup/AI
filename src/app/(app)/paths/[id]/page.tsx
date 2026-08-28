import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { requirePermission, canViewUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getPathProgress } from "@/lib/services/path";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Glyph, Icon } from "@/components/icons";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const path = await prisma.learningPath.findUnique({ where: { id }, select: { title: true } });
  return { title: path?.title ?? "Learning path" };
}

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "danger" | "navy"> = {
  ASSIGNED: "neutral",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  OVERDUE: "danger",
  WAIVED: "navy",
  EXPIRED: "danger",
};

export default async function PathDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ userId?: string }>;
}) {
  const { id: pathId } = await params;
  const { userId: requestedUserId } = await searchParams;
  const actor = await requirePermission("training.view");

  const targetUserId = requestedUserId && requestedUserId !== actor.id ? requestedUserId : actor.id;
  if (targetUserId !== actor.id) {
    const allowed = await canViewUser(actor, targetUserId);
    if (!allowed) redirect("/paths");
  }

  const path = await prisma.learningPath.findUnique({ where: { id: pathId }, select: { title: true, description: true } });
  if (!path) notFound();

  const progress = await getPathProgress(actor, pathId, targetUserId).catch(() => null);
  if (!progress) notFound();

  const viewerTimezone = actor.timezone;

  return (
    <>
      <PageHeader
        title={path.title}
        description={path.description ?? undefined}
        crumbs={[{ label: "Learning Paths", href: "/paths" }, { label: path.title }]}
        meta={<Badge tone={progress.overallPercent >= 100 ? "success" : "navy"}>{progress.overallPercent}% complete</Badge>}
      />
      <PageBody>
        <ol className="relative flex flex-col gap-0 border-l-2 border-[var(--border-subtle)] pl-8">
          {progress.items.map((item, index) => {
            const done = item.status === "COMPLETED" || item.percent >= 100;
            const overdue = item.status === "OVERDUE";
            return (
              <li key={item.id} className="relative pb-8 last:pb-0">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[2.5rem] flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                    done
                      ? "border-success-500 bg-success-50 text-success-600"
                      : item.isMilestone
                        ? "border-[var(--brand-accent)] bg-[var(--surface-card)] text-[var(--brand-accent)]"
                        : "border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-muted)]"
                  }`}
                >
                  {done ? (
                    <Glyph name="check" className="h-3.5 w-3.5" />
                  ) : item.isMilestone ? (
                    <Icon name="skill" className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-current" />
                  )}
                </span>

                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        {item.label && (
                          <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            {item.label}
                          </span>
                        )}
                        {item.isMilestone && <Badge tone="accent">Milestone</Badge>}
                        {!item.required && <Badge tone="neutral">Optional</Badge>}
                      </div>
                      <p className="text-[0.9375rem] font-medium text-[var(--text-primary)]">
                        {item.targetType === "COURSE" && item.targetId ? (
                          <Link href={`/courses/${item.targetId}`} className="hover:underline">
                            {item.targetTitle}
                          </Link>
                        ) : (
                          item.targetTitle
                        )}
                      </p>
                      {item.dueAt && (
                        <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)]">
                          Due {formatInTimeZone(item.dueAt, viewerTimezone, "MMMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <Badge tone={overdue ? "danger" : STATUS_TONE[item.status] ?? "neutral"}>{item.status}</Badge>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      </PageBody>
    </>
  );
}
