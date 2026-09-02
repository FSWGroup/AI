import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { NewWorkSampleForm } from "@/components/admin/NewWorkSampleForm";

export const dynamic = "force-dynamic";

export default async function WorkSamplesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const canManage = can(user.role, "MANAGE_WORK_SAMPLES");
  const canGrade = can(user.role, "GRADE_WORK_SAMPLES");
  if (!canManage && !canGrade) redirect("/admin");

  const [samples, queue, jobProfiles] = await Promise.all([
    prisma.workSample.findMany({
      include: {
        jobProfile: { select: { name: true } },
        criteria: { select: { id: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    canGrade
      ? prisma.workSampleAssignment.findMany({
          where: {
            status: { in: ["SUBMITTED", "GRADED"] },
            grades: { none: { graderId: user.id, status: "SUBMITTED" } },
          },
          include: {
            workSample: { select: { title: true, requiredGraders: true } },
            _count: { select: { grades: true } },
          },
          orderBy: { submittedAt: "asc" },
          take: 50,
        })
      : Promise.resolve([]),
    prisma.jobProfile.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeading
        eyebrow="Interviewing"
        title="Work samples"
        description="A candidate does a piece of the actual job, and more than one person grades it against a rubric written before anyone saw the work."
      />

      {canGrade && (
        <>
          <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
            Waiting for your grade
          </h3>
          <Card className="mt-3">
            {queue.length === 0 ? (
              <p className="p-4 text-sm text-navy-500">
                Nothing is waiting on you.
              </p>
            ) : (
              <ul className="divide-y divide-navy-50">
                {queue.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-mono text-sm font-semibold text-navy-900">
                        {a.reference}
                      </p>
                      <p className="text-sm text-navy-500">
                        {a.workSample.title} · submitted{" "}
                        {a.submittedAt?.toISOString().slice(0, 10)} ·{" "}
                        {a._count.grades} of {a.workSample.requiredGraders} graders
                      </p>
                    </div>
                    <Link
                      href={`/admin/work-samples/grade/${a.id}`}
                      className="rounded-lg bg-fsw-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fsw-700"
                    >
                      Grade
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-navy-100 p-4 text-xs text-navy-500">
              Submissions are identified by reference only. You will not see
              whose work you are grading, and you will not see any other
              grader&apos;s view until you have filed your own.
            </p>
          </Card>
        </>
      )}

      <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-navy-500">
        Tasks
      </h3>
      <Card className="mt-3 overflow-x-auto">
        {samples.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            No work samples yet. A work sample is a slice of the real job, small
            enough to be fair to ask for unpaid — an hour or two, not a weekend.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Rubric</th>
                <th className="px-4 py-3">Graders</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id} className="border-b border-navy-50 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/work-samples/${s.id}`}
                      className="font-semibold text-fsw-700 hover:underline"
                    >
                      {s.title}
                    </Link>
                    <span className="block text-xs text-navy-400">
                      {s.timeLimitMinutes
                        ? `${s.timeLimitMinutes} minutes`
                        : "Untimed"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {s.jobProfile?.name ?? "Any"}
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {s.criteria.length} criteria
                  </td>
                  <td className="px-4 py-3 text-navy-600">{s.requiredGraders}</td>
                  <td className="px-4 py-3 text-navy-600">{s._count.assignments}</td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        s.status === "ACTIVE"
                          ? "green"
                          : s.status === "DRAFT"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {s.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canManage && (
        <div className="mt-6">
          <NewWorkSampleForm jobProfiles={jobProfiles} />
        </div>
      )}
    </div>
  );
}
