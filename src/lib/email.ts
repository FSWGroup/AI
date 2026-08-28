import 'server-only';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Transactional email with an outbox pattern:
 *  - Every message is persisted to EmailMessage first.
 *  - EMAIL_DRIVER=outbox (dev/default): messages stay in the DB and are
 *    viewable at Admin → Email Outbox, so the system is fully testable
 *    without a provider key.
 *  - EMAIL_DRIVER=smtp: delivery via SMTP with status + error captured for
 *    retry (attempts tracked; a background retry can re-send FAILED rows).
 */

const BRAND_BLUE = '#1f4e79';
const CHARCOAL = '#1c2530';

export function renderEmailHtml(opts: { heading: string; bodyHtml: string; ctaLabel?: string; ctaUrl?: string }) {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td style="background:${BRAND_BLUE};border-radius:6px"><a href="${opts.ctaUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${opts.ctaLabel}</a></td></tr></table>`
      : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${CHARCOAL};padding:20px 32px"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px">FSW <span style="color:#7aa7d4">People</span></span></td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-size:20px;color:${CHARCOAL}">${opts.heading}</h1>
<div style="font-size:15px;line-height:1.6;color:#334155">${opts.bodyHtml}</div>
${cta}
<p style="margin:24px 0 0;font-size:12px;color:#94a3b8">FSW Group · Exton, Pennsylvania · This is an automated message from FSW People.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<br\s*\/?>(\n)?/g, '\n')
    .replace(/<\/(p|h1|h2|h3|tr|div)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  templateKey?: string;
  relatedType?: string;
  relatedId?: string;
}) {
  const html = renderEmailHtml(opts);
  const message = await db.emailMessage.create({
    data: {
      toEmail: opts.to,
      subject: opts.subject,
      html,
      text: htmlToText(html),
      templateKey: opts.templateKey ?? null,
      relatedType: opts.relatedType ?? null,
      relatedId: opts.relatedId ?? null,
      status: env.EMAIL_DRIVER === 'outbox' ? 'OUTBOX' : 'QUEUED',
    },
  });

  if (env.EMAIL_DRIVER === 'smtp') {
    await deliverSmtp(message.id).catch(() => {
      /* failure recorded on the row; retried by the email retry job */
    });
  }
  return message;
}

async function deliverSmtp(messageId: string) {
  const message = await db.emailMessage.findUniqueOrThrow({ where: { id: messageId } });
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      secure: Number(env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: message.toEmail,
      subject: message.subject,
      html: message.html,
      text: message.text ?? undefined,
    });
    await db.emailMessage.update({
      where: { id: messageId },
      data: { status: 'SENT', provider: 'smtp', sentAt: new Date(), attempts: { increment: 1 } },
    });
  } catch (err) {
    await db.emailMessage.update({
      where: { id: messageId },
      data: {
        status: 'FAILED',
        provider: 'smtp',
        error: err instanceof Error ? err.message.slice(0, 500) : 'Unknown SMTP error',
        attempts: { increment: 1 },
      },
    });
    throw err;
  }
}

/** Re-attempt failed deliveries (called from the maintenance job). */
export async function retryFailedEmails(limit = 25) {
  if (env.EMAIL_DRIVER !== 'smtp') return 0;
  const failed = await db.emailMessage.findMany({
    where: { status: 'FAILED', attempts: { lt: 5 } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let ok = 0;
  for (const m of failed) {
    await deliverSmtp(m.id)
      .then(() => ok++)
      .catch(() => {});
  }
  return ok;
}
