import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { NewJobForm } from "@/components/admin/NewJobForm";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const canManage = can(user.role, "MANAGE_BENCHMARKS");

  const profiles = await prisma.jobProfile.findMany({
    include: {
      benchmarks: { where: { enabled: true } },
      openings: true,
      _count: { select: { openings: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeading
        title="Job Profiles"
        description="Each profile defines the desired 1-9 range for every relevant dimension. There is no universal benchmark — every job gets its own."
      />
      <div className="mt-5 space-y-4">
        {profiles.map((p) => (
          <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <Link
                href={`/admin/jobs/${p.id}`}
                className="text-base font-bold text-fsw-700 hover:underline"
              >
                {p.name}
              </Link>
              <p className="mt-0.5 text-sm text-navy-500">
                {p.benchmarks.length} benchmarked dimensions ·{" "}
                {p._count.openings} opening{p._count.openings === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex gap-2">
              {p.isSalesRole && <Badge tone="blue">Sales analysis</Badge>}
              {p.leadershipModuleEnabled && <Badge tone="navy">Leadership</Badge>}
              {!p.active && <Badge tone="neutral">Inactive</Badge>}
            </div>
          </Card>
        ))}
        {profiles.length === 0 && (
          <Card className="p-8 text-center text-sm text-navy-400">
            No job profiles yet.
          </Card>
        )}
      </div>
      {canManage && <NewJobForm />}
    </div>
  );
}
