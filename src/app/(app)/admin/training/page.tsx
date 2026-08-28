import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { computeCourseHealth } from "@/lib/services/course";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { ImportCoursesForm } from "@/components/course/import-courses-form";
import { CourseRowActions } from "@/components/course/course-row-actions";

export const metadata: Metadata = { title: "Training Admin" };

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "navy"> = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  CHANGES_REQUESTED: "warning",
  APPROVED: "navy",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export default async function AdminTrainingPage() {
  const actor = await requirePermission("training.create");

  const courses = await prisma.course.findMany({
    where: { isDeleted: false },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, status: true, ownerId: true, updatedAt: true },
  });

  const ownerIds = [...new Set(courses.map((c) => c.ownerId).filter((id): id is string => Boolean(id)))];
  const courseIds = courses.map((c) => c.id);

  const [owners, assignmentCounts, completionCounts, healthScores] = await Promise.all([
    ownerIds.length
      ? prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    prisma.assignment.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    prisma.completionRecord.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    Promise.all(courseIds.map((id) => computeCourseHealth(id))),
  ]);

  const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));
  const enrolledByCourse = new Map(assignmentCounts.map((a) => [a.courseId, a._count._all]));
  const completedByCourse = new Map(completionCounts.map((c) => [c.courseId, c._count._all]));
  const healthByCourse = new Map(courseIds.map((id, i) => [id, healthScores[i]]));

  return (
    <>
      <PageHeader
        title="Training admin"
        description="Manage courses across the organization."
        actions={
          <>
            <Link href="/admin/ai-studio?type=course">
              <Button variant="outline">
                <Icon name="ai" className="h-4 w-4" />
                Build with AI
              </Button>
            </Link>
            <Link href="/admin/training/new">
              <Button>
                <Glyph name="plus" className="h-4 w-4" />
                New course
              </Button>
            </Link>
          </>
        }
      />
      <PageBody className="flex flex-col gap-6">
        <ImportCoursesForm />

        {courses.length === 0 ? (
          <EmptyState
            icon={<Icon name="training" className="h-5 w-5" />}
            title="No courses yet"
            description="Create your first course to get started."
            actions={
              <Link href="/admin/training/new">
                <Button size="sm">New course</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
            <table className="w-full text-left text-[0.8125rem]">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[0.75rem] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Course</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Owner</th>
                  <th scope="col" className="px-4 py-3 font-medium">Enrolled</th>
                  <th scope="col" className="px-4 py-3 font-medium">Completion rate</th>
                  <th scope="col" className="px-4 py-3 font-medium">Health</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => {
                  const enrolled = enrolledByCourse.get(course.id) ?? 0;
                  const completed = completedByCourse.get(course.id) ?? 0;
                  const rate = enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0;
                  const health = healthByCourse.get(course.id);
                  return (
                    <tr key={course.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/admin/training/${course.id}/edit`} className="font-medium text-[var(--text-primary)] hover:underline">
                          {course.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[course.status] ?? "neutral"}>{course.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {course.ownerId ? (ownerNameById.get(course.ownerId) ?? "—") : "—"}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{enrolled}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{enrolled > 0 ? `${rate}%` : "—"}</td>
                      <td className="px-4 py-3">
                        {health && (
                          <Badge tone={health.score >= 80 ? "success" : health.score >= 50 ? "warning" : "danger"}>
                            {health.score}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <CourseRowActions courseId={course.id} status={course.status} canArchive={actor.permissions.has("training.archive")} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}
