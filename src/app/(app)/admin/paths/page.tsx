import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Learning Paths Admin" };

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "navy"> = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  CHANGES_REQUESTED: "warning",
  APPROVED: "navy",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export default async function AdminPathsPage() {
  await requirePermission("path.create");

  const paths = await prisma.learningPath.findMany({
    where: { isDeleted: false },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { items: true, assignments: true } } },
  });

  const ownerIds = [...new Set(paths.map((p) => p.ownerId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));

  return (
    <>
      <PageHeader
        title="Learning paths admin"
        description="Sequenced training assigned across the organization."
        actions={
          <Link href="/admin/paths/new">
            <Button>
              <Glyph name="plus" className="h-4 w-4" />
              New path
            </Button>
          </Link>
        }
      />
      <PageBody>
        {paths.length === 0 ? (
          <EmptyState
            icon={<Icon name="path" className="h-5 w-5" />}
            title="No learning paths yet"
            description="Create your first path to sequence training over someone's first weeks or months."
            actions={
              <Link href="/admin/paths/new">
                <Button size="sm">New path</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
            <table className="w-full text-left text-[0.8125rem]">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[0.75rem] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Path</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Owner</th>
                  <th scope="col" className="px-4 py-3 font-medium">Items</th>
                  <th scope="col" className="px-4 py-3 font-medium">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {paths.map((path) => (
                  <tr key={path.id} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/admin/paths/${path.id}/edit`} className="font-medium text-[var(--text-primary)] hover:underline">
                        {path.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[path.status] ?? "neutral"}>{path.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {path.ownerId ? (ownerNameById.get(path.ownerId) ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{path._count.items}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{path._count.assignments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}
