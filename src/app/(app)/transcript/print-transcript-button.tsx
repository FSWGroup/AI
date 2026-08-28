"use client";

import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";

export function PrintTranscriptButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Glyph name="download" className="h-4 w-4" /> Print / Save as PDF
    </Button>
  );
}
