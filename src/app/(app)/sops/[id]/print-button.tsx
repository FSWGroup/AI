"use client";

import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";

export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <Glyph name="download" className="h-3.5 w-3.5" />
      Print
    </Button>
  );
}
