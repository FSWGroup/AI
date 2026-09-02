import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { HireRowActions } from "@/components/admin/HireRowActions";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  ACTIVE: "green",
  ON_LEAVE: "amber",
  DEPARTED_VOLUNTARY: "neutral",
  DEPARTED_INVOLUNTARY: "neutral",
} as const;

const PAGE_SIZE = 100;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Currently employed" },
  { key: "departed", label: "Departed" },
  { key: "unlinked", label: "No assessment linked" },
  { key: "unreviewed", label: "No review yet" },
] as const;

function whereFor(filter: string): Prisma.HireWhereInput {
  switch (filter) {
    case "active":
      return { status: { in: ["ACTIVE", "ON_LEAVE"] } };
    case "departed":
      return { status: { in: ["DEPARTED_VOLUNTARY", "DEPARTED_INVOLUNTARY"] } };
    case "unlinked":
      return { attemptId: null };
    case "unreviewed":
      return { reviews: { none: { status: "SUBMITTED" } } };
    default:
      return {};
  }
}

export default async function HiresPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "MANAGE_HIRES")) redirect("/admin");
  const { filter: rawFilter } = await searchParams;
  const filter = FILTERS.some((f) => f.key === rawFilter) ? (rawFilter as string) : "all";
  const where = whereFor(filter);

  const [hires, matching, managers] = await Promise.all([
    prisma.hire.findMany({
      where,
      include: {
        candidate: true,
        jobProfile: { select: { name: true } },
        manager: { select: { id: true, name: true } },
        _count: { select: { reviews: true } },
      },
      orderBy: { hiredAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.hire.count({ where }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["HIRING_MANAGER", "HR_ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const unlinked = await prisma.hire.count({ where: { attemptId: null } });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/validation" className="text-sm text-fsw-700 hover:underline">
        ← Validation
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow="Validation"
          title="Employment records"
          description="One row per person hired. The record links a candidate to the assessment attempt their scores came from, and to the manager who will rate their work."
        />
      </div>

      {unlinked > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {unlinked} of these have no assessment attempt linked, so they cannot
          appear in a study. That is correct for anyone hired without taking the
          assessment; if they did take it, link the attempt so their scores
          count.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/admin/validation/hires" : `/admin/validation/hires?filter=${f.key}`}
            className={
              filter === f.key
                ? "rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white"
                : "rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50"
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card className="mt-4 overflow-x-auto">
        {hires.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            No employment records yet. One is created automatically whenever a
            candidate accepts an offer.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Hired</th>
                <th className="px-4 py-3">Manager</th>
                <th className="px-4 py-3">Assessment</th>
                <th className="px-4 py-3">Reviews</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {hires.map((h) => (
                <tr key={h.id} className="border-b border-navy-50 last:border-0">
                  <td className="px-4 py-3 font-semibold text-navy-900">
                    {h.candidate.firstName} {h.candidate.lastName}
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {h.jobTitle}
                    {h.jobProfile && (
                      <span className="block text-xs text-navy-400">{h.jobProfile.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {h.hiredAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-navy-600">{h.manager?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {h.attemptId ? (
                      <Badge tone="blue">Linked</Badge>
                    ) : (
                      <span className="text-xs text-navy-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-600">{h._count.reviews}</td>
                  <td className="relative px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[h.status]}>
                        {h.status.replaceAll("_", " ").toLowerCase()}
                      </Badge>
                      <HireRowActions
                        hireId={h.id}
                        status={h.status}
                        managerId={h.managerId}
                        managers={managers}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {matching > hires.length && (
        <p className="mt-3 text-sm text-navy-500">
          Showing the {hires.length} most recent of {matching}. Narrow the list
          with a filter above.
        </p>
      )}
    </div>
  );
}
