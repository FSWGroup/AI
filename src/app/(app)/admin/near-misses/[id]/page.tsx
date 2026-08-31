import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import {
  checkNearMissNarrative,
  getNearMissForReview,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
} from "@/lib/services/near-miss";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  NearMissReviewForm,
  type NearMissReviewValue,
} from "@/app/(app)/admin/near-misses/[id]/review-form";
import { SEVERITY_TONE } from "@/app/(app)/near-misses/severity";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const nearMiss = await prisma.nearMiss.findUnique({
    where: { id },
    select: { reference: true },
  });
  return { title: nearMiss ? `Review ${nearMiss.reference}` : "Review Near Miss" };
}

/** Render a Date as the yyyy-mm-dd an <input type="date"> expects. */
function toDateInput(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export default async function ReviewNearMissPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePermission("nearmiss.review");
  const { id } = await params;

  const nearMiss = await getNearMissForReview(actor, id);
  if (!nearMiss) notFound();

  const [departments, locations, sops, courses, findings] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.sop.findMany({
      where: { status: "PUBLISHED", isDeleted: false },
      select: { id: true, sopCode: true, title: true },
      orderBy: { sopCode: "asc" },
      take: 300,
    }),
    prisma.course.findMany({
      where: { status: "PUBLISHED", isDeleted: false },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 300,
    }),
    checkNearMissNarrative(actor, nearMiss),
  ]);

  const initial: NearMissReviewValue = {
    id: nearMiss.id,
    reference: nearMiss.reference,
    status: nearMiss.status,
    title: nearMiss.title,
    category: nearMiss.category,
    severity: nearMiss.severity,
    whatHappened: nearMiss.whatHappened,
    howItWasCaught: nearMiss.howItWasCaught ?? "",
    whyItHappened: nearMiss.whyItHappened ?? "",
    whatChanged: nearMiss.whatChanged ?? "",
    occurredOn: toDateInput(nearMiss.occurredOn),
    departmentId: nearMiss.departmentId ?? "",
    businessUnitId: nearMiss.businessUnitId ?? "",
    locationId: nearMiss.locationId ?? "",
    preventingSopId: nearMiss.preventingSopId ?? "",
    teachingCourseId: nearMiss.teachingCourseId ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Review ${nearMiss.reference}`}
        description="Everything here is editable. What is published is your version, not the reporter's — their job was to tell you it happened."
        crumbs={[
          { label: "Home", href: "/home" },
          { label: "Admin" },
          { label: "Near Misses", href: "/admin/near-misses" },
          { label: nearMiss.reference },
        ]}
        meta={
          <>
            <Badge tone={nearMiss.status === "PUBLISHED" ? "success" : "info"}>
              {STATUS_LABELS[nearMiss.status]}
            </Badge>
            <Badge tone={SEVERITY_TONE[nearMiss.severity]}>
              {SEVERITY_LABELS[nearMiss.severity]}
            </Badge>
            <Badge tone="neutral">{CATEGORY_LABELS[nearMiss.category]}</Badge>
            <Badge tone="neutral">
              Filed {nearMiss.createdAt.toLocaleDateString()}
            </Badge>
            {nearMiss.publishedBy && (
              <Badge tone="neutral">Published by {nearMiss.publishedBy.name}</Badge>
            )}
          </>
        }
      />
      <PageBody>
        <NearMissReviewForm
          initial={initial}
          departments={departments}
          locations={locations}
          sops={sops.map((sop) => ({ id: sop.id, label: `${sop.sopCode} — ${sop.title}` }))}
          courses={courses.map((course) => ({ id: course.id, label: course.title }))}
          reporterName={nearMiss.reportedBy?.name ?? null}
          initialFindings={findings}
        />
      </PageBody>
    </>
  );
}
