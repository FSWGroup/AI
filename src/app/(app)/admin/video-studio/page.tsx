import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { VideoJobList } from "@/components/ai/video-job-list";

export const metadata = { title: "AI Video Studio" };

export default async function VideoStudioPage() {
  await requirePermission("ai.video");
  const [aiTextAvailable, videoRenderAvailable, jobs] = await Promise.all([
    Promise.resolve(isCapabilityAvailable("ai_text")),
    Promise.resolve(isCapabilityAvailable("video_render")),
    prisma.videoJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, mode: true, status: true, progress: true, error: true, createdAt: true, outputMediaId: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="AI Video Studio"
        description="Generate FSW-branded training videos: pick a mode, review the plan, then render."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Video Studio" }]}
        actions={
          <Link
            href="/admin/video-studio/new"
            className="inline-flex h-9.5 items-center justify-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white shadow-xs hover:bg-[var(--brand-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            New video
          </Link>
        }
      />
      <PageBody>
        {!videoRenderAvailable && (
          <p className="mb-4 rounded-md border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-[0.8125rem] text-warning-800">
            The local video renderer isn&apos;t available on this host (ffmpeg not found). Plans and scripts can still
            be generated, but rendering will fail until FFMPEG_PATH points to a working ffmpeg binary.
          </p>
        )}
        {!aiTextAvailable && (
          <p className="mb-4 rounded-md border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-[0.8125rem] text-warning-800">
            AI text generation isn&apos;t configured — video plans can&apos;t be generated until an administrator sets
            an API key.
          </p>
        )}
        <VideoJobList
          initialJobs={jobs.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() }))}
        />
      </PageBody>
    </>
  );
}
