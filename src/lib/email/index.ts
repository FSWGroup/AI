import "server-only";
import nodemailer from "nodemailer";

/**
 * Email provider abstraction.
 *
 * Resend when RESEND_API_KEY is set; SMTP when EMAIL_SERVER_HOST is set;
 * otherwise a console driver that logs the message in development and reports
 * itself as unavailable so notifications stay in-app only.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailProvider {
  readonly key: string;
  readonly available: boolean;
  send(message: EmailMessage): Promise<void>;
}

class ResendProvider implements EmailProvider {
  readonly key = "resend";
  readonly available = true;

  constructor(private apiKey: string, private from: string) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Email delivery failed (${response.status}): ${detail.slice(0, 300)}`);
    }
  }
}

class SmtpProvider implements EmailProvider {
  readonly key = "smtp";
  readonly available = true;
  private transport: nodemailer.Transporter;

  constructor(private from: string) {
    this.transport = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
      secure: process.env.EMAIL_SERVER_SECURE === "true",
      auth:
        process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
          ? {
              user: process.env.EMAIL_SERVER_USER,
              pass: process.env.EMAIL_SERVER_PASSWORD,
            }
          : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
  }
}

class ConsoleProvider implements EmailProvider {
  readonly key = "console";
  readonly available = false;

  async send(message: EmailMessage): Promise<void> {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        `[email:console] Would send "${message.subject}" to ${message.to}. ` +
          "Configure RESEND_API_KEY or EMAIL_SERVER_HOST to deliver real email.",
      );
    }
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;

  const from = process.env.EMAIL_FROM?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (resendKey && from) {
    provider = new ResendProvider(resendKey, from);
  } else if (process.env.EMAIL_SERVER_HOST?.trim() && from) {
    provider = new SmtpProvider(from);
  } else {
    provider = new ConsoleProvider();
  }
  return provider;
}

export function __resetEmailProvider(): void {
  provider = null;
}

export function isEmailAvailable(): boolean {
  return getEmailProvider().available;
}
