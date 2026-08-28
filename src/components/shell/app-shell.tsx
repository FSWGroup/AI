"use client";

import { Sidebar, useSidebarState } from "@/components/shell/sidebar";
import { Topbar, type TopbarUser } from "@/components/shell/topbar";
import type { QuickAction } from "@/components/shell/command-palette";
import type { NavSection } from "@/lib/navigation";

/**
 * Client shell that owns the mobile drawer state shared between the sidebar and
 * the topbar menu button. Data comes pre-resolved from the server layout.
 */
export function AppShell({
  sections,
  appName,
  user,
  unreadCount,
  quickActions,
  createActions,
  children,
}: {
  sections: NavSection[];
  appName: string;
  user: TopbarUser;
  unreadCount: number;
  quickActions: QuickAction[];
  createActions: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  const sidebar = useSidebarState();

  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Sidebar
        sections={sections}
        appName={appName}
        mobileOpen={sidebar.mobileOpen}
        onMobileClose={sidebar.close}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          unreadCount={unreadCount}
          quickActions={quickActions}
          createActions={createActions}
          onOpenSidebar={sidebar.open}
        />
        <main id="main-content" className="flex-1 focus:outline-none" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
