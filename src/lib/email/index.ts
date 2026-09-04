/**
 * Email abstraction. The provider is swappable via EMAIL_PROVIDER.
 * The "console" provider persists messages to the EmailMessage table (the
 * dev outbox) so invitation links are retrievable during development.
 *
 * Emails NEVER contain test questions, scores, or webcam footage.
 */

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export interface EmailPayload {
  to: string;
  template:
    | "invitation"
    | "reminder"
    | "completed_notification"
    | "interruption_notification"
    | "retest_invitation"
    | "application_received"
    | "rejection"
    | "interview_invitation"
    | "offer_sent"
    | "interview_recording_consent";
  subject: string;
  bodyText: string;
}

export interface EmailProvider {
  send(payload: EmailPayload): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(payload: EmailPayload): Promise<void> {
    await prisma.emailMessage.create({
      data: {
        toEmail: payload.to,
        template: payload.template,
        subject: payload.subject,
        bodyText: payload.bodyText,
        status: "SENT",
      },
    });
    if (!env.isProduction) {
      // Dev convenience; no PII beyond the address the admin just typed.
      console.log(`[email:${payload.template}] to=${payload.to} subject="${payload.subject}"`);
    }
  }
}

/**
 * Placeholder for a real SMTP/API provider. Wire nodemailer, Resend, SES,
 * etc. here without touching call sites. Messages are also logged to the
 * outbox table for troubleshooting.
 */
class ExternalEmailProvider implements EmailProvider {
  async send(payload: EmailPayload): Promise<void> {
    await prisma.emailMessage.create({
      data: {
        toEmail: payload.to,
        template: payload.template,
        subject: payload.subject,
        bodyText: payload.bodyText,
        status: "QUEUED_EXTERNAL",
      },
    });
    throw new Error(
      `EMAIL_PROVIDER="${env.emailProvider}" is not wired to a delivery service yet. ` +
        "Implement ExternalEmailProvider in src/lib/email/index.ts.",
    );
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider =
      env.emailProvider === "console"
        ? new ConsoleEmailProvider()
        : new ExternalEmailProvider();
  }
  return provider;
}

/** Convenience wrapper so call sites do not each resolve the provider. */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  await getEmailProvider().send(payload);
}
