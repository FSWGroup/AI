import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";

/** Query-string pagination bar shared by every server-paginated list in this module. */
export function Pagination({
  basePath,
  searchParams,
  page,
  totalPages,
  total,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  total: number;
}) {
  if (totalPages <= 1) return null;

  function hrefFor(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    params.set("page", String(target));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      <p className="text-[0.8125rem] text-[var(--text-muted)]">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex items-center gap-2">
        <Link aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none" : undefined} href={hrefFor(page - 1)}>
          <Button variant="outline" size="sm" disabled={page <= 1}>
            <Glyph name="chevron-left" className="h-4 w-4" /> Previous
          </Button>
        </Link>
        <Link
          aria-disabled={page >= totalPages}
          className={page >= totalPages ? "pointer-events-none" : undefined}
          href={hrefFor(page + 1)}
        >
          <Button variant="outline" size="sm" disabled={page >= totalPages}>
            Next <Glyph name="chevron-right" className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </nav>
  );
}
