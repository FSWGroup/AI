import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { PathBuilder } from "@/components/course/path-builder";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const path = await prisma.learningPath.findUnique({ where: { id }, select: { title: true } });
  return { title: path ? `Edit · ${path.title}` : "Edit learning path" };
}

export default async function EditPathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: pathId } = await params;
  await requirePermission("path.create");

  const path = await prisma.learningPath.findUnique({
    where: { id: pathId },
    include: {
      items: {
        orderBy: { order: "asc" },
        include: { course: { select: { title: true } } },
      },
    },
  });
  if (!path) notFound();

  const sopIds = path.items.map((i) => i.sopId).filter((id): id is string => Boolean(id));
  const sops = sopIds.length
    ? await prisma.sop.findMany({ where: { id: { in: sopIds } }, select: { id: true, title: true, sopCode: true } })
    : [];
  const sopById = new Map(sops.map((s) => [s.id, s]));

  const builderPath = {
    id: path.id,
    title: path.title,
    description: path.description,
    status: path.status,
    items: path.items.map((item) => ({
      id: item.id,
      order: item.order,
      label: item.label,
      targetType: item.targetType,
      courseId: item.courseId,
      sopId: item.sopId,
      required: item.required,
      isMilestone: item.isMilestone,
      dueDaysAfterStart: item.dueDaysAfterStart,
      targetTitle: item.course?.title ?? (item.sopId ? (sopById.get(item.sopId)?.title ?? "Unknown SOP") : "Untitled"),
    })),
  };

  return (
    <>
      <PageHeader
        title={path.title}
        description="Learning path builder"
        crumbs={[{ label: "Learning paths admin", href: "/admin/paths" }, { label: path.title }]}
      />
      <PageBody>
        <PathBuilder path={builderPath} />
      </PageBody>
    </>
  );
}
