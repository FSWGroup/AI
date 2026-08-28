"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createAnnouncementAction, updateAnnouncementAction } from "@/app/(app)/admin/announcements/actions";
import type { AnnouncementTargetMode } from "@/lib/services/announcements";

export interface TargetOptions {
  businessUnits: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  roles: { key: string; name: string }[];
}

export interface AnnouncementFormInitial {
  id?: string;
  title: string;
  body: string;
  targetMode: AnnouncementTargetMode;
  targetId: string | null;
  startsAt: string;
  expiresAt: string | null;
  pinned: boolean;
  requiresAck: boolean;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function AnnouncementForm({ initial, options }: { initial: AnnouncementFormInitial; options: TargetOptions }) {
  const router = useRouter();
  const [targetMode, setTargetMode] = React.useState<AnnouncementTargetMode>(initial.targetMode);
  const [saving, setSaving] = React.useState(false);

  const targetOptionsFor = (mode: AnnouncementTargetMode) => {
    switch (mode) {
      case "businessUnit":
        return options.businessUnits.map((o) => ({ value: o.id, label: o.name }));
      case "department":
        return options.departments.map((o) => ({ value: o.id, label: o.name }));
      case "team":
        return options.teams.map((o) => ({ value: o.id, label: o.name }));
      case "location":
        return options.locations.map((o) => ({ value: o.id, label: o.name }));
      case "role":
        return options.roles.map((o) => ({ value: o.key, label: o.name }));
      default:
        return [];
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = initial.id ? await updateAnnouncementAction(initial.id, form) : await createAnnouncementAction(form);
      if (result.ok) {
        toast.success(initial.id ? "Announcement updated." : "Announcement created.");
        router.push("/admin/announcements");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      <Field label="Title" htmlFor="ann-title" required>
        <Input id="ann-title" name="title" defaultValue={initial.title} required />
      </Field>
      <Field label="Message" htmlFor="ann-body" required>
        <Textarea id="ann-body" name="body" defaultValue={initial.body} rows={5} required />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Audience" htmlFor="ann-target-mode">
          <Select id="ann-target-mode" name="targetMode" value={targetMode} onChange={(e) => setTargetMode(e.target.value as AnnouncementTargetMode)}>
            <option value="everyone">Everyone</option>
            <option value="businessUnit">Business unit</option>
            <option value="department">Department</option>
            <option value="team">Team</option>
            <option value="location">Location</option>
            <option value="role">Role</option>
          </Select>
        </Field>
        {targetMode !== "everyone" && (
          <Field label="Specific target" htmlFor="ann-target-id" required>
            <Select id="ann-target-id" name="targetId" defaultValue={initial.targetId ?? ""} required>
              <option value="" disabled>
                Choose one…
              </option>
              {targetOptionsFor(targetMode).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor="ann-starts">
          <Input id="ann-starts" name="startsAt" type="date" defaultValue={toDateInputValue(initial.startsAt)} />
        </Field>
        <Field label="Expires" htmlFor="ann-expires" hint="Leave blank for no expiration.">
          <Input id="ann-expires" name="expiresAt" type="date" defaultValue={toDateInputValue(initial.expiresAt)} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" name="pinned" defaultChecked={initial.pinned} className="h-4 w-4 rounded border-[var(--border-default)]" />
        Pin to the top of the feed
      </label>
      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" name="requiresAck" defaultChecked={initial.requiresAck} className="h-4 w-4 rounded border-[var(--border-default)]" />
        Require acknowledgement
      </label>

      <div>
        <Button type="submit" loading={saving}>
          {initial.id ? "Save changes" : "Publish announcement"}
        </Button>
      </div>
    </form>
  );
}
