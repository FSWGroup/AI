"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { exportTeamStatusCsvAction } from "@/app/(app)/team/status/actions";
import type { MatrixFilters } from "@/lib/services/matrix";

export function TeamStatusExportButton({ filters }: { filters: MatrixFilters }) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await exportTeamStatusCsvAction(filters);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const blob = new Blob([result.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `team-training-status-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button variant="outline" onClick={run} loading={pending}>
      <Glyph name="download" className="h-4 w-4" /> Export CSV
    </Button>
  );
}
