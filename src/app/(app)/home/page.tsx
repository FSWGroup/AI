import Link from "next/link";
import { requireActor } from "@/lib/auth/guard";
import { getLearnerDashboard, getOnboardingWelcome } from "@/lib/services/dashboard";
import { getAppName } from "@/lib/settings";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { AnnouncementFeed } from "@/app/(app)/home/announcement-feed";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export default async function HomePage() {
  const actor = await requireActor();
  const [data, appName] = await Promise.all([getLearnerDashboard(actor), getAppName()]);
  const welcome = data.isFirstLogin ? await getOnboardingWelcome(actor) : null;

  return (
    <div>
      <PageHeader title={`Welcome back, ${firstName(actor.name)}`} description={data.isFirstLogin ? `Let's get you started at ${appName}.` : "Here's where things stand today."} />
      <PageBody className="flex flex-col gap-8">
        {welcome && (
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5">
            <SectionHeading title={`Welcome to ${appName}, ${firstName(actor.name)}`} description="A quick orientation for your first days." />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-[0.75rem] font-medium text-[var(--text-muted)]">Your manager</p>
                <p className="mt-0.5 text-[0.9375rem] text-[var(--text-primary)]">
                  {welcome.manager ? `${welcome.manager.name}${welcome.manager.title ? ` · ${welcome.manager.title}` : ""}` : "Not yet assigned"}
                </p>
              </div>
              <div>
                <p className="text-[0.75rem] font-medium text-[var(--text-muted)]">Your position</p>
                <p className="mt-0.5 text-[0.9375rem] text-[var(--text-primary)]">{welcome.position?.title ?? "Not yet assigned"}</p>
              </div>
              <div>
                <p className="text-[0.75rem] font-medium text-[var(--text-muted)]">Your team</p>
                <p className="mt-0.5 text-[0.9375rem] text-[var(--text-primary)]">
                  {welcome.team.length > 0 ? welcome.team.map((t) => t.name).join(", ") : "Not yet assigned"}
                </p>
              </div>
              {welcome.position && welcome.position.toolsUsed.length > 0 && (
                <div>
                  <p className="text-[0.75rem] font-medium text-[var(--text-muted)]">Tools you&apos;ll use</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {welcome.position.toolsUsed.map((tool) => (
                      <Badge key={tool} tone="neutral">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {welcome.onboardingPath && (
                <div className="md:col-span-2">
                  <p className="text-[0.75rem] font-medium text-[var(--text-muted)]">Your onboarding path</p>
                  <p className="mt-0.5 text-[0.9375rem] text-[var(--text-primary)]">{welcome.onboardingPath.title}</p>
                  <div className="mt-1.5 max-w-xs">
                    <ProgressBar value={welcome.onboardingPath.percentComplete} label="Onboarding progress" />
                  </div>
                </div>
              )}
            </div>

            {welcome.todayTraining.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Start here today</p>
                <ul className="flex flex-col gap-1.5">
                  {welcome.todayTraining.map((t) => (
                    <li key={t.lessonId}>
                      <Link href={`/courses/${t.courseId}`} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-[0.8125rem] hover:border-[var(--border-strong)]">
                        <span className="text-[var(--text-primary)]">{t.courseTitle} — {t.lessonTitle}</span>
                        <Glyph name="arrow-right" className="h-4 w-4 text-[var(--text-muted)]" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {welcome.firstWeekChecklist.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Your first week</p>
                <ul className="flex flex-col gap-1">
                  {welcome.firstWeekChecklist.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-secondary)]">
                      <Glyph name="check" className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      {item.label}
                      {item.required && <Badge tone="neutral">Required</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {welcome.importantSops.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Important SOPs for your role</p>
                <ul className="flex flex-wrap gap-1.5">
                  {welcome.importantSops.map((sop) => (
                    <li key={sop.id}>
                      <Link href={`/sops/${sop.id}`}>
                        <Badge tone={sop.acknowledged ? "success" : "warning"}>
                          {sop.sopCode} {sop.acknowledged ? "· Acknowledged" : "· Needs your acknowledgement"}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section>
          <SectionHeading title="Continue where you left off" />
          {data.continueLearning ? (
            <Link
              href={`/courses/${data.continueLearning.courseId}`}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5 hover:border-[var(--border-strong)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-[0.75rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">{data.continueLearning.sectionTitle}</p>
                <p className="mt-0.5 text-[1.0625rem] font-semibold text-[var(--text-primary)]">{data.continueLearning.courseTitle}</p>
                <p className="mt-0.5 text-[0.8125rem] text-[var(--text-secondary)]">Next: {data.continueLearning.lessonTitle}</p>
              </div>
              <span className="inline-flex h-9.5 shrink-0 items-center gap-1.5 rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white">
                <Glyph name="play" className="h-4 w-4" />
                Resume
              </span>
            </Link>
          ) : (
            <EmptyState icon={<Icon name="training" className="h-5 w-5" />} title="Nothing in progress" description="Start a course from your training or the catalog." actions={<Link href="/catalog" className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">Browse the catalog</Link>} />
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <SectionHeading title="Due soon" description={`${data.dueSoon.length} item${data.dueSoon.length === 1 ? "" : "s"}`} />
            {data.dueSoon.length === 0 ? (
              <EmptyState icon={<Icon name="assignment" className="h-5 w-5" />} title="Nothing due soon" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.dueSoon.map((item) => (
                  <li key={item.assignmentId}>
                    <Link href={hrefForAssignment(item)} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3.5 py-2.5 text-[0.8125rem] hover:border-[var(--border-strong)]">
                      <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{item.title}</span>
                      <Badge tone="warning">{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : "—"}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title="Overdue" description={`${data.overdue.length} item${data.overdue.length === 1 ? "" : "s"}`} />
            {data.overdue.length === 0 ? (
              <EmptyState icon={<Icon name="approval" className="h-5 w-5" />} title="Nothing overdue — nice work" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.overdue.map((item) => (
                  <li key={item.assignmentId}>
                    <Link href={hrefForAssignment(item)} className="flex items-center justify-between gap-2 rounded-md border border-danger-100 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] hover:border-danger-500">
                      <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{item.title}</span>
                      <Badge tone="danger">{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : "Overdue"}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {data.paths.length > 0 && (
          <section>
            <SectionHeading title="Your learning paths" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.paths.map((path) => (
                <Card key={path.assignmentId}>
                  <CardContent className="flex flex-col gap-2">
                    <p className="font-medium text-[var(--text-primary)]">{path.title}</p>
                    <ProgressBar value={path.percentComplete} label={`${path.title} progress`} />
                    <p className="text-[0.75rem] text-[var(--text-muted)]">
                      {path.percentComplete}% complete{path.dueAt ? ` · Due ${new Date(path.dueAt).toLocaleDateString()}` : ""}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <SectionHeading title="Announcements" />
            <AnnouncementFeed announcements={data.announcements} />
          </section>

          <section>
            <SectionHeading title="Recently viewed SOPs" />
            {data.recentSops.length === 0 ? (
              <EmptyState icon={<Icon name="sop" className="h-5 w-5" />} title="No SOPs viewed yet" actions={<Link href="/sops" className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">Browse the SOP library</Link>} />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.recentSops.map((sop) => (
                  <li key={sop.sopId}>
                    <Link href={`/sops/${sop.sopId}`} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3.5 py-2.5 text-[0.8125rem] hover:border-[var(--border-strong)]">
                      <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                        {sop.sopCode} — {sop.title}
                      </span>
                      <span className="shrink-0 text-[var(--text-muted)]">{new Date(sop.viewedAt).toLocaleDateString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {data.recommended.length > 0 && (
          <section>
            <SectionHeading title="Recommended for you" description="Based on your position's requirements." />
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.recommended.map((rec) => (
                <li key={`${rec.type}-${rec.id}`}>
                  <Link
                    href={rec.type === "COURSE" ? `/courses/${rec.id}` : rec.type === "SOP" ? `/sops/${rec.id}` : `/paths/${rec.id}`}
                    className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3.5 hover:border-[var(--border-strong)]"
                  >
                    <Badge tone="neutral">{rec.type.replace("_", " ")}</Badge>
                    <p className="font-medium text-[var(--text-primary)]">{rec.title}</p>
                    <p className="text-[0.75rem] text-[var(--text-muted)]">{rec.reason}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section>
            <SectionHeading title="Certificates" />
            {data.certificates.length === 0 ? (
              <EmptyState icon={<Icon name="certificate" className="h-5 w-5" />} title="No certificates yet" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.certificates.map((cert) => (
                  <li key={cert.id} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3.5 py-2 text-[0.8125rem]">
                    <p className="font-medium text-[var(--text-primary)]">{cert.courseTitle}</p>
                    <p className="text-[var(--text-muted)]">#{cert.certificateNumber}{cert.expiresAt ? ` · Expires ${new Date(cert.expiresAt).toLocaleDateString()}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title="Top skills" />
            {data.skills.length === 0 ? (
              <EmptyState icon={<Icon name="skill" className="h-5 w-5" />} title="No skills recorded yet" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.skills.map((skill) => (
                  <li key={skill.skillId} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3.5 py-2 text-[0.8125rem]">
                    <span className="text-[var(--text-primary)]">{skill.name}</span>
                    <Badge tone="info">Level {skill.level}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title="Momentum" />
            <div className="flex flex-col gap-3">
              <Card>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.75rem] text-[var(--text-muted)]">Completion streak</p>
                    <p className="text-[1.25rem] font-semibold text-[var(--text-primary)]">{data.streak.currentStreakDays} day{data.streak.currentStreakDays === 1 ? "" : "s"}</p>
                  </div>
                  <Glyph name="sparkle" className="h-6 w-6 text-signal-500" />
                </CardContent>
              </Card>
              <p className="text-[0.75rem] text-[var(--text-muted)]">
                {data.streak.totalCompletions} total completions · {data.streak.totalCertificates} certificate{data.streak.totalCertificates === 1 ? "" : "s"}
              </p>
              {data.leaderboard && data.leaderboard.length > 0 && (
                <div>
                  <p className="mb-1 text-[0.75rem] font-semibold text-[var(--text-primary)]">Team leaderboard (30 days)</p>
                  <ul className="flex flex-col gap-1 text-[0.8125rem]">
                    {data.leaderboard.map((entry, i) => (
                      <li key={i} className="flex justify-between text-[var(--text-secondary)]">
                        <span>{i + 1}. {entry.name}</span>
                        <span className="font-medium text-[var(--text-primary)]">{entry.completions}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      </PageBody>
    </div>
  );
}

function hrefForAssignment(item: { type: string; targetId: string }): string {
  if (item.type === "COURSE") return `/courses/${item.targetId}`;
  if (item.type === "SOP") return `/sops/${item.targetId}`;
  return `/paths/${item.targetId}`;
}
