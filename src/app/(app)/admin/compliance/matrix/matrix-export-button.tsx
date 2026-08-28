"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { exportMatrixCsvAction } from "@/app/(app)/admin/compliance/matrix/actions";
import type { MatrixFilters } from "@/lib/services/matrix";

export function MatrixExportButton({ rowMode, filters }: { rowMode: "people" | "positions"; filters: MatrixFilters }) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await exportMatrixCsvAction({ rowMode, filters });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const blob = new Blob([result.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `training-matrix-${rowMode}-${new Date().toISOString().slice(0, 10)}.csv`;
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
