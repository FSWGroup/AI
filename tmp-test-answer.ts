import { createRequire } from "module";
const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeModule;

async function run() {
  const { prisma } = require("/home/user/AI/src/lib/db");
  const { answerQuestion } = require("/home/user/AI/src/lib/ai/rag");
  const admin = await prisma.user.findUnique({
    where: { id: "user_super_admin" },
    select: {
      id: true, email: true, name: true, image: true, status: true, timezone: true, language: true,
      businessUnitId: true, departmentId: true, teamId: true, positionId: true, locationId: true,
      managerId: true, workerType: true, country: true,
      roles: { select: { role: { select: { key: true, permissions: { select: { permission: true } } } } } },
    },
  });
  const permissions = new Set<string>();
  const roleKeys: string[] = [];
  for (const { role } of admin.roles) {
    roleKeys.push(role.key);
    for (const { permission } of role.permissions) permissions.add(permission);
  }
  const actor = { ...admin, permissions, roleKeys };
  try {
    const res = await answerQuestion(actor, "How do I create a customer quote?");
    console.log("UNEXPECTED SUCCESS", res);
  } catch (e: any) {
    console.log("Expected error:", e.name, "-", e.message);
  }
  await prisma.$disconnect();
}
run();
