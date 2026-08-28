import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getPositionProfile } from "@/lib/services/org";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { PositionEditor } from "@/app/(app)/admin/organization/positions/[id]/position-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const position = await prisma.position.findUnique({ where: { id }, select: { title: true } });
  return { title: position ? position.title : "Position" };
}

export default async function PositionProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("org.manage");
  const { id } = await params;

  let position: Awaited<ReturnType<typeof getPositionProfile>>;
  try {
    position = await getPositionProfile(actor, id);
  } catch {
    notFound();
  }

  const [skills, skillLevels, courses, sops, paths] = await Promise.all([
    prisma.skill.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.skillLevel.findMany({ select: { value: true, name: true }, orderBy: { value: "asc" } }),
    prisma.course.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.sop.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.learningPath.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title={position.title}
        description={position.department ? `${position.department.name} · ${position.department.businessUnitName ?? ""}` : undefined}
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Organization", href: "/admin/organization" },
          { label: position.title },
        ]}
        meta={<Badge tone="neutral">{position.headcount} active holder{position.headcount === 1 ? "" : "s"}</Badge>}
      />
      <PageBody>
        <PositionEditor position={position} skills={skills} skillLevels={skillLevels} courses={courses} sops={sops} paths={paths} />
      </PageBody>
    </>
  );
}
