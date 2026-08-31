import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getCourseForLearner } from "@/lib/services/course";
import { getNearMissesForCourse, SEVERITY_LABELS } from "@/lib/services/near-miss";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Glyph, Icon } from "@/components/icons";
import { formatMinutes } from "@/lib/utils";
import { LESSON_TYPE_LABEL } from "@/components/lesson/lesson-type-label";
import { SelfEnrollButton } from "@/components/course/self-enroll-button";
import { selfEnrollAction } from "@/lib/actions/course-enrollment";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { title: true } });
  return { title: course?.title ?? "Course" };
}

const DIFFICULTY_LABEL: Record<string, string> = {
  INTRO: "Intro",
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export default async function CourseOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await params;
  const actor = await requirePermission("training.view");

  const data = await getCourseForLearner(actor, courseId).catch(() => null);
  if (!data) notFound();

  // [] rather than an error for a reader without nearmiss.view.
  const nearMisses = await getNearMissesForCourse(actor, courseId);

  const { course, assignment, prerequisites, blocked, overallPercent, nextLessonId, certificate } = data;
  const started = course.sections.some((s) => s.lessons.some((l) => l.progress && l.progress.status !== "NOT_STARTED"));
  const firstLessonId = course.sections[0]?.lessons[0]?.id ?? null;
  const startHref = nextLessonId
    ? `/courses/${courseId}/lessons/${nextLessonId}`
    : firstLessonId
      ? `/courses/${courseId}/lessons/${firstLessonId}`
      : null;
  const canSelfEnrollHere = !assignment && course.selfEnrollAllowed;

  return (
    <>
      <PageHeader
        title={course.title}
        description={course.description ?? undefined}
        crumbs={[{ label: "Catalog", href: "/catalog" }, { label: course.title }]}
        meta={
          <>
            <Badge tone="navy">{DIFFICULTY_LABEL[course.difficulty] ?? course.difficulty}</Badge>
            {course.category && <Badge tone="neutral">{course.category}</Badge>}
            <span className="text-[0.8125rem] text-[var(--text-muted)]">{formatMinutes(course.estimatedMinutes)}</span>
          </>
        }
        actions={
          blocked ? (
            <Button disabled title="Complete the prerequisites first">
              Locked
            </Button>
          ) : canSelfEnrollHere ? (
            <SelfEnrollButton courseId={courseId} action={selfEnrollAction} />
          ) : startHref ? (
            <Link href={startHref}>
              <Button size="lg">
                <Glyph name="play" className="h-4 w-4" />
                {started ? "Continue" : "Start"}
              </Button>
            </Link>
          ) : null
        }
      />

      <PageBody className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          {!blocked && assignment?.reason && (
            <Card>
              <CardContent className="flex items-start gap-3 py-4">
                <Icon name="assignment" className="mt-0.5 h-5 w-5 text-[var(--text-muted)]" />
                <div>
                  <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">Why you were assigned this</p>
                  <p className="text-[0.8125rem] text-[var(--text-secondary)]">{assignment.reason}</p>
                  {assignment.dueAt && (
                    <p className="mt-1 text-[0.75rem] text-[var(--text-muted)]">
                      Due {formatInTimeZone(assignment.dueAt, actor.timezone, "MMMM d, yyyy")}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {prerequisites.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Prerequisites</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {prerequisites.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-[0.875rem]">
                    <span className="text-[var(--text-primary)]">{p.title}</span>
                    <Badge tone={p.met ? "success" : "warning"}>{p.met ? "Complete" : "Not yet complete"}</Badge>
                  </div>
                ))}
                {blocked && (
                  <p className="mt-1 text-[0.8125rem] text-[var(--text-muted)]">
                    Complete every prerequisite above to unlock this course.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {course.skills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>What you&apos;ll learn</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {course.skills.map((skill) => (
                  <Badge key={skill.skillId} tone="blue">
                    <Icon name="skill" className="h-3.5 w-3.5" />
                    {skill.name}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {/*
            Why this course is worth the hour: real events it exists to prevent.
            Motivation is the scarcest resource in mandatory training.
          */}
          {nearMisses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>What this course exists to prevent</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                <p className="text-[0.8125rem] text-[var(--text-muted)]">
                  Near misses from the library. Nobody is named in any of them.
                </p>
                <ul aria-label="Near misses this course teaches" className="flex flex-col gap-2">
                  {nearMisses.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone="navy">{item.reference}</Badge>
                      <Link
                        href={`/near-misses/${item.reference}`}
                        className="rounded-sm text-[0.875rem] font-medium text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        {item.title}
                      </Link>
                      <span className="text-[0.75rem] text-[var(--text-muted)]">
                        {SEVERITY_LABELS[item.severity]}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div>
            <SectionHeading title="Course outline" description={`${data.totalLessons} lessons`} />
            <div className="flex flex-col gap-4">
              {course.sections.map((section) => (
                <Card key={section.id}>
                  <CardHeader>
                    <CardTitle>{section.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="!py-0">
                    <ul>
                      {section.lessons.map((lesson) => {
                        const status = lesson.progress?.status ?? "NOT_STARTED";
                        const lockedLesson = blocked;
                        return (
                          <li key={lesson.id} className="border-b border-[var(--border-subtle)] py-3 last:border-0">
                            {lockedLesson ? (
                              <div className="flex items-center justify-between gap-3 opacity-60">
                                <LessonRow lesson={lesson} status={status} />
                              </div>
                            ) : (
                              <Link
                                href={`/courses/${courseId}/lessons/${lesson.id}`}
                                className="flex items-center justify-between gap-3 rounded-md -mx-2 px-2 py-1 hover:bg-[var(--surface-sunken)]"
                              >
                                <LessonRow lesson={lesson} status={status} />
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Your progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ProgressBar value={overallPercent} label={`${overallPercent}% complete`} tone={overallPercent >= 100 ? "success" : "brand"} />
              <p className="text-[0.8125rem] text-[var(--text-muted)]">
                {data.completedLessons} of {data.totalLessons} lessons complete
              </p>
              {assignment && (
                <p className="text-[0.75rem] text-[var(--text-muted)]">
                  Status: <span className="font-medium text-[var(--text-secondary)]">{assignment.status}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {certificate && (
            <Card>
              <CardHeader>
                <CardTitle>Certificate earned</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[0.8125rem] text-[var(--text-secondary)]">{certificate.certificateNumber}</p>
                <p className="text-[0.75rem] text-[var(--text-muted)]">
                  Issued {formatInTimeZone(certificate.issuedAt, actor.timezone, "MMMM d, yyyy")}
                  {certificate.expiresAt && ` · Expires ${formatInTimeZone(certificate.expiresAt, actor.timezone, "MMMM d, yyyy")}`}
                </p>
                <Link href="/certificates">
                  <Button variant="outline" size="sm">
                    View certificates
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}

function LessonRow({
  lesson,
  status,
}: {
  lesson: { id: string; title: string; type: string; required: boolean; estimatedMinutes: number | null };
  status: string;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        {status === "COMPLETED" ? (
          <Glyph name="check" className="h-4 w-4 shrink-0 text-success-600" />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded-full border border-[var(--border-default)]" aria-hidden="true" />
        )}
        <span className="truncate text-[0.875rem] text-[var(--text-primary)]">{lesson.title}</span>
        {!lesson.required && <Badge tone="neutral">Optional</Badge>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[0.75rem] text-[var(--text-muted)]">
        {LESSON_TYPE_LABEL[lesson.type] ?? lesson.type}
        {lesson.estimatedMinutes && <span>· {lesson.estimatedMinutes} min</span>}
      </span>
    </>
  );
}
