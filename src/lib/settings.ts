import "server-only";
import { prisma } from "@/lib/db";
import { unstable_cache, revalidateTag } from "next/cache";

/**
 * Application settings and branding.
 *
 * Brand values, the product name, training defaults, and feature flags live
 * here — never hard-coded in components. Renaming "FSW Academy" to anything
 * else is an admin settings change, not a code change.
 */

export interface BrandSettings {
  companyName: string;
  appName: string;
  logoMediaId: string | null;
  iconMediaId: string | null;
  emailLogoMediaId: string | null;
  certificateLogoMediaId: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  videoIntroMediaId: string | null;
  videoOutroMediaId: string | null;
}

export interface TrainingDefaults {
  /** Days after assignment that training is due when no explicit date is set. */
  defaultDueDays: number;
  /** Video watch percentage required for completion. */
  defaultRequiredVideoPercent: number;
  /** Default quiz passing score. */
  defaultPassingScore: number;
  /** Default SOP review cycle in days. */
  defaultReviewCycleDays: number;
  /** Days before a due date that a reminder is sent. */
  reminderDaysBefore: number[];
  /** Days before certificate expiry to start warning. */
  expiryWarningDays: number[];
}

export interface PrivacySettings {
  /** Years to retain completion evidence after a person is deactivated. */
  trainingRecordRetentionYears: number;
  /** Years to retain audit events. */
  auditRetentionYears: number;
  /** Years to retain analytics events. */
  analyticsRetentionYears: number;
  privacyNoticeUrl: string | null;
  privacyNoticeText: string | null;
}

export interface FeatureFlags {
  darkMode: boolean;
  publicCertificateVerification: boolean;
  leaderboards: boolean;
  selfEnrollment: boolean;
  gamificationBadges: boolean;
  scormPlayer: boolean;
  aiVideoStudio: boolean;
  translations: boolean;
}

export interface AppSettings {
  brand: BrandSettings;
  training: TrainingDefaults;
  privacy: PrivacySettings;
  features: FeatureFlags;
  languages: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  brand: {
    companyName: "FSW Group",
    appName: "FSW Academy",
    logoMediaId: null,
    iconMediaId: null,
    emailLogoMediaId: null,
    certificateLogoMediaId: null,
    primaryColor: "#17365c",
    secondaryColor: "#2575eb",
    accentColor: "#f98d07",
    videoIntroMediaId: null,
    videoOutroMediaId: null,
  },
  training: {
    defaultDueDays: 14,
    defaultRequiredVideoPercent: 90,
    defaultPassingScore: 80,
    defaultReviewCycleDays: 365,
    reminderDaysBefore: [7, 1],
    expiryWarningDays: [60, 30, 7],
  },
  privacy: {
    trainingRecordRetentionYears: 7,
    auditRetentionYears: 7,
    analyticsRetentionYears: 2,
    privacyNoticeUrl: null,
    privacyNoticeText: null,
  },
  features: {
    darkMode: false,
    publicCertificateVerification: false,
    leaderboards: false,
    selfEnrollment: true,
    gamificationBadges: true,
    scormPlayer: true,
    aiVideoStudio: true,
    translations: true,
  },
  languages: ["en", "fil"],
};

const SETTINGS_TAG = "app-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shallow-merge stored values over defaults so new settings keys are safe to add. */
function mergeSection<T extends object>(defaults: T, stored: unknown): T {
  if (!isRecord(stored)) return defaults;
  const result = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    if (key in stored && stored[key] !== undefined && stored[key] !== null) {
      result[key] = stored[key];
    }
  }
  return result as T;
}

async function loadSettings(): Promise<AppSettings> {
  const rows = await prisma.appSetting.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  return {
    brand: mergeSection(DEFAULT_SETTINGS.brand, byKey.get("brand")),
    training: mergeSection(DEFAULT_SETTINGS.training, byKey.get("training")),
    privacy: mergeSection(DEFAULT_SETTINGS.privacy, byKey.get("privacy")),
    features: mergeSection(DEFAULT_SETTINGS.features, byKey.get("features")),
    languages: Array.isArray(byKey.get("languages"))
      ? (byKey.get("languages") as string[])
      : DEFAULT_SETTINGS.languages,
  };
}

/**
 * Cached settings read. Settings change rarely and are read on nearly every
 * request, so they are cached and explicitly invalidated on write.
 */
export const getSettings = unstable_cache(loadSettings, ["app-settings"], {
  tags: [SETTINGS_TAG],
  revalidate: 300,
});

/** Convenience accessor used in page titles and emails. */
export async function getAppName(): Promise<string> {
  return (await getSettings()).brand.appName;
}

export async function updateSettingSection(
  key: "brand" | "training" | "privacy" | "features" | "languages",
  value: unknown,
  updatedBy: string,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as never, updatedBy },
    update: { value: value as never, updatedBy },
  });
  revalidateTag(SETTINGS_TAG);
}
