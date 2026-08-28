import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { isCapabilityAvailable, getCapabilityStatuses } from "@/lib/providers/registry";
import { SectionHeading } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { VideoForm } from "@/app/(app)/admin/settings/video/video-form";

export default async function VideoSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();
  const renderCapability = getCapabilityStatuses().find((c) => c.key === "video_render");

  return (
    <div>
      <SectionHeading title="Video" description="Branding used by AI-generated training videos, and the local render pipeline's status." />

      <div className="mb-5 flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3.5 py-2.5">
        <Badge tone={isCapabilityAvailable("video_render") ? "success" : "warning"} dot>
          {isCapabilityAvailable("video_render") ? "Render pipeline ready" : "Render pipeline unavailable"}
        </Badge>
        <p className="text-[0.8125rem] text-[var(--text-muted)]">{renderCapability?.degradesTo}</p>
      </div>

      <VideoForm
        initialIntro={settings.brand.videoIntroMediaId}
        initialOutro={settings.brand.videoOutroMediaId}
        canManage={actor.permissions.has("settings.manage")}
      />
    </div>
  );
}
