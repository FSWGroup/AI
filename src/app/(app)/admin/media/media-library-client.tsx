"use client";

import * as React from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button, Spinner } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { formatBytes } from "@/lib/utils";
import { deleteMediaAction, getMediaUsageAction, updateMediaAction } from "@/app/(app)/admin/media/actions";
import type { MediaUsage } from "@/lib/services/media";

export interface MediaItem {
  id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "CAPTION" | "GENERATED";
  filename: string;
  title: string | null;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  ownerName: string | null;
  processingStatus: string | null;
  createdAt: string;
}

const KIND_ICON: Record<MediaItem["kind"], "media" | "video" | "content"> = {
  IMAGE: "media",
  VIDEO: "video",
  AUDIO: "media",
  DOCUMENT: "content",
  CAPTION: "content",
  GENERATED: "media",
};

export function MediaLibraryClient({
  items,
  canUpload,
  canDelete,
}: {
  items: MediaItem[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const [localItems, setLocalItems] = React.useState(items);
  const [uploading, setUploading] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [usageFor, setUsageFor] = React.useState<{ id: string; filename: string; usage: MediaUsage } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setLocalItems(items), [items]);

  const duplicateHashCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of localItems) {
      if (!item.sha256) continue;
      counts.set(item.sha256, (counts.get(item.sha256) ?? 0) + 1);
    }
    return counts;
  }, [localItems]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/media/upload", { method: "POST", body: form });
      const json = (await response.json().catch(() => ({}))) as { id?: string; error?: string; duplicate?: boolean };
      if (!response.ok || !json.id) {
        toast.error(json.error ?? "Upload failed.");
        return;
      }
      toast.success(json.duplicate ? "That file already exists — reusing the existing asset." : "Uploaded.");
      window.location.reload();
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const result = await deleteMediaAction(id);
      if (result.ok) {
        setLocalItems((prev) => prev.filter((i) => i.id !== id));
        toast.success("Deleted.");
      } else {
        const usageResult = await getMediaUsageAction(id);
        if (usageResult.ok) {
          const item = localItems.find((i) => i.id === id);
          setUsageFor({ id, filename: item?.filename ?? id, usage: usageResult.data.usage });
        }
        toast.error(result.error);
      }
    } finally {
      setBusyId(null);
    }
  };

  if (localItems.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {canUpload && <UploadButton uploading={uploading} onFile={upload} inputRef={fileInputRef} />}
        <EmptyState
          icon={<Icon name="media" className="h-5 w-5" />}
          title="No media matches your filters"
          description={canUpload ? "Upload an image, video, audio file, or document to get started." : "Try adjusting your filters."}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canUpload && <UploadButton uploading={uploading} onFile={upload} inputRef={fileInputRef} />}

      {usageFor && (
        <div role="alertdialog" aria-modal="true" aria-label="File in use" className="rounded-lg border border-warning-100 bg-warning-50 p-4">
          <p className="text-[0.875rem] font-semibold text-warning-700">Can&apos;t delete &quot;{usageFor.filename}&quot; — it&apos;s still in use</p>
          <ul className="mt-2 flex flex-col gap-1 text-[0.8125rem] text-warning-700">
            {usageFor.usage.courses.map((c) => (
              <li key={c.id}>
                Course: <Link href={c.href} className="underline">{c.title}</Link>
              </li>
            ))}
            {usageFor.usage.paths.map((p) => (
              <li key={p.id}>
                Learning path: <Link href={p.href} className="underline">{p.title}</Link>
              </li>
            ))}
            {usageFor.usage.sops.map((s) => (
              <li key={s.id}>
                SOP: <Link href={s.href} className="underline">{s.title}</Link>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setUsageFor(null)} className="mt-2 text-[0.75rem] font-medium text-warning-700 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {localItems.map((item) => {
          const duplicateCount = item.sha256 ? (duplicateHashCounts.get(item.sha256) ?? 1) : 1;
          return (
            <div key={item.id} className="flex flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
              <div className="flex h-32 items-center justify-center bg-[var(--surface-sunken)]">
                {item.kind === "IMAGE" ? (
                   
                  <img src={`/api/media/${item.id}`} alt={item.altText ?? ""} className="h-full w-full object-cover" />
                ) : (
                  <Icon name={KIND_ICON[item.kind]} className="h-8 w-8 text-[var(--text-muted)]" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-[var(--text-primary)]" title={item.filename}>
                    {item.title || item.filename}
                  </p>
                  {item.processingStatus === "PROCESSING" && <Badge tone="info">Processing</Badge>}
                  {item.processingStatus === "FAILED" && <Badge tone="danger">Failed</Badge>}
                </div>
                <p className="text-[0.75rem] text-[var(--text-muted)]">
                  {item.kind} · {formatBytes(item.sizeBytes)}
                  {item.ownerName ? ` · ${item.ownerName}` : ""}
                </p>
                {duplicateCount > 1 && <Badge tone="warning">Duplicate of {duplicateCount} files</Badge>}
                {!item.altText && item.kind === "IMAGE" && <Badge tone="warning">Missing alt text</Badge>}

                {editingId === item.id ? (
                  <EditForm
                    item={item}
                    onCancel={() => setEditingId(null)}
                    onSaved={(title, altText) => {
                      setLocalItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, title, altText } : i)));
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <div className="mt-auto flex gap-1.5 pt-1.5">
                    <Link href={`/media/${item.id}`} className="text-[0.75rem] font-medium text-[var(--brand-secondary)] hover:underline">
                      Preview
                    </Link>
                    {canUpload && (
                      <button type="button" onClick={() => setEditingId(item.id)} className="text-[0.75rem] font-medium text-[var(--text-secondary)] hover:underline">
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => remove(item.id)}
                        className="ml-auto flex items-center gap-1 text-[0.75rem] font-medium text-danger-700 hover:underline disabled:opacity-60"
                      >
                        {busyId === item.id ? <Spinner className="h-3 w-3" /> : <Glyph name="trash" className="h-3 w-3" />}
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UploadButton({
  uploading,
  onFile,
  inputRef,
}: {
  uploading: boolean;
  onFile: (file: File) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <Button variant="outline" loading={uploading} onClick={() => inputRef.current?.click()}>
        <Glyph name="upload" className="h-4 w-4" />
        Upload media
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function EditForm({
  item,
  onCancel,
  onSaved,
}: {
  item: MediaItem;
  onCancel: () => void;
  onSaved: (title: string | null, altText: string | null) => void;
}) {
  const [title, setTitle] = React.useState(item.title ?? "");
  const [altText, setAltText] = React.useState(item.altText ?? "");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateMediaAction(item.id, { title, altText });
      if (result.ok) {
        toast.success("Saved.");
        onSaved(title || null, altText || null);
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 pt-1">
      <Field label="Title" htmlFor={`title-${item.id}`}>
        <Input id={`title-${item.id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Alt text" htmlFor={`alt-${item.id}`} hint="Required for images used in published content.">
        <Input id={`alt-${item.id}`} value={altText} onChange={(e) => setAltText(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" loading={saving} onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
