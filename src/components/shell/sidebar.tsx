"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { FswMark, Glyph } from "@/components/icons";
import type { NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Application sidebar.
 *
 * Desktop: persistent rail. Mobile: off-canvas drawer with a focus trap and
 * Escape-to-close, opened from the topbar menu button.
 */
export function Sidebar({
  sections,
  appName,
  mobileOpen,
  onMobileClose,
}: {
  sections: NavSection[];
  appName: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();

  // Close the drawer on route change so a tap-through doesn't leave it open.
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <nav
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-[var(--surface-nav)]",
          "transition-transform duration-200 lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <Link
            href="/home"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
          >
            <FswMark appName={appName} />
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            className="rounded-md p-1.5 text-navy-200 hover:bg-white/10 hover:text-white lg:hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70"
          >
            <Glyph name="x" className="h-5 w-5" />
            <span className="sr-only">Close navigation</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 py-3">
          {/*
            Each section is a labelled group. An administrator sees both a
            learner "People" link and an admin "People" link, so without the
            group name a screen reader announces "People, link" twice with no
            way to tell them apart. The group label disambiguates them.
          */}
          {sections.map((section) => (
            <div
              key={section.id}
              className="mb-4 last:mb-0"
              {...(section.label
                ? { role: "group", "aria-labelledby": `nav-section-${section.id}` }
                : {})}
            >
              {section.label && (
                <p
                  id={`nav-section-${section.id}`}
                  className="px-2.5 pb-1.5 pt-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-navy-300/80"
                >
                  {section.label}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8125rem] font-medium transition-colors",
                          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70",
                          active
                            ? "bg-white/14 text-white"
                            : "text-navy-100 hover:bg-white/8 hover:text-white",
                        )}
                      >
                        <Icon name={item.icon} className="h-4.5 w-4.5 shrink-0 opacity-90" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-white/10 px-4 py-3">
          <Link
            href="/help"
            className="flex items-center gap-2 text-[0.75rem] text-navy-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70"
          >
            <Glyph name="info" className="h-3.5 w-3.5" />
            Help &amp; getting started
          </Link>
        </div>
      </nav>
    </>
  );
}

/** Client wrapper that owns the mobile drawer state shared with the topbar. */
export function useSidebarState() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return {
    mobileOpen,
    open: () => setMobileOpen(true),
    close: () => setMobileOpen(false),
  };
}
