"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { toggleFavoriteAction } from "@/app/(app)/sops/actions";

export function FavoriteButton({
  sopId,
  initialFavorited,
  variant = "icon",
}: {
  sopId: string;
  initialFavorited: boolean;
  variant?: "icon" | "labeled";
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const optimistic = !favorited;
    setFavorited(optimistic);
    startTransition(async () => {
      const result = await toggleFavoriteAction(sopId);
      if (!result.ok) {
        setFavorited(!optimistic);
        toast.error(result.error);
        return;
      }
      setFavorited(result.data.favorited);
      toast.success(result.data.favorited ? "Added to favorites" : "Removed from favorites");
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={variant === "icon" ? "icon" : "sm"}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      onClick={toggle}
      disabled={pending}
    >
      <Glyph name={favorited ? "star-filled" : "star"} className={favorited ? "h-4 w-4 text-signal-500" : "h-4 w-4"} />
      {variant === "labeled" && (favorited ? "Favorited" : "Favorite")}
    </Button>
  );
}
