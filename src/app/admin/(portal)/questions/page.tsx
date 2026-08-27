import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { QuestionRowActions } from "@/components/admin/QuestionRowActions";

export const dynamic = "force-dynamic";

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ construct?: string; status?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "MANAGE_QUESTIONS")) redirect("/admin");
  const { construct, status, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const PAGE_SIZE = 25;

  const where = {
    ...(construct ? { construct: construct as never } : {}),
    ...(status ? { status: status as never } : {}),
  };
  const [questions, total, byConstruct] = await Promise.all([
    prisma.question.findMany({
      where,
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: [{ construct: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.question.count({ where }),
    prisma.question.groupBy({ by: ["construct"], _count: true }),
  ]);

  const constructs = byConstruct.map((c) => c.construct).sort();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Question Bank"
          description={`${total} questions in view. Only approved questions appear on production forms. Workflow: Draft → Review → Approved → Retired.`}
        />
        <a
          href={`/api/admin/questions/export${construct ? `?construct=${construct}` : ""}`}
          className="rounded-lg border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50"
        >
          Export JSON
        </a>
      </div>

      <form method="GET" className="mt-5 flex flex-wrap gap-3">
        <select
          name="construct"
          defaultValue={construct ?? ""}
          className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
          aria-label="Filter by construct"
        >
          <option value="">All constructs</option>
          {constructs.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="REVIEW">Review</option>
          <option value="APPROVED">Approved</option>
          <option value="RETIRED">Retired</option>
        </select>
        <button className="rounded-lg border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">
          Filter
        </button>
      </form>

      <div className="mt-5 space-y-3">
        {questions.map((q) => {
          const v = q.versions[0];
          return (
            <Card key={q.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="navy">{q.construct}</Badge>
                    <Badge tone="neutral">{q.subtype}</Badge>
                    <Badge
                      tone={
                        q.status === "APPROVED"
                          ? "green"
                          : q.status === "REVIEW"
                            ? "amber"
                            : q.status === "RETIRED"
                              ? "red"
                              : "neutral"
                      }
                    >
                      {q.status}
                    </Badge>
                    <span className="text-xs text-navy-400">
                      v{q.currentVersion} · difficulty {v?.difficulty}
                      {v?.reverseCoded ? " · reverse-coded" : ""}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-navy-800">
                    {v?.prompt}
                  </p>
                  {v?.choices != null && (
                    <p className="mt-1 line-clamp-1 text-xs text-navy-400">
                      {(v.choices as string[])
                        .map((c, i) =>
                          i === v.correctIndex ? `✓ ${c}` : c,
                        )
                        .join("  ·  ")}
                    </p>
                  )}
                </div>
                <QuestionRowActions questionId={q.id} status={q.status} />
              </div>
            </Card>
          );
        })}
        {questions.length === 0 && (
          <Card className="p-8 text-center text-sm text-navy-400">
            No questions match this filter.
          </Card>
        )}
      </div>

      {pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <a
              className="rounded border border-navy-200 px-3 py-1.5 font-semibold text-navy-700"
              href={`?construct=${construct ?? ""}&status=${status ?? ""}&page=${page - 1}`}
            >
              ← Prev
            </a>
          )}
          <span className="text-navy-400">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <a
              className="rounded border border-navy-200 px-3 py-1.5 font-semibold text-navy-700"
              href={`?construct=${construct ?? ""}&status=${status ?? ""}&page=${page + 1}`}
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
