import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission, actorHas, getVisibleUserIds } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getCourseForLearner } from "@/lib/services/course";
import { PageBody } from "@/components/page-header";
import { LessonPageShell, type ShellSection } from "@/components/lesson/lesson-page-shell";
import type { LessonPlayerProps } from "@/components/lesson/types";
import * as actions from "./actions";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id: courseId, lessonId } = await params;
  const actor = await requirePermission("training.view");

  const [courseData, lessonRow, progressRow, courseMeta] = await Promise.all([
    getCourseForLearner(actor, courseId).catch(() => null),
    prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, title: true, type: true, required: true, estimatedMinutes: true, content: true, section: { select: { courseId: true } } },
    }),
    prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: actor.id, lessonId } },
      select: { status: true, videoPositionSeconds: true, videoWatchedPercent: true, checklistState: true, completedAt: true },
    }),
    prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, requiredVideoPercent: true, passingScore: true, attemptLimit: true },
    }),
  ]);

  if (!courseData || !lessonRow || !courseMeta || lessonRow.section.courseId !== courseId) notFound();

  const flatLessons = courseData.course.sections.flatMap((s) => s.lessons);
  const currentIndex = flatLessons.findIndex((l) => l.id === lessonId);
  if (currentIndex === -1) notFound();

  const prevLesson = currentIndex > 0 ? flatLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < flatLessons.length - 1 ? flatLessons[currentIndex + 1] : null;

  let contentForPlayer = (lessonRow.content ?? {}) as Record<string, unknown>;
  const extra: NonNullable<LessonPlayerProps["extra"]> = {};

  if (lessonRow.type === "SOP_REF") {
    const sopId = typeof contentForPlayer.sopId === "string" ? contentForPlayer.sopId : undefined;
    if (sopId) {
      const sop = await prisma.sop.findUnique({
        where: { id: sopId },
        select: { title: true, currentVersion: { select: { blocks: true } } },
      });
      extra.sopBlocks = sop?.currentVersion?.blocks ?? [];
      extra.sopTitle = sop?.title;
    }
  }

  if (lessonRow.type === "VIDEO" || lessonRow.type === "AI_VIDEO" || lessonRow.type === "SCREEN_RECORDING") {
    const mediaId = typeof contentForPlayer.mediaId === "string" ? contentForPlayer.mediaId : undefined;
    if (mediaId) {
      const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId }, select: { captionsVtt: true } });
      if (media?.captionsVtt) {
        contentForPlayer = {
          ...contentForPlayer,
          captionsVttDataUrl: `data:text/vtt;charset=utf-8,${encodeURIComponent(media.captionsVtt)}`,
        };
      }
    }
  }

  if (lessonRow.type === "LIVE_SESSION") {
    const liveSessionId = typeof contentForPlayer.liveSessionId === "string" ? contentForPlayer.liveSessionId : undefined;
    if (liveSessionId) {
      const session = await prisma.liveSession.findUnique({
        where: { id: liveSessionId },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          timezone: true,
          locationText: true,
          capacity: true,
          attendance: { select: { userId: true, status: true } },
        },
      });
      if (session) {
        const mine = session.attendance.find((a) => a.userId === actor.id);
        extra.liveSession = {
          id: session.id,
          title: session.title,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          timezone: session.timezone,
          locationText: session.locationText,
          capacity: session.capacity,
          registeredCount: session.attendance.length,
          myStatus: mine?.status ?? null,
        };
      }
    }
  }

  if (lessonRow.type === "DISCUSSION") {
    const comments = await prisma.contentComment.findMany({
      where: { entityType: "LESSON", entityId: lessonId },
      orderBy: { createdAt: "asc" },
      select: { id: true, body: true, authorId: true, parentId: true, createdAt: true, author: { select: { name: true } } },
    });
    extra.comments = comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorName: c.author.name,
      authorId: c.authorId,
      createdAt: c.createdAt.toISOString(),
      parentId: c.parentId,
    }));
  }

  let viewerCanApprove = false;
  let reviewableUsers: { id: string; name: string }[] = [];
  if (lessonRow.type === "MANAGER_SIGNOFF" || lessonRow.type === "PRACTICAL_DEMO") {
    viewerCanApprove = actorHas(actor, "team.approve") || actorHas(actor, "skills.assess");
    if (viewerCanApprove) {
      const visible = await getVisibleUserIds(actor);
      const users = await prisma.user.findMany({
        where: visible === "ALL" ? { id: { not: actor.id }, status: "ACTIVE" } : { id: { in: visible.filter((id) => id !== actor.id) } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
      });
      reviewableUsers = users;
    }
    const assessments = await prisma.skillAssessment.findMany({
      where: { lessonId, userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, userId: true, rating: true, comments: true, createdAt: true },
    });
    extra.practicalAssessments = assessments.map((a) => ({
      id: a.id,
      userId: a.userId,
      userName: actor.name,
      rating: a.rating,
      comments: a.comments,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  const shellSections: ShellSection[] = courseData.course.sections.map((s) => ({
    id: s.id,
    title: s.title,
    lessons: s.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type,
      required: l.required,
      status: l.progress?.status ?? "NOT_STARTED",
    })),
  }));

  return (
    <PageBody>
      <LessonPageShell
        courseId={courseId}
        courseTitle={courseData.course.title}
        overallPercent={courseData.overallPercent}
        sections={shellSections}
        currentLessonId={lessonId}
        prevHref={prevLesson ? `/courses/${courseId}/lessons/${prevLesson.id}` : null}
        nextHref={nextLesson ? `/courses/${courseId}/lessons/${nextLesson.id}` : null}
        lesson={{
          id: lessonRow.id,
          title: lessonRow.title,
          type: lessonRow.type,
          required: lessonRow.required,
          estimatedMinutes: lessonRow.estimatedMinutes,
          content: contentForPlayer,
        }}
        course={{
          id: courseMeta.id,
          title: courseMeta.title,
          requiredVideoPercent: courseMeta.requiredVideoPercent,
          passingScore: courseMeta.passingScore,
          attemptLimit: courseMeta.attemptLimit,
        }}
        progress={
          progressRow
            ? {
                status: progressRow.status,
                videoPositionSeconds: progressRow.videoPositionSeconds,
                videoWatchedPercent: progressRow.videoWatchedPercent,
                checklistState: progressRow.checklistState as Record<string, unknown> | null,
                completedAt: progressRow.completedAt?.toISOString() ?? null,
              }
            : null
        }
        viewer={{ id: actor.id, name: actor.name, canApprove: viewerCanApprove, reviewableUsers }}
        extra={extra}
        actions={{
          acknowledge: actions.acknowledgeAction,
          assessPractical: actions.assessPracticalAction,
          submitProject: actions.submitProjectAction,
          registerForSession: actions.registerForSessionAction,
          postComment: actions.postCommentAction,
          startQuizAttempt: actions.startQuizAttemptAction,
          submitQuizAttempt: actions.submitQuizAttemptAction,
          getQuizReview: actions.getQuizReviewAction,
        }}
      />
    </PageBody>
  );
}
