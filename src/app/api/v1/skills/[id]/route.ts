import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "skills.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return notFound("Skill");

  return itemEnvelope(skill);
}
