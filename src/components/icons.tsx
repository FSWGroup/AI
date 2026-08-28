import type { IconName } from "@/lib/navigation";

/**
 * Original line-icon set drawn for FSW Academy.
 *
 * Deliberately geometric and industrial: 1.6 stroke, square-ish terminals, no
 * rounded-cartoon shapes. All icons are decorative (aria-hidden); meaning is
 * always carried by adjacent text.
 */

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.2V20h13V9.2M9.75 20v-5.5h4.5V20",
  training: "M4 5.5h11.5a2 2 0 0 1 2 2V20H6a2 2 0 0 1-2-2V5.5Zm13.5 2h2.5V18M8 9h6M8 12.5h6M8 16h3.5",
  path: "M6 4.5h5.5v5H6zM12.5 14.5H18v5h-5.5zM8.75 9.5v3.5a2 2 0 0 0 2 2h1.75",
  knowledge: "M4 6.5c2.5-1.5 5-1.5 8 0 3-1.5 5.5-1.5 8 0V19c-2.5-1.5-5-1.5-8 0-3-1.5-5.5-1.5-8 0V6.5ZM12 6.5V19",
  sop: "M7 3.5h7.5L18 7v13.5H7zM14 3.5V7h4M9.75 11h6M9.75 14.5h6M9.75 18h3.5",
  certificate: "M5 4.5h14v10H5zM8.5 8h7M8.5 11h4.5M12 14.5v3M9 20.5l3-3 3 3",
  skill: "M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85z",
  people:
    "M8.5 11a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM3.5 19.5c0-2.9 2.24-4.75 5-4.75s5 1.85 5 4.75M16 6.1a2.6 2.6 0 0 1 0 4.9M17.5 15.2c1.9.55 3 2.05 3 4.3",
  ai: "M12 3.5v3M12 17.5v3M4.6 7.75l2.6 1.5M16.8 14.75l2.6 1.5M4.6 16.25l2.6-1.5M16.8 9.25l2.6-1.5M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  team: "M9 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4 19c0-2.65 2.1-4.5 5-4.5s5 1.85 5 4.5M16.5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16 14.6c2.15.4 3.5 1.95 3.5 4.4",
  status: "M4 20V4M4 17h4.5v-4H4M8.5 13h5V9h-5M13.5 9h5.5V5h-5.5M4 20h16",
  assignment: "M8 4.5h8v3H8zM6 7.5h12V20H6zM9.5 12l1.75 1.75L15 10.5M9.5 16.5h5",
  matrix: "M4 4.5h16v15H4zM4 9.5h16M4 14.5h16M9.5 4.5v15M15 4.5v15",
  approval: "M4.5 12.5 9 17l10.5-10M4.5 18.5h6",
  report: "M6 3.5h9L19 7v13.5H6zM15 3.5V7h4M9 16.5v-3M12 16.5v-5.5M15 16.5v-2",
  dashboard: "M4 4.5h7v6H4zM13 4.5h7v3.5h-7zM13 10.5h7v9h-7zM4 12.5h7v7H4z",
  compliance:
    "M12 3.5 5 6v6c0 4.3 3 7.4 7 8.5 4-1.1 7-4.2 7-8.5V6l-7-2.5ZM9.25 12l2 2 3.5-3.75",
  content: "M5 4.5h14v15H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4",
  studio: "M12 3.5a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0v-3a4 4 0 0 1 4-4ZM5.5 11.5c0 3.6 2.9 6.5 6.5 6.5s6.5-2.9 6.5-6.5M12 18v3M8.5 21h7",
  video: "M4 6.5h10.5v11H4zM14.5 10l5.5-3v10l-5.5-3z",
  org: "M9.5 3.5h5v4h-5zM3.5 16.5h5v4h-5zM15.5 16.5h5v4h-5zM12 7.5v4M6 16.5v-2.5h12v2.5",
  integration:
    "M9 4.5h6v4H9zM4 15.5h6v4H4zM14 15.5h6v4h-6zM12 8.5v3M7 15.5V13a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2.5",
  settings:
    "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm7.5 3c0-.5-.05-1-.15-1.45l1.9-1.3-1.75-3-2.2.85a7.4 7.4 0 0 0-2.5-1.45L14.5 3h-5l-.3 2.65c-.9.3-1.75.8-2.5 1.45L4.5 6.25l-1.75 3 1.9 1.3c-.1.45-.15.95-.15 1.45s.05 1 .15 1.45l-1.9 1.3 1.75 3 2.2-.85c.75.65 1.6 1.15 2.5 1.45L9.5 21h5l.3-2.65c.9-.3 1.75-.8 2.5-1.45l2.2.85 1.75-3-1.9-1.3c.1-.45.15-.95.15-1.45Z",
  audit: "M6 3.5h9L19 7v13.5H6zM15 3.5V7h4M9 11h4M9 14.5h6M9 18h3M15.5 12.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM17.4 16.4 19.5 18.5",
  calendar: "M4.5 6.5h15V20h-15zM4.5 11h15M8.5 4v4M15.5 4v4M8.5 14.5h2M13.5 14.5h2M8.5 17.5h2",
  media: "M4 5.5h16v13H4zM4 14l4-4 3.5 3.5 3-2.5L20 15M15.5 9.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z",
  announcement:
    "M5 10.5v3l3 .5 2 5h2l-1.5-4.75L19 16V8l-8.5 2.25L5 10.5ZM19 10.5a2 2 0 0 1 0 3",
};

export function Icon({
  name,
  className = "h-4.5 w-4.5",
  strokeWidth = 1.6,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Small utility glyphs used outside navigation. */
export function Glyph({
  name,
  className = "h-4 w-4",
}: {
  name:
    | "search"
    | "bell"
    | "plus"
    | "chevron-down"
    | "chevron-right"
    | "chevron-left"
    | "check"
    | "x"
    | "menu"
    | "external"
    | "download"
    | "upload"
    | "filter"
    | "star"
    | "star-filled"
    | "clock"
    | "alert"
    | "info"
    | "play"
    | "trash"
    | "edit"
    | "copy"
    | "eye"
    | "lock"
    | "sparkle"
    | "drag"
    | "arrow-right"
    | "arrow-left"
    | "more";
  className?: string;
}) {
  const glyphs: Record<string, string> = {
    search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20",
    bell: "M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0 0 12 3.5ZM10 17.5a2 2 0 0 0 4 0",
    plus: "M12 5v14M5 12h14",
    "chevron-down": "M6 9.5 12 15.5 18 9.5",
    "chevron-right": "M9.5 6 15.5 12 9.5 18",
    "chevron-left": "M14.5 6 8.5 12 14.5 18",
    check: "M5 12.5 9.5 17 19 7",
    x: "M6 6 18 18M18 6 6 18",
    menu: "M4 7h16M4 12h16M4 17h16",
    external: "M14 4.5h5.5V10M19.5 4.5 12 12M17 14v5.5H4.5V7H10",
    download: "M12 4v11M7.5 11 12 15.5 16.5 11M4.5 19.5h15",
    upload: "M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 19.5h15",
    filter: "M4 6h16M7 12h10M10 18h4",
    star: "M12 4l2.35 4.8 5.3.75-3.85 3.75.9 5.3L12 16.1l-4.7 2.5.9-5.3L4.35 9.55l5.3-.75z",
    "star-filled": "M12 4l2.35 4.8 5.3.75-3.85 3.75.9 5.3L12 16.1l-4.7 2.5.9-5.3L4.35 9.55l5.3-.75z",
    clock: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM12 8v4.5l3 1.75",
    alert: "M12 4 21 19.5H3L12 4ZM12 10v4M12 16.5v.5",
    info: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM12 8v.5M12 11.5V16",
    play: "M8 5.5 18.5 12 8 18.5z",
    trash: "M4.5 7h15M9 7V4.5h6V7M6.5 7l1 12.5h9L17.5 7M10 10.5v6M14 10.5v6",
    edit: "M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5zM15 7l2 2",
    copy: "M8.5 8.5h11V20h-11zM15.5 8.5V4.5h-11v11h4",
    eye: "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 2.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z",
    lock: "M6.5 11h11v9h-11zM9 11V8a3 3 0 0 1 6 0v3M12 14.5v2.5",
    sparkle: "M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z",
    drag: "M9 6.5h.5M9 12h.5M9 17.5h.5M14.5 6.5h.5M14.5 12h.5M14.5 17.5h.5",
    "arrow-right": "M4.5 12h15M14 6.5 19.5 12 14 17.5",
    "arrow-left": "M19.5 12h-15M10 6.5 4.5 12 10 17.5",
    more: "M6 12h.5M12 12h.5M18 12h.5",
  };

  const filled = name === "star-filled";

  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={glyphs[name] ?? ""} />
    </svg>
  );
}

/** FSW wordmark. Original geometric treatment — an app identity, not a logo copy. */
export function FswMark({
  appName,
  className = "",
  collapsed = false,
}: {
  appName: string;
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-white/12 ring-1 ring-inset ring-white/25"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
          {/* Three ascending bars: build, grow, mastery. */}
          <rect x="3.5" y="14" width="4" height="6.5" fill="currentColor" opacity="0.7" />
          <rect x="10" y="9.5" width="4" height="11" fill="currentColor" opacity="0.85" />
          <rect x="16.5" y="4" width="4" height="16.5" fill="currentColor" />
        </svg>
      </span>
      {!collapsed && (
        <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-white">
          {appName}
        </span>
      )}
    </span>
  );
}
