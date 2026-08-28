import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph } from "@/components/icons";
import { FavoritesClient, type FavoriteRow } from "@/app/(app)/favorites/favorites-client";

export default async function FavoritesPage() {
  const actor = await requireActor();
  const favorites = await prisma.favorite.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" } });

  const sopIds = favorites.filter((f) => f.entityType === "SOP" || f.entityType === "POLICY").map((f) => f.entityId);
  const courseIds = favorites.filter((f) => f.entityType === "COURSE").map((f) => f.entityId);
  const pathIds = favorites.filter((f) => f.entityType === "LEARNING_PATH").map((f) => f.entityId);
  const mediaIds = favorites.filter((f) => f.entityType === "MEDIA").map((f) => f.entityId);

  const [sops, courses, paths, media] = await Promise.all([
    sopIds.length ? prisma.sop.findMany({ where: { id: { in: sopIds } }, select: { id: true, title: true, sopCode: true, category: true } }) : [],
    courseIds.length ? prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true, category: true } }) : [],
    pathIds.length ? prisma.learningPath.findMany({ where: { id: { in: pathIds } }, select: { id: true, title: true } }) : [],
    mediaIds.length ? prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } }, select: { id: true, filename: true, title: true, kind: true } }) : [],
  ]);

  const sopById = new Map(sops.map((s) => [s.id, s]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const pathById = new Map(paths.map((p) => [p.id, p]));
  const mediaById = new Map(media.map((m) => [m.id, m]));

  const rows: FavoriteRow[] = [];
  for (const fav of favorites) {
    if (fav.entityType === "SOP" || fav.entityType === "POLICY") {
      const sop = sopById.get(fav.entityId);
      if (sop) rows.push({ entityType: fav.entityType, entityId: fav.entityId, title: `${sop.sopCode} — ${sop.title}`, subtitle: sop.category, href: `/sops/${sop.id}` });
    } else if (fav.entityType === "COURSE") {
      const course = courseById.get(fav.entityId);
      if (course) rows.push({ entityType: fav.entityType, entityId: fav.entityId, title: course.title, subtitle: course.category, href: `/courses/${course.id}` });
    } else if (fav.entityType === "LEARNING_PATH") {
      const path = pathById.get(fav.entityId);
      if (path) rows.push({ entityType: fav.entityType, entityId: fav.entityId, title: path.title, subtitle: "Learning path", href: `/paths/${path.id}` });
    } else if (fav.entityType === "MEDIA") {
      const asset = mediaById.get(fav.entityId);
      if (asset) rows.push({ entityType: fav.entityType, entityId: fav.entityId, title: asset.title ?? asset.filename, subtitle: asset.kind, href: `/media/${asset.id}` });
    }
  }

  return (
    <div>
      <PageHeader title="Favorites" description="SOPs, courses, learning paths, and documents you've starred for quick access." />
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Glyph name="star" className="h-5 w-5" />}
            title="No favorites yet"
            description="Star an SOP, course, or document from its page to find it here quickly."
          />
        ) : (
          <FavoritesClient initial={rows} />
        )}
      </PageBody>
    </div>
  );
}
