import Link from "next/link";
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
import { MatrixExportButton } from "@/app/(app)/admin/compliance/matrix/matrix-export-button";

export const metadata = { title: "Training Requirements Matrix" };

type MatrixSearchParams = {
  rowMode?: string;
  departmentId?: string;
  managerId?: string;
  locationId?: string;
  country?: string;
  roleKey?: string;
  workerType?: string;
  courseId?: string;
  page?: string;
};

export default async function ComplianceMatrixPage({ searchParams }: { searchParams: Promise<MatrixSearchParams> }) {
  const actor = await requirePermission("reports.view");
  const params = await searchParams;
  const rowMode = params.rowMode === "positions" ? "positions" : "people";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const filters: MatrixFilters = {
    departmentId: params.departmentId || undefined,
    managerId: params.managerId || undefined,
    locationId: params.locationId || undefined,
    country: params.country || undefined,
    roleKey: params.roleKey || undefined,
    workerType: params.workerType || undefined,
    courseId: params.courseId || undefined,
  };

  const [matrix, departments, locations, roles, courses] = await Promise.all([
    getTrainingMatrix(actor, { rowMode, filters, page }),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ select: { key: true, name: true }, orderBy: { name: "asc" } }),
    prisma.course.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(matrix.total / matrix.pageSize));

  return (
    <>
      <PageHeader
        title="Training requirements matrix"
        description="Required training as columns, people or positions as rows."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Compliance", href: "/admin/compliance" },
          { label: "Matrix" },
        ]}
        actions={<MatrixExportButton rowMode={rowMode} filters={filters} />}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              {(["people", "positions"] as const).map((mode) => (
                <Link key={mode} href={`/admin/compliance/matrix?rowMode=${mode}`}>
                  <Button variant={rowMode === mode ? "primary" : "outline"} size="sm">
                    {mode === "people" ? "By person" : "By position"}
                  </Button>
                </Link>
              ))}
            </div>
            <form method="GET" action="/admin/compliance/matrix" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <input type="hidden" name="rowMode" value={rowMode} />
              <Field label="Department" htmlFor="matrix-dept">
                <Select id="matrix-dept" name="departmentId" defaultValue={params.departmentId ?? ""}>
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location" htmlFor="matrix-loc">
                <Select id="matrix-loc" name="locationId" defaultValue={params.locationId ?? ""}>
                  <option value="">All</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Country" htmlFor="matrix-country">
                <Select id="matrix-country" name="country" defaultValue={params.country ?? ""}>
                  <option value="">All</option>
                  <option value="US">US</option>
                  <option value="PH">PH</option>
                </Select>
              </Field>
              <Field label="Worker type" htmlFor="matrix-wt">
                <Select id="matrix-wt" name="workerType" defaultValue={params.workerType ?? ""}>
                  <option value="">All</option>
                  <option value="US_EMPLOYEE">US Employee</option>
                  <option value="US_CONTRACTOR">US Contractor</option>
                  <option value="PH_EMPLOYEE">PH Employee</option>
                  <option value="PH_CONTRACTOR">PH Contractor</option>
                  <option value="INTL_EMPLOYEE">Intl Employee</option>
                  <option value="INTL_CONTRACTOR">Intl Contractor</option>
                </Select>
              </Field>
              <Field label="Role" htmlFor="matrix-role">
                <Select id="matrix-role" name="roleKey" defaultValue={params.roleKey ?? ""}>
                  <option value="">All</option>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Course column" htmlFor="matrix-course">
                <Select id="matrix-course" name="courseId" defaultValue={params.courseId ?? ""}>
                  <option value="">All required training</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2 lg:col-span-6">
                <Button type="submit">Apply filters</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {matrix.rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="matrix" className="h-5 w-5" />}
            title="No rows match those filters"
            description="Try broadening a filter, or check that training requirements are configured for this population."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="bg-[var(--surface-sunken)]">
                  <th scope="col" className="sticky left-0 z-10 min-w-[12rem] border-b border-r border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5 text-left">
                    {rowMode === "people" ? "Person" : "Position"}
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

        <Pagination basePath="/admin/compliance/matrix" searchParams={{ ...params, rowMode }} page={matrix.page} totalPages={totalPages} total={matrix.total} />
      </PageBody>
    </>
  );
}
