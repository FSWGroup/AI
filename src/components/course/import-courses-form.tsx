"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { importCoursesAction } from "@/app/(app)/admin/training/actions";

export function ImportCoursesForm() {
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState("title,description,category,difficulty,estimatedMinutes\n");
  const [loading, setLoading] = React.useState(false);

  if (!open) {
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Glyph name="upload" className="h-4 w-4" />
          Import
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import courses</CardTitle>
        <CardDescription>
          Paste CSV with a header row: title, description, category, difficulty, estimatedMinutes. Each row creates a
          draft course you can build out afterward.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} className="font-mono text-[0.75rem]" />
        <div className="flex gap-2">
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              const result = await importCoursesAction(csv);
              setLoading(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(`Imported ${result.data.imported} course${result.data.imported === 1 ? "" : "s"}${result.data.failed ? `, ${result.data.failed} failed` : ""}.`);
              setOpen(false);
            }}
          >
            Import
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
