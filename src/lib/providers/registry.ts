/**
 * Provider capability registry.
 *
 * Every optional external capability is declared here with the environment
 * variables that enable it. The Integrations screen renders from this list, and
 * feature code asks `isCapabilityAvailable()` before offering a capability.
 *
 * A missing provider disables only its own capability. The application never
 * crashes because an optional integration is unconfigured.
 */

export type CapabilityKey =
  | "ai_text"
  | "ai_embeddings"
  | "ai_tts"
  | "ai_image"
  | "ai_video_avatar"
  | "video_render"
  | "email"
  | "storage_s3"
  | "microsoft"
  | "slack"
  | "teams";

export interface CapabilityDescriptor {
  key: CapabilityKey;
  label: string;
  description: string;
  /** All listed variables must be present for the capability to be available. */
  requiredEnv: string[];
  /** Any one of these enables the capability (alternative providers). */
  anyOfEnv?: string[][];
  /** What degrades when this is missing. */
  degradesTo: string;
}

export const CAPABILITIES: CapabilityDescriptor[] = [
  {
    key: "ai_text",
    label: "AI text generation",
    description:
      "Powers Ask FSW AI answers, the Training Coach, AI drafting of SOPs and courses, quiz suggestions, translation, and content quality checks.",
    requiredEnv: [],
    anyOfEnv: [["ANTHROPIC_API_KEY"], ["OPENAI_API_KEY"]],
    degradesTo:
      "AI authoring and Ask FSW AI are disabled. All manual authoring, search, and training features continue to work.",
  },
  {
    key: "ai_embeddings",
    label: "AI embeddings (semantic search)",
    description:
      "Generates vectors for retrieval-augmented answers and duplicate-content detection.",
    requiredEnv: [],
    anyOfEnv: [["OPENAI_API_KEY"], ["VOYAGE_API_KEY"]],
    degradesTo:
      "Ask FSW AI falls back to full-text keyword retrieval, which still enforces the same permission filtering.",
  },
  {
    key: "ai_tts",
    label: "Text to speech",
    description: "Generates narration audio for AI-produced training videos.",
    requiredEnv: [],
    anyOfEnv: [["OPENAI_API_KEY"], ["ELEVENLABS_API_KEY"]],
    degradesTo:
      "AI videos render with on-screen text and captions but no spoken narration track.",
  },
  {
    key: "ai_image",
    label: "AI image generation",
    description: "Generates illustrative imagery for training content and video scenes.",
    requiredEnv: [],
    anyOfEnv: [["OPENAI_API_KEY"]],
    degradesTo: "Video scenes use FSW-branded typographic layouts instead of generated imagery.",
  },
  {
    key: "ai_video_avatar",
    label: "AI avatar presenter",
    description:
      "Optional avatar-presenter videos through an external provider (HeyGen, Synthesia, or a future provider).",
    requiredEnv: [],
    anyOfEnv: [["HEYGEN_API_KEY"], ["SYNTHESIA_API_KEY"]],
    degradesTo:
      "The AI Avatar Presenter video mode is unavailable. All other video modes render locally with FSW branding.",
  },
  {
    key: "video_render",
    label: "Programmatic video rendering",
    description:
      "Renders FSW-branded scenes, captions, and narration into an MP4 using the local ffmpeg pipeline.",
    requiredEnv: ["FFMPEG_PATH"],
    degradesTo:
      "Video Studio still produces scripts, storyboards, narration text, and caption files, but cannot output an MP4.",
  },
  {
    key: "email",
    label: "Email delivery",
    description: "Sends assignment, reminder, overdue, and certificate emails, plus magic-link sign-in.",
    requiredEnv: [],
    anyOfEnv: [["RESEND_API_KEY"], ["EMAIL_SERVER_HOST", "EMAIL_FROM"]],
    degradesTo:
      "Notifications are delivered in-app only. Magic-link sign-in is unavailable; password and SSO sign-in are unaffected.",
  },
  {
    key: "storage_s3",
    label: "S3-compatible object storage",
    description: "Stores uploaded media and rendered video in durable object storage.",
    requiredEnv: ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
    degradesTo:
      "Media is stored on the local filesystem, which is correct for development but not for multi-instance production.",
  },
  {
    key: "microsoft",
    label: "Microsoft Entra ID single sign-on",
    description: "Lets people sign in with their Microsoft 365 work account, including MFA policies.",
    requiredEnv: [
      "AUTH_MICROSOFT_ENTRA_ID_ID",
      "AUTH_MICROSOFT_ENTRA_ID_SECRET",
      "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
    ],
    degradesTo: "People sign in with email and password or a magic link.",
  },
  {
    key: "slack",
    label: "Slack notifications",
    description: "Mirrors selected notifications into a Slack channel.",
    requiredEnv: ["SLACK_WEBHOOK_URL"],
    degradesTo: "Notifications are delivered in-app and by email only.",
  },
  {
    key: "teams",
    label: "Microsoft Teams notifications",
    description: "Mirrors selected notifications into a Teams channel.",
    requiredEnv: ["TEAMS_WEBHOOK_URL"],
    degradesTo: "Notifications are delivered in-app and by email only.",
  },
];

function hasAll(vars: string[]): boolean {
  return vars.every((name) => Boolean(process.env[name]?.trim()));
}

export function isCapabilityAvailable(key: CapabilityKey): boolean {
  const descriptor = CAPABILITIES.find((c) => c.key === key);
  if (!descriptor) return false;

  if (descriptor.requiredEnv.length > 0 && !hasAll(descriptor.requiredEnv)) {
    // FFMPEG_PATH has a sane default; treat an unset value as "ffmpeg" on PATH.
    if (!(descriptor.key === "video_render" && descriptor.requiredEnv[0] === "FFMPEG_PATH")) {
      return false;
    }
  }

  if (descriptor.anyOfEnv && descriptor.anyOfEnv.length > 0) {
    return descriptor.anyOfEnv.some((group) => hasAll(group));
  }

  return true;
}

export interface CapabilityStatus extends CapabilityDescriptor {
  available: boolean;
  /** Which env group satisfied it, for display in the admin UI. */
  satisfiedBy: string | null;
}

export function getCapabilityStatuses(): CapabilityStatus[] {
  return CAPABILITIES.map((descriptor) => {
    const available = isCapabilityAvailable(descriptor.key);
    let satisfiedBy: string | null = null;
    if (available && descriptor.anyOfEnv) {
      const group = descriptor.anyOfEnv.find((g) => hasAll(g));
      satisfiedBy = group?.join(" + ") ?? null;
    } else if (available && descriptor.requiredEnv.length > 0) {
      satisfiedBy = descriptor.requiredEnv.join(" + ");
    }
    return { ...descriptor, available, satisfiedBy };
  });
}
