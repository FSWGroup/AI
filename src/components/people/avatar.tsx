import { initials } from "@/lib/utils";

/**
 * Avatar with an initials fallback. A plain `<img>` (not next/image) since the
 * image path comes from user-uploaded media on a host this component can't
 * assume is configured for Next's image optimizer.
 */
export function PersonAvatar({
  name,
  image,
  size = 36,
  className,
}: {
  name: string;
  image?: string | null;
  size?: number;
  className?: string;
}) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] font-semibold text-[var(--text-secondary)] ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}
