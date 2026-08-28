"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button, Spinner } from "@/components/ui/button";
import { Glyph } from "@/components/icons";

/**
 * A minimal media picker: uploads directly to /api/media/upload and stores
 * the resulting media id. Used for brand logos/icons and video intro/outro
 * assets, where a full media-library browser would be overkill — pick a new
 * file here, or manage existing assets from the Media Library page.
 */
export function MediaPickerField({
  label,
  hint,
  value,
  onChange,
  accept,
  disabled,
  previewIsImage = true,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (mediaId: string | null) => void;
  accept: string;
  disabled?: boolean;
  previewIsImage?: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/media/upload", { method: "POST", body: form });
      const json = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !json.id) {
        toast.error(json.error ?? "Upload failed.");
        return;
      }
      onChange(json.id);
      toast.success("Uploaded.");
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-[var(--text-primary)]">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)]">
          {value && previewIsImage ? (
             
            <img src={`/api/media/${value}`} alt="" className="h-full w-full object-contain" />
          ) : value ? (
            <Glyph name="download" className="h-5 w-5 text-[var(--text-muted)]" />
          ) : (
            <Glyph name="upload" className="h-5 w-5 text-[var(--text-muted)]" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Spinner /> : <Glyph name="upload" className="h-3.5 w-3.5" />}
              {value ? "Replace" : "Upload"}
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
          {hint && <p className="text-[0.75rem] text-[var(--text-muted)]">{hint}</p>}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}
