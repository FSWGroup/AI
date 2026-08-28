import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getPathProgress } from "@/lib/services/path";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Learning Paths" };

export default async function PathsPage() {
  const actor = await requirePermission("training.view");

  const assignments = await prisma.assignment.findMany({
    where: { userId: actor.id, targetType: "LEARNING_PATH" },
    orderBy: { assignedAt: "desc" },
    select: { pathId: true, reason: true, status: true, path: { select: { id: true, title: true, description: true } } },
  });

  const paths = await Promise.all(
    assignments
      .filter((a) => a.path)
      .map(async (a) => ({
        assignment: a,
        progress: await getPathProgress(actor, a.pathId as string, actor.id),
      })),
  );

  return (
    <>
      <PageHeader title="Learning paths" description="Multi-step training sequences assigned to you, in order." />
      <PageBody>
        {paths.length === 0 ? (
          <EmptyState
            icon={<Icon name="path" className="h-5 w-5" />}
            title="No learning paths assigned"
            description="When you're assigned a learning path, it will appear here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {paths.map(({ assignment, progress }) => (
              <Link key={assignment.pathId} href={`/paths/${assignment.pathId}`}>
                <Card className="h-full transition-colors hover:border-[var(--brand-secondary)]">
                  <CardHeader>
                    <CardTitle>{assignment.path?.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {assignment.path?.description && (
                      <p className="line-clamp-2 text-[0.8125rem] text-[var(--text-secondary)]">{assignment.path.description}</p>
                    )}
                    <ProgressBar
                      value={progress.overallPercent}
                      label={`${progress.overallPercent}% complete`}
                      tone={progress.overallPercent >= 100 ? "success" : "brand"}
                    />
                    <p className="text-[0.75rem] text-[var(--text-muted)]">{progress.items.length} items</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
