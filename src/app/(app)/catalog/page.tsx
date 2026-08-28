import Link from "next/link";
import type { Metadata } from "next";
import { Difficulty, LessonType } from "@prisma/client";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getCatalog, type CatalogFilters } from "@/lib/services/course";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/icons";
import { formatMinutes } from "@/lib/utils";
import { LESSON_TYPE_LABEL } from "@/components/lesson/lesson-type-label";
import { SelfEnrollButton } from "@/components/course/self-enroll-button";

export const metadata: Metadata = { title: "Catalog" };

const DIFFICULTY_LABEL: Record<string, string> = {
  INTRO: "Intro",
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};
const DURATION_LABEL: Record<string, string> = {
  under_15: "Under 15 min",
  "15_30": "15–30 min",
  "30_60": "30–60 min",
  over_60: "Over an hour",
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission("training.view");
  const sp = await searchParams;

  const filters: CatalogFilters = {
    search: firstParam(sp.q) || undefined,
    departmentId: firstParam(sp.department) || undefined,
    category: firstParam(sp.category) || undefined,
    skillId: firstParam(sp.skill) || undefined,
    difficulty: (firstParam(sp.difficulty) as Difficulty | undefined) || undefined,
    format: (firstParam(sp.format) as LessonType | undefined) || undefined,
    duration: (firstParam(sp.duration) as CatalogFilters["duration"]) || undefined,
    requirement: (firstParam(sp.requirement) as CatalogFilters["requirement"]) || "all",
    page: Number(firstParam(sp.page) ?? "1") || 1,
    pageSize: 18,
  };

  const [{ items, total, page, pageSize }, departments, categories, skills] = await Promise.all([
    getCatalog(actor, filters),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.course.findMany({
      where: { status: "PUBLISHED", isDeleted: false, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    }),
    prisma.skill.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...overrides } as Record<string, string | number | undefined>;
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== "" && key !== "page") params.set(key, String(value));
    }
    if (overrides.page) params.set("page", String(overrides.page));
    return `/catalog?${params.toString()}`;
  };

  return (
    <>
      <PageHeader title="Course catalog" description="Browse every published course. Filter to find what applies to you." />
      <PageBody className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <form method="GET" className="flex flex-col gap-4">
          <Field label="Search" htmlFor="q">
            <Input id="q" name="q" defaultValue={filters.search ?? ""} placeholder="Course title or description" />
          </Field>
          <Field label="Department" htmlFor="department">
            <Select id="department" name="department" defaultValue={filters.departmentId ?? ""}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" name="category" defaultValue={filters.category ?? ""}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category ?? ""}>
                  {c.category}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Skill" htmlFor="skill">
            <Select id="skill" name="skill" defaultValue={filters.skillId ?? ""}>
              <option value="">Any skill</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Difficulty" htmlFor="difficulty">
            <Select id="difficulty" name="difficulty" defaultValue={filters.difficulty ?? ""}>
              <option value="">Any difficulty</option>
              {Object.values(Difficulty).map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format" htmlFor="format" hint="Courses containing this lesson type">
            <Select id="format" name="format" defaultValue={filters.format ?? ""}>
              <option value="">Any format</option>
              {Object.values(LessonType).map((t) => (
                <option key={t} value={t}>
                  {LESSON_TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duration" htmlFor="duration">
            <Select id="duration" name="duration" defaultValue={filters.duration ?? ""}>
              <option value="">Any duration</option>
              {Object.entries(DURATION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Requirement" htmlFor="requirement">
            <Select id="requirement" name="requirement" defaultValue={filters.requirement ?? "all"}>
              <option value="all">Required and optional</option>
              <option value="required">Required for me</option>
              <option value="optional">Optional</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Apply filters
            </Button>
            <Link href="/catalog">
              <Button type="button" variant="ghost" size="sm">
                Clear
              </Button>
            </Link>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            {total} course{total === 1 ? "" : "s"}
          </p>

          {items.length === 0 ? (
            <EmptyState
              icon={<Icon name="knowledge" className="h-5 w-5" />}
              title="No courses match these filters"
              description="Try clearing a filter or searching a different term."
              actions={
                <Link href="/catalog">
                  <Button variant="outline" size="sm">
                    Clear filters
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((course) => (
                <Card key={course.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="truncate">{course.title}</CardTitle>
                      {course.isRequired && <Badge tone="navy">Required</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-2">
                    {course.description && (
                      <p className="line-clamp-3 text-[0.8125rem] text-[var(--text-secondary)]">{course.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{DIFFICULTY_LABEL[course.difficulty] ?? course.difficulty}</Badge>
                      <span className="text-[0.75rem] text-[var(--text-muted)]">{formatMinutes(course.estimatedMinutes)}</span>
                    </div>
                    {course.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {course.skills.slice(0, 3).map((skill) => (
                          <Badge key={skill} tone="blue">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="justify-between">
                    {course.assignment ? (
                      <Link href={`/courses/${course.id}`}>
                        <Button size="sm" variant="outline">
                          {course.overallPercent > 0 ? `${course.overallPercent}% complete` : "View"}
                        </Button>
                      </Link>
                    ) : course.selfEnrollAllowed ? (
                      <SelfEnrollButton courseId={course.id} />
                    ) : (
                      <Link href={`/courses/${course.id}`}>
                        <Button size="sm" variant="ghost">
                          View details
                        </Button>
                      </Link>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Link href={qs({ page: Math.max(1, page - 1) })} aria-disabled={page <= 1}>
                <Button variant="outline" size="sm" disabled={page <= 1}>
                  Previous
                </Button>
              </Link>
              <span className="text-[0.8125rem] text-[var(--text-muted)]">
                Page {page} of {totalPages}
              </span>
              <Link href={qs({ page: Math.min(totalPages, page + 1) })} aria-disabled={page >= totalPages}>
                <Button variant="outline" size="sm" disabled={page >= totalPages}>
                  Next
                </Button>
              </Link>
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}
