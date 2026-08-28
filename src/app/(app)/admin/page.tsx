import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guard";
import { getAdminDashboard } from "@/lib/services/dashboard";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { StatTile } from "@/components/charts/stat-tile";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { STATUS_COLORS } from "@/components/charts/tokens";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export default async function AdminDashboardPage() {
  const actor = await requireAnyPermission(["reports.view", "settings.view"]);
  const data = await getAdminDashboard(actor);

  const activityDates = data.activityOverTime.map((d) => new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));

  return (
    <div>
      <PageHeader title="Admin dashboard" description="Organization-wide training, content, and compliance status." />
      <PageBody className="flex flex-col gap-8">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Overall completion" value={data.overallCompletionRate} unit="%" tone={data.overallCompletionRate >= 80 ? "good" : "warning"} />
          <StatTile label="Overdue assignments" value={data.overdueCount} tone={data.overdueCount > 0 ? "critical" : "good"} />
          <StatTile label="New hires onboarding" value={data.newHiresOnboarding} description="Started in the last 30 days" />
          <StatTile label="Quiz failure rate" value={data.quizFailureRate} unit="%" tone={data.quizFailureRate > 25 ? "critical" : "neutral"} />
          <StatTile label="Certificates expiring" value={data.certificatesExpiringCount} description="Within 60 days" tone={data.certificatesExpiringCount > 0 ? "warning" : "good"} />
          <StatTile label="Compliance rate" value={data.compliance.overallCompletionRate} unit="%" description={`${data.compliance.activeRules} active rules`} />
        </section>

        <section>
          <SectionHeading title="Training activity" description="Completions recorded per day, last 30 days." />
          <LineChart
            title="Training completions over time"
            categories={activityDates}
            series={[{ key: "completions", label: "Completions", values: data.activityOverTime.map((d) => d.count) }]}
          />
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <SectionHeading title="Course performance" description="Lowest completion rates among assigned courses." />
            {data.coursePerformance.length === 0 ? (
              <EmptyState icon={<Icon name="training" className="h-5 w-5" />} title="No assigned courses yet" />
            ) : (
              <BarChart
                title="Course completion rate"
                categories={data.coursePerformance.map((c) => c.title)}
                series={[{ key: "rate", label: "Completion rate", values: data.coursePerformance.map((c) => c.completionRate) }]}
                unit="%"
              />
            )}
          </section>

          <section>
            <SectionHeading title="SOP review status" description="Published SOPs by review currency." />
            <DonutChart
              title="SOP review status"
              centerLabel="SOPs"
              slices={[
                { key: "current", label: "Current", value: data.sopReviewStatus.current, color: STATUS_COLORS.good },
                { key: "dueSoon", label: "Due within 30 days", value: data.sopReviewStatus.dueSoon, color: STATUS_COLORS.warning },
                { key: "overdue", label: "Overdue", value: data.sopReviewStatus.overdue, color: STATUS_COLORS.critical },
              ]}
            />
          </section>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <SectionHeading title="Highest quiz failure rates" description="Quizzes with at least 3 attempts." actions={<Link href="/admin/content" className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">View content health</Link>} />
            {data.topFailingQuizzes.length === 0 ? (
              <EmptyState icon={<Icon name="training" className="h-5 w-5" />} title="No quiz failures to show" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.topFailingQuizzes.map((q, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{q.title}</span>
                    <Badge tone="danger">{q.value}%</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title="Content health" description="Live counts from the Content Health dashboard." />
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent>
                  <p className="text-[0.75rem] text-[var(--text-muted)]">No owner</p>
                  <p className="mt-1 text-[1.25rem] font-semibold text-[var(--text-primary)]">{data.contentHealth.noOwnerCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <p className="text-[0.75rem] text-[var(--text-muted)]">Broken links</p>
                  <p className="mt-1 text-[1.25rem] font-semibold text-danger-700">{data.contentHealth.brokenLinksCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <p className="text-[0.75rem] text-[var(--text-muted)]">Most reported</p>
                  <p className="mt-1 text-[1.25rem] font-semibold text-warning-700">{data.contentHealth.mostReportedCount}</p>
                </CardContent>
              </Card>
            </div>
            <Link href="/admin/content" className="mt-3 inline-block text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">
              Open Content Health →
            </Link>
          </section>
        </div>

        <section>
          <SectionHeading title="AI generation activity" description="Last 30 days." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Questions asked" value={data.aiActivity.questionsAsked} />
            <StatTile label="Searches performed" value={data.aiActivity.searchesPerformed} />
            <StatTile label="AI jobs completed" value={data.aiActivity.aiJobsCompleted} tone="good" />
            <StatTile label="AI jobs failed" value={data.aiActivity.aiJobsFailed} tone={data.aiActivity.aiJobsFailed > 0 ? "critical" : "neutral"} />
          </div>
        </section>
      </PageBody>
    </div>
  );
}
