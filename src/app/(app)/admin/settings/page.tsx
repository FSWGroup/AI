import Link from "next/link";
import { requireActor } from "@/lib/auth/guard";
import { getAppName } from "@/lib/settings";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";

const CARDS: { href: string; label: string; description: string }[] = [
  { href: "/admin/settings/organization", label: "Organization", description: "The organization's legal/display name." },
  { href: "/admin/settings/brand", label: "Brand", description: "App name, logos, and brand colors." },
  { href: "/admin/settings/languages", label: "Languages", description: "Supported content languages." },
  { href: "/admin/settings/notifications", label: "Notifications", description: "Reminder and expiry-warning timing." },
  { href: "/admin/settings/training", label: "Training defaults", description: "Due dates, video, and passing-score defaults." },
  { href: "/admin/settings/content-review", label: "Content review defaults", description: "How often published content is reviewed." },
  { href: "/admin/settings/compliance", label: "Compliance", description: "Live compliance rule and exemption counts." },
  { href: "/admin/settings/ai", label: "AI providers", description: "Which AI capabilities are configured." },
  { href: "/admin/settings/video", label: "Video", description: "Intro/outro clips and render capability." },
  { href: "/admin/settings/authentication", label: "Authentication", description: "Which sign-in methods are active." },
  { href: "/admin/settings/privacy", label: "Privacy & retention", description: "Retention windows and privacy notices." },
  { href: "/admin/settings/features", label: "Feature flags", description: "Toggle optional platform features." },
  { href: "/admin/settings/roles", label: "Roles & permissions", description: "Edit what each role can do." },
];

export default async function SettingsIndexPage() {
  await requireActor();
  const appName = await getAppName();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] text-[var(--text-muted)]">
        Currently branded as <strong className="text-[var(--text-primary)]">{appName}</strong>. Choose a section to configure.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
            <Card className="h-full transition-colors hover:border-[var(--border-strong)]">
              <CardContent className="flex flex-col gap-1">
                <CardTitle>{card.label}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
