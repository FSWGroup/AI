import Link from "next/link";
import { requireActor } from "@/lib/auth/guard";
import { getCapabilityStatuses } from "@/lib/providers/registry";
import { SectionHeading } from "@/components/page-header";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const AI_KEYS = ["ai_text", "ai_embeddings", "ai_tts", "ai_image", "ai_video_avatar"] as const;

export default async function AiProvidersSettingsPage() {
  await requireActor();
  const capabilities = getCapabilityStatuses().filter((c) => (AI_KEYS as readonly string[]).includes(c.key));

  return (
    <div>
      <SectionHeading
        title="AI providers"
        description="AI capabilities are configured entirely through environment variables — there is nothing to type in here. This page shows what's active. Manage API keys and webhooks for the platform's own API in Integrations."
      />
      <div className="mt-4 flex flex-col gap-3">
        {capabilities.map((cap) => (
          <Card key={cap.key}>
            <CardContent className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{cap.label}</CardTitle>
                <Badge tone={cap.available ? "success" : "neutral"} dot>
                  {cap.available ? "Connected" : "Not connected"}
                </Badge>
              </div>
              <p className="text-[0.8125rem] text-[var(--text-muted)]">{cap.description}</p>
              {cap.available ? (
                <p className="text-[0.75rem] text-success-700">Satisfied by: {cap.satisfiedBy}</p>
              ) : (
                <p className="text-[0.75rem] text-[var(--text-muted)]">
                  Set one of: {cap.anyOfEnv?.map((group) => group.join(" + ")).join(", ") || cap.requiredEnv.join(", ")}
                </p>
              )}
              <p className="text-[0.75rem] text-[var(--text-muted)]">When missing: {cap.degradesTo}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-[0.8125rem] text-[var(--text-muted)]">
        See the full list of integrations, including email and storage, at{" "}
        <Link href="/admin/integrations" className="font-medium underline">
          Integrations
        </Link>
        .
      </p>
    </div>
  );
}
