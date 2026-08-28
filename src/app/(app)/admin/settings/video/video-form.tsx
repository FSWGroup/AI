"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MediaPickerField } from "@/app/(app)/admin/settings/_shared/media-picker";
import { saveSettingsSection } from "@/app/(app)/admin/settings/_shared/actions";

export function VideoForm({
  initialIntro,
  initialOutro,
  canManage,
}: {
  initialIntro: string | null;
  initialOutro: string | null;
  canManage: boolean;
}) {
  const [intro, setIntro] = React.useState(initialIntro);
  const [outro, setOutro] = React.useState(initialOutro);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveSettingsSection("brand", { videoIntroMediaId: intro, videoOutroMediaId: outro });
      if (result.ok) toast.success("Video settings saved.");
      else toast.error(result.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 flex max-w-md flex-col gap-4">
      <MediaPickerField
        label="Intro clip"
        hint="Plays before AI-generated training videos."
        value={intro}
        onChange={setIntro}
        accept="video/mp4,video/webm"
        disabled={!canManage}
        previewIsImage={false}
      />
      <MediaPickerField
        label="Outro clip"
        hint="Plays after AI-generated training videos."
        value={outro}
        onChange={setOutro}
        accept="video/mp4,video/webm"
        disabled={!canManage}
        previewIsImage={false}
      />
      {canManage && (
        <div>
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
