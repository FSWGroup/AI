"use client";

import Link from "next/link";
import * as Tabs from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { formatDueDate, formatShortDate } from "@/lib/dates";
import { AssignmentStatusBadge } from "@/components/people/badges";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export interface ProfileAssignmentRow {
  id: string;
  title: string;
  targetType: string;
  status: string;
  dueAt: Date | null;
  completedAt: Date | null;
  reason: string | null;
}

export interface ProfileSkillRow {
  skillId: string;
  name: string;
  category: string | null;
  level: number;
  levelName: string;
  source: string;
}

export interface ProfileCertificateRow {
  id: string;
  certificateNumber: string;
  courseTitleSnapshot: string;
  issuedAt: Date;
  expiresAt: Date | null;
}

const TAB_TRIGGER_CLASS = cn(
  "rounded-t-md px-3 py-2 text-[0.8125rem] font-medium text-[var(--text-muted)] transition-colors",
  "hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
  "data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand-primary)] data-[state=active]:text-[var(--text-primary)]",
);

export function PersonProfileTabs({
  timezone,
  responsibilities,
  toolsUsed,
  assignments,
  skills,
  certificates,
}: {
  timezone: string;
  responsibilities: string[];
  toolsUsed: string[];
  assignments: ProfileAssignmentRow[];
  skills: ProfileSkillRow[];
  certificates: ProfileCertificateRow[];
}) {
  return (
    <Tabs.Root defaultValue="overview" className="flex flex-col gap-4">
      <Tabs.List className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]" aria-label="Profile sections">
        <Tabs.Trigger value="overview" className={TAB_TRIGGER_CLASS}>
          Overview
        </Tabs.Trigger>
        <Tabs.Trigger value="training" className={TAB_TRIGGER_CLASS}>
          Training ({assignments.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="skills" className={TAB_TRIGGER_CLASS}>
          Skills ({skills.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="certificates" className={TAB_TRIGGER_CLASS}>
          Certificates ({certificates.length})
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="overview" className="flex flex-col gap-4">
        {responsibilities.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Responsibilities</h3>
            <ul className="list-disc space-y-1 pl-5 text-[0.8125rem] text-[var(--text-secondary)]">
              {responsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {toolsUsed.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Tools used</h3>
            <div className="flex flex-wrap gap-1.5">
              {toolsUsed.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {responsibilities.length === 0 && toolsUsed.length === 0 && (
          <p className="text-[0.8125rem] text-[var(--text-muted)]">No position responsibilities are on file.</p>
        )}
      </Tabs.Content>

      <Tabs.Content value="training">
        {assignments.length === 0 ? (
          <EmptyState
            icon={<Icon name="assignment" className="h-5 w-5" />}
            title="No training assigned"
            description="Assignments appear here once training rules, position requirements, or a manager assign something."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="bg-[var(--surface-sunken)]">
                  <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                    Training
                  </th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                    Status
                  </th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                    Due / completed
                  </th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                    Why you have this
                  </th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">{a.title}</td>
                    <td className="border-b border-[var(--border-subtle)] p-2.5">
                      <AssignmentStatusBadge status={a.status} />
                    </td>
                    <td className="border-b border-[var(--border-subtle)] p-2.5">
                      {a.completedAt ? `Completed ${formatShortDate(a.completedAt, timezone)}` : formatDueDate(a.dueAt, timezone)}
                    </td>
                    <td className="border-b border-[var(--border-subtle)] p-2.5 text-[var(--text-muted)]">{a.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tabs.Content>

      <Tabs.Content value="skills">
        {skills.length === 0 ? (
          <EmptyState
            icon={<Icon name="skill" className="h-5 w-5" />}
            title="No skills recorded"
            description="Skills earned from training or assessed by a manager appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {skills.map((s) => (
              <div
                key={s.skillId}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] p-3"
              >
                <div>
                  <p className="text-[0.8125rem] font-medium text-[var(--text-primary)]">{s.name}</p>
                  {s.category && <p className="text-[0.75rem] text-[var(--text-muted)]">{s.category}</p>}
                </div>
                <Badge tone="blue">{s.levelName}</Badge>
              </div>
            ))}
          </div>
        )}
      </Tabs.Content>

      <Tabs.Content value="certificates">
        {certificates.length === 0 ? (
          <EmptyState
            icon={<Icon name="certificate" className="h-5 w-5" />}
            title="No certificates yet"
            description="Certificates are issued automatically on course completion."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {certificates.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] p-3"
              >
                <div>
                  <p className="text-[0.8125rem] font-medium text-[var(--text-primary)]">{c.courseTitleSnapshot}</p>
                  <p className="text-[0.75rem] text-[var(--text-muted)]">
                    {c.certificateNumber} · Issued {formatShortDate(c.issuedAt, timezone)}
                    {c.expiresAt ? ` · Expires ${formatShortDate(c.expiresAt, timezone)}` : ""}
                  </p>
                </div>
                <Link href={`/api/certificates/${c.id}/pdf`} className="text-[0.8125rem] text-[var(--brand-secondary)] hover:underline">
                  PDF
                </Link>
              </div>
            ))}
          </div>
        )}
      </Tabs.Content>
    </Tabs.Root>
  );
}
