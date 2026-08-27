import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SectionHeading } from "@/components/ui";
import { BenchmarkEditor } from "@/components/admin/BenchmarkEditor";

export const dynamic = "force-dynamic";

export default async function JobProfilePage({
  params,
}: {
  params: Promise<{ jobProfileId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const { jobProfileId } = await params;

  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
    include: {
      benchmarks: true,
      concernRules: true,
      openings: true,
    },
  });
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeading
        eyebrow="Job profile"
        title={profile.name}
        description={
          profile.description ??
          "Configure the desired 1-9 range for each dimension. Above-range is not automatically better."
        }
      />
      <BenchmarkEditor
        jobProfileId={profile.id}
        readOnly={!can(user.role, "MANAGE_BENCHMARKS")}
        initialBenchmarks={profile.benchmarks.map((b) => ({
          construct: b.construct,
          minScore: b.minScore,
          maxScore: b.maxScore,
          required: b.required,
          enabled: b.enabled,
          weight: b.weight,
          note: b.note,
        }))}
        initialConcernRules={profile.concernRules.map((r) => ({
          construct: r.construct,
          maxBand: r.maxBand,
          enabled: r.enabled,
        }))}
      />
    </div>
  );
}
