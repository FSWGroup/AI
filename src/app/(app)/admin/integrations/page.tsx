import { requirePermission } from "@/lib/auth/guard";
import { getCapabilityStatuses } from "@/lib/providers/registry";
import { listApiKeys, listWebhooks, listConfigurableIntegrations, CONFIGURABLE_INTEGRATIONS } from "@/lib/services/integrations";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApiKeysPanel } from "@/app/(app)/admin/integrations/api-keys-panel";
import { WebhooksPanel } from "@/app/(app)/admin/integrations/webhooks-panel";
import { ConfigurableIntegrationsPanel } from "@/app/(app)/admin/integrations/configurable-panel";

export default async function IntegrationsPage() {
  await requirePermission("integrations.manage");

  const [capabilities, apiKeys, webhooks, configurable] = await Promise.all([
    getCapabilityStatuses(),
    listApiKeys(),
    listWebhooks(),
    listConfigurableIntegrations(),
  ]);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Every connector is shown honestly: connected only when real credentials are present, with exactly what degrades when they're not."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Integrations" }]}
      />
      <PageBody className="flex flex-col gap-8">
        <section>
          <SectionHeading title="Platform capabilities" description="Configured entirely through environment variables — nothing here can be edited from the UI." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {capabilities.map((cap) => (
              <Card key={cap.key}>
                <CardContent className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{cap.label}</CardTitle>
                    <Badge tone={cap.available ? "success" : "neutral"} dot>
                      {cap.available ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <CardDescription>{cap.description}</CardDescription>
                  {cap.available ? (
                    <p className="text-[0.75rem] text-success-700">Satisfied by: {cap.satisfiedBy}</p>
                  ) : (
                    <p className="text-[0.75rem] text-[var(--text-muted)]">
                      Needs: {cap.anyOfEnv?.map((g) => g.join(" + ")).join(" or ") || cap.requiredEnv.join(", ") || "—"}
                    </p>
                  )}
                  <p className="text-[0.75rem] text-[var(--text-muted)]">When missing: {cap.degradesTo}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <SectionHeading title="Configurable integrations" description="These are stored (encrypted) in the database, so they can be set here." />
          <ConfigurableIntegrationsPanel descriptors={CONFIGURABLE_INTEGRATIONS} initialStatuses={configurable} />
        </section>

        <section>
          <SectionHeading title="API keys" description="Grant scoped, revocable access to the public REST API (/api/v1)." />
          <ApiKeysPanel
            initialKeys={apiKeys.map((k) => ({
              ...k,
              lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
              expiresAt: k.expiresAt?.toISOString() ?? null,
              revokedAt: k.revokedAt?.toISOString() ?? null,
              createdAt: k.createdAt.toISOString(),
            }))}
          />
        </section>

        <section>
          <SectionHeading title="Webhooks" description="Push training and compliance events to an external system." />
          <WebhooksPanel initialWebhooks={webhooks.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() }))} />
        </section>
      </PageBody>
    </div>
  );
}
