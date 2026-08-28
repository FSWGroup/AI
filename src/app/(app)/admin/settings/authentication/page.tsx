import { requireActor } from "@/lib/auth/guard";
import { isPasswordAuthEnabled, isMagicLinkEnabled, isMicrosoftSsoEnabled } from "@/lib/auth/config";
import { SectionHeading } from "@/components/page-header";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AuthenticationSettingsPage() {
  await requireActor();

  const methods = [
    {
      label: "Email and password",
      active: isPasswordAuthEnabled(),
      detail: "Controlled by AUTH_ENABLE_PASSWORD (defaults on).",
    },
    {
      label: "Magic link",
      active: isMagicLinkEnabled(),
      detail: "Requires EMAIL_SERVER_HOST and EMAIL_FROM.",
    },
    {
      label: "Microsoft Entra ID single sign-on",
      active: isMicrosoftSsoEnabled(),
      detail: "Requires AUTH_MICROSOFT_ENTRA_ID_ID, _SECRET, and _ISSUER.",
    },
  ];

  return (
    <div>
      <SectionHeading
        title="Authentication"
        description="Sign-in methods are configured through environment variables, not a database setting, so a compromised database can never silently add a sign-in path. This page shows what's currently active."
      />
      <div className="mt-4 flex flex-col gap-3">
        {methods.map((method) => (
          <Card key={method.label}>
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{method.label}</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">{method.detail}</p>
              </div>
              <Badge tone={method.active ? "success" : "neutral"} dot>
                {method.active ? "Active" : "Inactive"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
