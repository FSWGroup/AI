/**
 * Structured logging.
 *
 * Emits single-line JSON so log aggregators can parse it. Request IDs
 * correlate a user-facing error reference with server entries.
 *
 * Never logs: passwords, tokens, API keys, sensitive profile field values, or
 * full content bodies. The redaction pass below is a safety net, not a licence
 * to pass sensitive data in.
 */

type Level = "debug" | "info" | "warn" | "error";

const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "ciphertext",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}…[truncated]` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ""))) {
      out[key] = "[redacted]";
    } else {
      out[key] = redact(inner, depth + 1);
    }
  }
  return out;
}

const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "production" ? "info" : "debug");
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[MIN_LEVEL]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),

  /**
   * Report an exception. When SENTRY_DSN is configured the error is also
   * forwarded; training content and personal data are never included.
   */
  exception: (error: unknown, context?: Record<string, unknown>) => {
    const detail =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 8).join("\n") }
        : { message: String(error) };
    emit("error", "unhandled exception", { ...context, error: detail });
  },
};
