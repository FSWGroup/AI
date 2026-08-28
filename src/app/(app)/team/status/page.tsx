import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getTrainingMatrix, type MatrixFilters } from "@/lib/services/matrix";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icons";
import { MatrixCellBadge } from "@/components/people/badges";
import { Pagination } from "@/components/people/pagination";
import { TeamStatusExportButton } from "@/app/(app)/team/status/team-status-export-button";

export const metadata = { title: "Team Training Status" };

type StatusSearchParams = {
  departmentId?: string;
  courseId?: string;
  page?: string;
};

export default async function TeamStatusPage({ searchParams }: { searchParams: Promise<StatusSearchParams> }) {
  const actor = await requirePermission("team.view");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const filters: MatrixFilters = {
    departmentId: params.departmentId || undefined,
    courseId: params.courseId || undefined,
  };

  const [matrix, departments, courses] = await Promise.all([
    getTrainingMatrix(actor, { rowMode: "people", filters, page }),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.course.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(matrix.total / matrix.pageSize));

  return (
    <>
      <PageHeader
        title="Team training status"
        description="Every required training item for your reporting line."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "Training Status" }]}
        actions={<TeamStatusExportButton filters={filters} />}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent>
            <form method="GET" action="/team/status" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
              <Field label="Department" htmlFor="ts-dept">
                <Select id="ts-dept" name="departmentId" defaultValue={params.departmentId ?? ""}>
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Training column" htmlFor="ts-course">
                <Select id="ts-course" name="courseId" defaultValue={params.courseId ?? ""}>
                  <option value="">All required training</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">Apply filters</Button>
            </form>
          </CardContent>
        </Card>

        {matrix.rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="status" className="h-5 w-5" />}
            title="Nothing to show"
            description="No one matches these filters, or there's no training required for your team yet."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="bg-[var(--surface-sunken)]">
                  <th scope="col" className="sticky left-0 z-10 min-w-[12rem] border-b border-r border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5 text-left">
                    Person
                  </th>
                  {matrix.columns.map((col) => (
                    <th key={col.key} scope="col" className="min-w-[9rem] border-b border-[var(--border-subtle)] p-2.5 text-left">
                      {col.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="sticky left-0 z-10 border-b border-r border-[var(--border-subtle)] bg-[var(--surface-card)] p-2.5">
                      <p className="font-medium text-[var(--text-primary)]">{row.label}</p>
                      {row.sublabel && <p className="text-[0.75rem] text-[var(--text-muted)]">{row.sublabel}</p>}
                    </td>
                    {matrix.columns.map((col) => (
                      <td key={col.key} className="border-b border-[var(--border-subtle)] p-2.5">
                        <MatrixCellBadge state={row.cells[col.key] ?? "NOT_REQUIRED"} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination basePath="/team/status" searchParams={params} page={matrix.page} totalPages={totalPages} total={matrix.total} />
      </PageBody>
    </>
  );
}
