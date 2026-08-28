import { requirePermission } from "@/lib/auth/guard";
import { listMedia } from "@/lib/services/media";
import { PageHeader, PageBody } from "@/components/page-header";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MediaLibraryClient } from "@/app/(app)/admin/media/media-library-client";
import Link from "next/link";
import type { MediaKind } from "@prisma/client";

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requirePermission("media.view");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const { items, total, pageSize } = await listMedia({
    kind: params.kind as MediaKind | undefined,
    q: params.q,
    page,
    pageSize: 24,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader title="Media library" description="Every uploaded image, video, audio file, and document." crumbs={[{ label: "Admin", href: "/admin" }, { label: "Media" }]} />
      <PageBody className="flex flex-col gap-4">
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
          <Field label="Search" htmlFor="media-q" className="min-w-[14rem]">
            <Input id="media-q" name="q" defaultValue={params.q} placeholder="Filename, title, or alt text" />
          </Field>
          <Field label="Kind" htmlFor="media-kind">
            <Select id="media-kind" name="kind" defaultValue={params.kind ?? ""}>
              <option value="">All kinds</option>
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
              <option value="AUDIO">Audio</option>
              <option value="DOCUMENT">Document</option>
              <option value="GENERATED">AI generated</option>
            </Select>
          </Field>
          <Button type="submit">Filter</Button>
          <Link href="/admin/media" className="text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline">
            Clear
          </Link>
        </form>

        <MediaLibraryClient
          items={items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
          canUpload={actor.permissions.has("media.upload")}
          canDelete={actor.permissions.has("media.delete")}
        />

        {totalPages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between text-[0.8125rem]">
            <p className="text-[var(--text-muted)]">
              Page {page} of {totalPages} · {total} files
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/admin/media?${new URLSearchParams({ ...params, page: String(page - 1) } as Record<string, string>).toString()}`} className="rounded-md border border-[var(--border-default)] px-3 py-1.5 hover:bg-[var(--surface-sunken)]">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/admin/media?${new URLSearchParams({ ...params, page: String(page + 1) } as Record<string, string>).toString()}`} className="rounded-md border border-[var(--border-default)] px-3 py-1.5 hover:bg-[var(--surface-sunken)]">
                  Next
                </Link>
              )}
            </div>
          </nav>
        )}
      </PageBody>
    </div>
  );
}
