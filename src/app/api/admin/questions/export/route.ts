import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";

/** Bulk JSON export of the question bank (admin-only; includes answer keys). */
export const GET = withErrorHandling(async (req) => {
  await requirePermission("MANAGE_QUESTIONS");
  const url = new URL(req.url);
  const construct = url.searchParams.get("construct") ?? undefined;

  const questions = await prisma.question.findMany({
    where: construct ? { construct: construct as never } : {},
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });

  const rows = questions.map((q) => {
    const v = q.versions[0];
    return {
      id: q.id,
      construct: q.construct,
      subtype: q.subtype,
      kind: q.kind,
      status: q.status,
      version: q.currentVersion,
      prompt: v?.prompt,
      choices: v?.choices,
      correctIndex: v?.correctIndex,
      difficulty: v?.difficulty,
      reverseCoded: v?.reverseCoded,
      explanation: v?.explanation,
    };
  });

  return new NextResponse(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="fsw-talentscout-questions${construct ? `-${construct}` : ""}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
