"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { EntityType } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Glyph } from "@/components/icons";
import { removeFavoriteAction } from "@/app/(app)/favorites/actions";

export interface FavoriteRow {
  entityType: EntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export function FavoritesClient({ initial }: { initial: FavoriteRow[] }) {
  const [items, setItems] = React.useState(initial);

  const remove = async (row: FavoriteRow) => {
    setItems((prev) => prev.filter((i) => !(i.entityType === row.entityType && i.entityId === row.entityId)));
    const result = await removeFavoriteAction(row.entityType, row.entityId);
    if (!result.ok) {
      setItems((prev) => [...prev, row]);
      toast.error(result.error);
    }
  };

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={`${item.entityType}-${item.entityId}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3.5">
          <Link href={item.href} className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{item.entityType}</Badge>
              <p className="truncate font-medium text-[var(--text-primary)]">{item.title}</p>
            </div>
            {item.subtitle && <p className="mt-0.5 truncate text-[0.8125rem] text-[var(--text-muted)]">{item.subtitle}</p>}
          </Link>
          <button
            type="button"
            onClick={() => void remove(item)}
            aria-label={`Remove ${item.title} from favorites`}
            className="shrink-0 rounded-md p-1.5 text-signal-500 hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <Glyph name="star-filled" className="h-4.5 w-4.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
