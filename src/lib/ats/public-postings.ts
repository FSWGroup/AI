import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PublicPosting } from "./postings";

/**
 * Roles that may appear publicly. Only OPEN requisitions: a draft, a paused
 * role, or one that has been filled must never be reachable from a feed or a
 * search-engine cache.
 */
export async function listPublicPostings(): Promise<PublicPosting[]> {
  const rows = await prisma.requisition.findMany({
    where: { status: "OPEN" },
    include: { department: true, location: true },
    orderBy: { openedAt: "desc" },
  });
  return rows.map(toPublicPosting);
}

export async function findPublicPosting(
  reference: string,
): Promise<PublicPosting | null> {
  const row = await prisma.requisition.findFirst({
    where: { reference, status: "OPEN" },
    include: { department: true, location: true },
  });
  return row ? toPublicPosting(row) : null;
}

type Row = Prisma.RequisitionGetPayload<{
  include: { department: true; location: true };
}>;

function toPublicPosting(r: Row): PublicPosting {
  return {
    reference: r.reference,
    title: r.title,
    summary: r.summary,
    description: r.description,
    responsibilities: r.responsibilities,
    requirements: r.requirements,
    benefits: r.benefits,
    departmentName: r.department?.name ?? null,
    locationName: r.location?.name ?? null,
    city: r.location?.city ?? null,
    region: r.location?.region ?? null,
    country: r.location?.country ?? "PH",
    postalCode: r.location?.postalCode ?? null,
    remote: r.location?.remote ?? false,
    employmentType: r.employmentType,
    workArrangement: r.workArrangement,
    salaryMin: r.salaryMin,
    salaryMax: r.salaryMax,
    salaryCurrency: r.salaryCurrency,
    salaryPeriod: r.salaryPeriod,
    salaryPublish: r.salaryPublish,
    openedAt: r.openedAt,
    updatedAt: r.updatedAt,
  };
}
