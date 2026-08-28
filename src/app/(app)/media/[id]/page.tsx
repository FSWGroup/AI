import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getScormLaunchInfo } from "@/lib/services/scorm";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDuration } from "@/lib/utils";
import { ScormPlayerClient } from "@/app/(app)/media/[id]/scorm-player-client";

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActor();
  const { id } = await params;

  const asset = await prisma.mediaAsset.findFirst({ where: { id, isDeleted: false } });
  if (!asset) notFound();

  const scormInfo = getScormLaunchInfo(asset);
  const settings = scormInfo ? await getSettings() : null;
  const chapters = !scormInfo && Array.isArray(asset.chapters) ? (asset.chapters as { title: string; startSeconds: number }[]) : [];

  return (
    <div>
      <PageHeader
        title={asset.title || asset.filename}
        description={`${asset.kind} · ${formatBytes(asset.sizeBytes)}${asset.durationSeconds ? ` · ${formatDuration(asset.durationSeconds)}` : ""}`}
        crumbs={[{ label: "Media library", href: "/admin/media" }, { label: asset.title || asset.filename }]}
      />
      <PageBody className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          {scormInfo ? (
            <ScormSection mediaId={asset.id} enabled={Boolean(settings?.features.scormPlayer)} version={scormInfo.version} />
          ) : asset.kind === "VIDEO" ? (
            <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- track is added conditionally below */}
              <video controls className="aspect-video w-full" preload="metadata">
                <source src={`/api/media/${asset.id}`} type={asset.mimeType} />
                {asset.captionsVtt && <track kind="captions" src={`/api/media/${asset.id}/captions.vtt`} srcLang="en" label="English captions" default />}
                Your browser does not support embedded video.
              </video>
            </div>
          ) : asset.kind === "AUDIO" ? (
            <audio controls className="w-full">
              <source src={`/api/media/${asset.id}`} type={asset.mimeType} />
            </audio>
          ) : asset.kind === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${asset.id}`} alt={asset.altText ?? ""} className="max-h-[36rem] w-full rounded-lg border border-[var(--border-subtle)] object-contain" />
          ) : asset.mimeType === "application/pdf" ? (
            <iframe title={asset.title ?? asset.filename} src={`/api/media/${asset.id}`} className="h-[36rem] w-full rounded-lg border border-[var(--border-subtle)]" />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--border-default)] p-10 text-center">
              <p className="text-[0.875rem] text-[var(--text-secondary)]">Preview isn&apos;t available for this file type.</p>
              <a href={`/api/media/${asset.id}`} className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">
                Download {asset.filename}
              </a>
            </div>
          )}

          {chapters.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-1.5 text-[0.875rem] font-semibold text-[var(--text-primary)]">Chapters</h2>
              <ul className="flex flex-col gap-1 text-[0.8125rem] text-[var(--text-secondary)]">
                {chapters.map((c, i) => (
                  <li key={i}>
                    {formatDuration(c.startSeconds)} — {c.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {asset.transcript && (
            <div className="mt-4">
              <h2 className="mb-1.5 text-[0.875rem] font-semibold text-[var(--text-primary)]">Transcript</h2>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4 text-[0.8125rem] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                {asset.transcript}
              </div>
            </div>
          )}
        </div>

        <aside className="w-full shrink-0 lg:w-64">
          <dl className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 text-[0.8125rem]">
            <div>
              <dt className="text-[var(--text-muted)]">File name</dt>
              <dd className="text-[var(--text-primary)]">{asset.filename}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Type</dt>
              <dd className="text-[var(--text-primary)]">{asset.mimeType}</dd>
            </div>
            {asset.altText && (
              <div>
                <dt className="text-[var(--text-muted)]">Alt text</dt>
                <dd className="text-[var(--text-primary)]">{asset.altText}</dd>
              </div>
            )}
            <div>
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd>
                <Badge tone={asset.processingStatus === "READY" ? "success" : asset.processingStatus === "FAILED" ? "danger" : "info"}>
                  {asset.processingStatus ?? "READY"}
                </Badge>
              </dd>
            </div>
          </dl>
        </aside>
      </PageBody>
    </div>
  );
}

function ScormSection({ mediaId, enabled, version }: { mediaId: string; enabled: boolean; version: string }) {
  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-default)] p-8 text-center">
        <p className="text-[0.875rem] font-medium text-[var(--text-primary)]">SCORM playback is disabled</p>
        <p className="mt-1 text-[0.8125rem] text-[var(--text-muted)]">
          This is a SCORM {version} package. An administrator can enable it under Settings → Feature flags.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-info-100 bg-info-50 p-3 text-[0.8125rem] text-info-700">
        This SCORM {version} package runs inside a fully sandboxed frame with no access to your session, cookies, or the rest of this app. In
        this deployment, the platform&apos;s untrusted-media policy also blocks script execution inside that frame for safety — the package
        loads, but interactive content that depends on JavaScript may not run. Extraction and manifest parsing are fully working.
      </div>
      <ScormPlayerClient mediaId={mediaId} src={`/api/media/scorm/${mediaId}/`} />
    </div>
  );
}
