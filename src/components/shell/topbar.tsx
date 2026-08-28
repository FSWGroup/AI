"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut as nextAuthSignOut } from "next-auth/react";
import { Glyph } from "@/components/icons";
import { CommandPalette, type QuickAction } from "@/components/shell/command-palette";
import { cn, initials } from "@/lib/utils";

export interface TopbarUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  title: string | null;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

/** Dropdown that closes on outside click and Escape, and restores focus. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

export function Topbar({
  user,
  unreadCount,
  quickActions,
  createActions,
  onOpenSidebar,
}: {
  user: TopbarUser;
  unreadCount: number;
  quickActions: QuickAction[];
  createActions: { label: string; href: string }[];
  onOpenSidebar: () => void;
}) {
  const router = useRouter();
  const profile = useDropdown();
  const create = useDropdown();
  const bell = useDropdown();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(unreadCount);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setUnread(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!bell.open) return;
    setLoadingNotifications(true);
    fetch("/api/notifications?limit=10")
      .then((r) => (r.ok ? r.json() : { notifications: [] }))
      .then((data: { notifications: NotificationItem[] }) => setNotifications(data.notifications))
      .catch(() => setNotifications([]))
      .finally(() => setLoadingNotifications(false));
  }, [bell.open]);

  const markAllRead = async () => {
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (response.ok) {
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      router.refresh();
    }
  };

  const openNotification = async (item: NotificationItem) => {
    if (!item.readAt) {
      await fetch(`/api/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
      setUnread((count) => Math.max(0, count - 1));
    }
    bell.setOpen(false);
    if (item.linkUrl) router.push(item.linkUrl);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 sm:px-4">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="-ml-1 rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] lg:hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]"
      >
        <Glyph name="menu" className="h-5 w-5" />
        <span className="sr-only">Open navigation</span>
      </button>

      <div className="flex flex-1 items-center gap-2">
        <CommandPalette quickActions={quickActions} />
      </div>

      <div className="flex items-center gap-1.5">
        {createActions.length > 0 && (
          <div ref={create.ref} className="relative">
            <button
              type="button"
              onClick={() => create.setOpen((o) => !o)}
              aria-expanded={create.open}
              aria-haspopup="menu"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--brand-primary)] px-3 text-[0.8125rem]",
                "font-medium text-white hover:bg-[var(--brand-primary-hover)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              )}
            >
              <Glyph name="plus" className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </button>

            {create.open && (
              <div
                role="menu"
                aria-label="Create"
                className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] py-1 shadow-lg"
              >
                {createActions.map((action) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    role="menuitem"
                    onClick={() => create.setOpen(false)}
                    className="block px-3.5 py-2 text-[0.8125rem] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={bell.ref} className="relative">
          <button
            type="button"
            onClick={() => bell.setOpen((o) => !o)}
            aria-expanded={bell.open}
            aria-haspopup="dialog"
            className="relative rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]"
          >
            <Glyph name="bell" className="h-5 w-5" />
            <span className="sr-only">
              Notifications{unread > 0 ? ` (${unread} unread)` : ""}
            </span>
            {unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[0.625rem] font-semibold text-white"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {bell.open && (
            <div
              role="dialog"
              aria-label="Notifications"
              className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2.5">
                <p className="text-[0.8125rem] font-semibold">Notifications</p>
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-[0.75rem] font-medium text-[var(--brand-secondary)] hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto">
                {loadingNotifications && (
                  <p className="px-3.5 py-6 text-center text-[0.8125rem] text-[var(--text-muted)]">
                    Loading…
                  </p>
                )}
                {!loadingNotifications && notifications.length === 0 && (
                  <p className="px-3.5 py-6 text-center text-[0.8125rem] text-[var(--text-muted)]">
                    You&apos;re all caught up.
                  </p>
                )}
                {notifications.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openNotification(item)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-b border-[var(--border-subtle)] px-3.5 py-2.5 text-left last:border-0",
                      "hover:bg-[var(--surface-sunken)]",
                      !item.readAt && "bg-fswblue-50/60",
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      {!item.readAt && (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-secondary)]"
                        />
                      )}
                      <span className="flex-1 text-[0.8125rem] font-medium text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      {!item.readAt && <span className="sr-only">(unread)</span>}
                    </span>
                    {item.body && (
                      <span className="line-clamp-2 text-[0.75rem] text-[var(--text-muted)]">
                        {item.body}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <Link
                href="/notifications"
                onClick={() => bell.setOpen(false)}
                className="block border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3.5 py-2 text-center text-[0.75rem] font-medium text-[var(--brand-secondary)] hover:underline"
              >
                View all notifications
              </Link>
            </div>
          )}
        </div>

        <div ref={profile.ref} className="relative">
          <button
            type="button"
            onClick={() => profile.setOpen((o) => !o)}
            aria-expanded={profile.open}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-md p-1 hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]"
          >
            <Avatar name={user.name} image={user.image} size={30} />
            <Glyph name="chevron-down" className="hidden h-3.5 w-3.5 text-[var(--text-muted)] sm:block" />
            <span className="sr-only">Your account</span>
          </button>

          {profile.open && (
            <div
              role="menu"
              aria-label="Account"
              className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] shadow-lg"
            >
              <div className="border-b border-[var(--border-subtle)] px-3.5 py-3">
                <p className="truncate text-[0.8125rem] font-semibold">{user.name}</p>
                <p className="truncate text-[0.75rem] text-[var(--text-muted)]">{user.email}</p>
                {user.title && (
                  <p className="mt-0.5 truncate text-[0.75rem] text-[var(--text-muted)]">
                    {user.title}
                  </p>
                )}
              </div>
              <div className="py-1">
                {[
                  { label: "My profile", href: `/people/${user.id}` },
                  { label: "My transcript", href: "/transcript" },
                  { label: "Favorites", href: "/favorites" },
                  { label: "Notification settings", href: "/settings/notifications" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => profile.setOpen(false)}
                    className="block px-3.5 py-2 text-[0.8125rem] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              {/*
                Uses the Auth.js client helper rather than posting the form
                directly: the sign-out endpoint requires a CSRF token, and a
                bare POST is rejected — leaving the person signed in while the
                menu closes as though it worked.
              */}
              <div className="border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSigningOut(true);
                    void nextAuthSignOut({ callbackUrl: "/sign-in", redirect: true });
                  }}
                  disabled={signingOut}
                  className="w-full px-3.5 py-2.5 text-left text-[0.8125rem] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] disabled:opacity-60"
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function Avatar({
  name,
  image,
  size = 32,
}: {
  name: string;
  image: string | null;
  size?: number;
}) {
  if (image) {
    return (
       
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-semibold text-navy-800"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}
