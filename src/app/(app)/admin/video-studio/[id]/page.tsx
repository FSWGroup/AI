import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { prisma } from "@/lib/db";
import { isVideoOutdated } from "@/lib/video/render";
import type { VideoPlan } from "@/lib/video/types";
import { PageHeader, PageBody } from "@/components/page-header";
import { VideoJobDetail } from "@/components/ai/video-job-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.videoJob.findUnique({ where: { id }, select: { title: true } });
  return { title: job?.title ?? "Video job" };
}

export default async function VideoJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("ai.video");
  const { id } = await params;

  const job = await prisma.videoJob.findUnique({
    where: { id },
    select: {
      id: true, title: true, mode: true, status: true, progress: true, error: true, plan: true,
      outputMediaId: true, sourceSopId: true, sourceCourseId: true, sourceSopVersion: true,
      aspectRatio: true, language: true, voice: true, createdAt: true,
    },
  });
  if (!job) notFound();

  const media = job.outputMediaId
    ? await prisma.mediaAsset.findUnique({
        where: { id: job.outputMediaId },
        select: { id: true, durationSeconds: true, captionsVtt: true, chapters: true, sizeBytes: true, createdAt: true },
      })
    : null;

  const outdated = job.outputMediaId ? await isVideoOutdated(job.outputMediaId) : null;

  return (
    <>
      <PageHeader
        title={job.title}
        description="Review the plan, queue the render, and publish the finished video once it's ready."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Video Studio", href: "/admin/video-studio" },
          { label: job.title },
        ]}
      />
      <PageBody className="max-w-4xl">
        <VideoJobDetail
          job={{
            id: job.id,
            title: job.title,
            mode: job.mode,
            status: job.status,
            progress: job.progress,
            error: job.error,
            plan: job.plan as unknown as VideoPlan | null,
            outputMediaId: job.outputMediaId,
            sourceSopId: job.sourceSopId,
            sourceCourseId: job.sourceCourseId,
          }}
          media={
            media && {
              id: media.id,
              durationSeconds: media.durationSeconds,
              captionsVtt: media.captionsVtt,
              chapters: (media.chapters as { title: string; startSeconds: number }[] | null) ?? [],
              sizeBytes: media.sizeBytes,
            }
          }
          outdated={outdated}
          aiTextAvailable={isCapabilityAvailable("ai_text")}
          videoRenderAvailable={isCapabilityAvailable("video_render")}
        />
      </PageBody>
    </>
  );
}
