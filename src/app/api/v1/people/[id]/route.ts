import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "people.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      employeeId: true,
      title: true,
      status: true,
      workerType: true,
      country: true,
      startDate: true,
      manager: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      position: { select: { id: true, title: true } },
    },
  });
  if (!user) return notFound("Person");

  return itemEnvelope(user);
}
