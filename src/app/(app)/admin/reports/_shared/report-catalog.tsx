import Link from "next/link";
import type { ReportDefinition } from "@/lib/services/reports";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Shared catalog grid rendered by both /reports and /admin/reports. */
export function ReportCatalog({ reports }: { reports: ReportDefinition[] }) {
  const byCategory = new Map<string, ReportDefinition[]>();
  for (const report of reports) {
    byCategory.set(report.category, [...(byCategory.get(report.category) ?? []), report]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byCategory.entries()].map(([category, items]) => (
        <div key={category}>
          <h2 className="mb-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{category}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((report) => (
              <Link key={report.key} href={`/admin/reports/${report.key}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
                <Card className="h-full transition-colors hover:border-[var(--border-strong)]">
                  <CardContent className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>{report.name}</CardTitle>
                      <Badge tone="neutral">{report.filters.length} filter{report.filters.length === 1 ? "" : "s"}</Badge>
                    </div>
                    <CardDescription>{report.description}</CardDescription>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
