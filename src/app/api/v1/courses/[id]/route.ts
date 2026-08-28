import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "training.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const course = await prisma.course.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      difficulty: true,
      status: true,
      estimatedMinutes: true,
      passingScore: true,
      recertifyMonths: true,
      selfEnrollAllowed: true,
      currentVersion: { select: { versionNumber: true, publishedAt: true } },
      skills: { select: { skill: { select: { id: true, name: true } } } },
    },
  });
  if (!course) return notFound("Course");

  return itemEnvelope({
    ...course,
    currentVersionLabel: course.currentVersion?.versionNumber ?? null,
    publishedAt: course.currentVersion?.publishedAt ?? null,
    currentVersion: undefined,
    skills: course.skills.map((s) => s.skill),
  });
}
