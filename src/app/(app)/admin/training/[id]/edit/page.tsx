import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { CourseBuilder } from "@/components/course/course-builder";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { title: true } });
  return { title: course ? `Edit · ${course.title}` : "Edit course" };
}

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await params;
  await requirePermission("training.create");

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: { questions: { orderBy: { order: "asc" } } },
          },
        },
      },
      skills: { include: { skill: true } },
    },
  });
  if (!course) notFound();

  const departments = await prisma.department.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title={course.title}
        description="Course builder"
        crumbs={[{ label: "Training admin", href: "/admin/training" }, { label: course.title }]}
      />
      <PageBody>
        <CourseBuilder
          course={JSON.parse(JSON.stringify(course))}
          departments={departments}
        />
      </PageBody>
    </>
  );
}
