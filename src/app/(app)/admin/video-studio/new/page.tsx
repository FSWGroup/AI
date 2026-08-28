import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { getTTSProvider } from "@/lib/ai/index";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { VideoWizard } from "@/components/ai/video-wizard";

export const metadata = { title: "New AI Video" };

export default async function NewVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ fromSop?: string; fromCourse?: string }>;
}) {
  await requirePermission("ai.video");
  const { fromSop, fromCourse } = await searchParams;
  const settings = await getSettings();
  const ttsProvider = getTTSProvider();

  return (
    <>
      <PageHeader
        title="New AI video"
        description="Pick a source and a mode. AI will draft a full plan — script, scenes, on-screen text — for you to edit before anything renders."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Video Studio", href: "/admin/video-studio" },
          { label: "New video" },
        ]}
      />
      <PageBody className="max-w-3xl">
        <VideoWizard
          available={isCapabilityAvailable("ai_text")}
          videoRenderAvailable={isCapabilityAvailable("video_render")}
          avatarAvailable={isCapabilityAvailable("ai_video_avatar")}
          ttsVoices={ttsProvider?.voices ?? []}
          languages={settings.languages}
          initialSopId={fromSop ?? null}
          initialCourseId={fromCourse ?? null}
        />
      </PageBody>
    </>
  );
}
