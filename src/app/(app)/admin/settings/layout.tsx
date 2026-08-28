import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/guard";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsNav } from "@/app/(app)/admin/settings/_shared/settings-nav";

const SECTIONS = [
  { href: "/admin/settings/organization", label: "Organization" },
  { href: "/admin/settings/brand", label: "Brand" },
  { href: "/admin/settings/languages", label: "Languages" },
  { href: "/admin/settings/notifications", label: "Notifications" },
  { href: "/admin/settings/training", label: "Training defaults" },
  { href: "/admin/settings/content-review", label: "Content review defaults" },
  { href: "/admin/settings/compliance", label: "Compliance" },
  { href: "/admin/settings/ai", label: "AI providers" },
  { href: "/admin/settings/video", label: "Video" },
  { href: "/admin/settings/authentication", label: "Authentication" },
  { href: "/admin/settings/privacy", label: "Privacy & retention" },
  { href: "/admin/settings/features", label: "Feature flags" },
  { href: "/admin/settings/roles", label: "Roles & permissions" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!actor.permissions.has("settings.view") && !actor.permissions.has("settings.manage")) {
    redirect("/forbidden?permission=settings.view");
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Application-wide configuration. Every change here is audited."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Settings" }]}
      />
      <PageBody className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr]">
        <SettingsNav sections={SECTIONS} />
        <div className="min-w-0">{children}</div>
      </PageBody>
    </div>
  );
}
