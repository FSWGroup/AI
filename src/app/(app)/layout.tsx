import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getActor } from "@/lib/auth/guard";
import { buildNavigation, QUICK_CREATE } from "@/lib/navigation";
import { getSettings } from "@/lib/settings";
import { getUnreadCount } from "@/lib/notifications";

/**
 * Authenticated application layout.
 *
 * Resolves the actor once, builds the permission-filtered navigation, and hands
 * everything to the client shell. Individual pages still enforce their own
 * permissions — this layout only decides what is offered.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  const [settings, unreadCount] = await Promise.all([getSettings(), getUnreadCount(actor.id)]);

  const sections = buildNavigation(actor.permissions as Set<string>);

  const createActions = QUICK_CREATE.filter((item) => actor.permissions.has(item.permission)).map(
    ({ label, href }) => ({ label, href }),
  );

  // Quick actions surfaced in the command palette, filtered by capability.
  const quickActions = [
    { label: "Go to my training", href: "/my-training", keywords: "assignments due training" },
    { label: "Browse the catalog", href: "/catalog", keywords: "courses catalog enroll" },
    { label: "Open SOP library", href: "/sops", keywords: "sop procedures policy library" },
    { label: "Ask FSW AI", href: "/ask", keywords: "ai question answer help" },
    { label: "My certificates", href: "/certificates", keywords: "certificate proof completion" },
    { label: "My transcript", href: "/transcript", keywords: "transcript history record" },
    { label: "Training calendar", href: "/calendar", keywords: "calendar dates deadlines sessions" },
    ...(actor.permissions.has("team.view")
      ? [
          { label: "This week with your team", href: "/team/brief", keywords: "brief coaching manager week" },
          { label: "Team training status", href: "/team/status", keywords: "team manager status" },
          { label: "Knowledge risk", href: "/team/knowledge-risk", keywords: "risk succession single point failure skills" },
        ]
      : []),
    ...(actor.permissions.has("training.create")
      ? [{ label: "Create a course", href: "/admin/training/new", keywords: "new course build" }]
      : []),
    ...(actor.permissions.has("sop.create")
      ? [{ label: "Create an SOP", href: "/admin/sops/new", keywords: "new sop procedure write" }]
      : []),
    ...(actor.permissions.has("ai.video")
      ? [{ label: "Create an AI video", href: "/admin/video-studio/new", keywords: "video ai studio" }]
      : []),
    ...(actor.permissions.has("training.assign")
      ? [{ label: "Assign training", href: "/admin/training/assign", keywords: "assign bulk people" }]
      : []),
    ...(actor.permissions.has("reports.view")
      ? [{ label: "Open reports", href: "/reports", keywords: "report export data" }]
      : []),
  ];

  return (
    <AppShell
      sections={sections}
      appName={settings.brand.appName}
      user={{
        id: actor.id,
        name: actor.name,
        email: actor.email,
        image: actor.image,
        title: null,
      }}
      unreadCount={unreadCount}
      quickActions={quickActions}
      createActions={createActions}
    >
      {children}
    </AppShell>
  );
}
