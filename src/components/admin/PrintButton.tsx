"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg border border-navy-200 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50"
    >
      Print / Save as PDF
    </button>
  );
}
