/** Centralized environment access. No PII, no secrets in logs. */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const env = {
  get appSecret(): string {
    return required("APP_SECRET");
  },
  get appBaseUrl(): string {
    return process.env.APP_BASE_URL ?? "http://localhost:3000";
  },
  get storageProvider(): "local" | "s3" {
    return process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local";
  },
  get emailProvider(): string {
    return process.env.EMAIL_PROVIDER ?? "console";
  },
  get emailFrom(): string {
    return process.env.EMAIL_FROM ?? "assessments@localhost";
  },
  get chromiumPath(): string | undefined {
    return process.env.CHROMIUM_PATH || undefined;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  s3: {
    get endpoint(): string | undefined {
      return process.env.S3_ENDPOINT || undefined;
    },
    get region(): string {
      return process.env.S3_REGION ?? "auto";
    },
    get bucket(): string {
      return required("S3_BUCKET");
    },
    get accessKeyId(): string {
      return required("S3_ACCESS_KEY_ID");
    },
    get secretAccessKey(): string {
      return required("S3_SECRET_ACCESS_KEY");
    },
  },
};
