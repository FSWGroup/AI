import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope } from "@/app/api/v1/_lib/http";

/** GET /api/v1/people — the people directory. Never returns SensitiveField values. */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "people.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const status = url.searchParams.get("status");
  const departmentId = url.searchParams.get("departmentId");
  const email = url.searchParams.get("email");

  const where = {
    ...(status ? { status: status as "ACTIVE" | "INACTIVE" | "INVITED" } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(email ? { email: email.toLowerCase() } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip: page.skip,
      take: page.take,
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
      },
    }),
    prisma.user.count({ where }),
  ]);

  return listEnvelope(
    rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      employeeId: u.employeeId,
      title: u.title,
      status: u.status,
      workerType: u.workerType,
      country: u.country,
      startDate: u.startDate,
      manager: u.manager,
      department: u.department,
      businessUnit: u.businessUnit,
      location: u.location,
    })),
    page,
    total,
  );
}
