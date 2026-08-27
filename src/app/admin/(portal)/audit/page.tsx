import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Card, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_AUDIT")) redirect("/admin");
  const { action, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const PAGE_SIZE = 50;

  const where = action ? { action: { contains: action } } : {};
  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeading
        title="Audit Log"
        description="Append-only record of consequential actions. The application has no code path to edit or delete audit events."
      />
      <form method="GET" className="mt-4 flex gap-3">
        <input
          type="search"
          name="action"
          defaultValue={action ?? ""}
          placeholder="Filter by action, e.g. recording."
          className="w-72 rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
          aria-label="Filter by action"
        />
        <button className="rounded-lg border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">
          Filter
        </button>
      </form>
      <Card className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {events.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-navy-500">
                  {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="px-4 py-3 text-navy-700">
                  {e.user?.name ?? e.actorLabel ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-navy-800">
                  {e.action}
                </td>
                <td className="px-4 py-3 text-xs text-navy-500">
                  {e.entityType}
                  {e.entityId ? ` · ${e.entityId.slice(0, 12)}…` : ""}
                </td>
                <td className="max-w-xs px-4 py-3 text-xs text-navy-500">
                  {e.previousValue != null && (
                    <p className="truncate">prev: {JSON.stringify(e.previousValue)}</p>
                  )}
                  {e.newValue != null && (
                    <p className="truncate">new: {JSON.stringify(e.newValue)}</p>
                  )}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-navy-400">
                  No audit events match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex justify-center gap-2 text-sm">
          {page > 1 && (
            <a className="rounded border border-navy-200 px-3 py-1.5 font-semibold text-navy-700" href={`?action=${action ?? ""}&page=${page - 1}`}>
              ← Prev
            </a>
          )}
          <span className="text-navy-400">Page {page} of {pages}</span>
          {page < pages && (
            <a className="rounded border border-navy-200 px-3 py-1.5 font-semibold text-navy-700" href={`?action=${action ?? ""}&page=${page + 1}`}>
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
