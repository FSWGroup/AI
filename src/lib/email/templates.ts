import type { BrandSettings } from "@/lib/settings";

/**
 * Branded transactional email templates.
 *
 * Table-based layout with inline styles — the only approach that renders
 * reliably across Outlook, Gmail, and Apple Mail. Every template ships a plain
 * text alternative.
 */

interface TemplateContext {
  brand: BrandSettings;
  appUrl: string;
  recipientName: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(
  ctx: TemplateContext,
  options: {
    preheader: string;
    heading: string;
    bodyHtml: string;
    ctaLabel?: string;
    ctaUrl?: string;
    footerNote?: string;
  },
): string {
  const { brand, appUrl } = ctx;
  const primary = brand.primaryColor;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#f7f8fa;max-height:0;overflow:hidden;">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8fa;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dde1e9;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background-color:${primary};padding:20px 28px;">
            <span style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(brand.appName)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;color:#0b1d33;font-weight:600;">${escapeHtml(options.heading)}</h1>
            <div style="font-size:14px;line-height:1.65;color:#4c5566;">
              ${options.bodyHtml}
            </div>
            ${
              options.ctaLabel && options.ctaUrl
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
                     <tr><td style="background-color:${primary};border-radius:6px;">
                       <a href="${options.ctaUrl}" style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(options.ctaLabel)}</a>
                     </td></tr>
                   </table>`
                : ""
            }
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #eef0f4;padding:16px 28px;background-color:#f7f8fa;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#78849a;">
              ${escapeHtml(options.footerNote ?? `Sent by ${brand.appName} for ${brand.companyName}.`)}
              <br>
              <a href="${appUrl}/settings/notifications" style="color:#2575eb;text-decoration:underline;">Manage your notification preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function trainingAssignedEmail(
  ctx: TemplateContext,
  data: { title: string; dueDate: string | null; reason: string; url: string },
): RenderedEmail {
  const subject = `New training assigned: ${data.title}`;
  const dueLine = data.dueDate
    ? `<p style="margin:0 0 12px;"><strong>Due:</strong> ${escapeHtml(data.dueDate)}</p>`
    : "";

  return {
    subject,
    html: shell(ctx, {
      preheader: `${data.title} has been assigned to you.`,
      heading: "New training assigned",
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ctx.recipientName)},</p>
        <p style="margin:0 0 12px;"><strong>${escapeHtml(data.title)}</strong> has been added to your training.</p>
        ${dueLine}
        <p style="margin:0 0 12px;color:#5f6b80;"><strong>Why you were assigned this:</strong> ${escapeHtml(data.reason)}</p>`,
      ctaLabel: "Start training",
      ctaUrl: data.url,
    }),
    text: [
      `Hi ${ctx.recipientName},`,
      "",
      `${data.title} has been added to your training.`,
      data.dueDate ? `Due: ${data.dueDate}` : "",
      `Why you were assigned this: ${data.reason}`,
      "",
      `Start training: ${data.url}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function trainingDueSoonEmail(
  ctx: TemplateContext,
  data: { title: string; dueDate: string; url: string; daysRemaining: number },
): RenderedEmail {
  const when =
    data.daysRemaining <= 0
      ? "today"
      : data.daysRemaining === 1
        ? "tomorrow"
        : `in ${data.daysRemaining} days`;

  return {
    subject: `Due ${when}: ${data.title}`,
    html: shell(ctx, {
      preheader: `${data.title} is due ${when}.`,
      heading: `Training due ${when}`,
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ctx.recipientName)},</p>
        <p style="margin:0 0 12px;"><strong>${escapeHtml(data.title)}</strong> is due on ${escapeHtml(data.dueDate)}.</p>`,
      ctaLabel: "Continue training",
      ctaUrl: data.url,
    }),
    text: `Hi ${ctx.recipientName},\n\n${data.title} is due on ${data.dueDate}.\n\nContinue: ${data.url}`,
  };
}

export function trainingOverdueEmail(
  ctx: TemplateContext,
  data: { title: string; dueDate: string; url: string },
): RenderedEmail {
  return {
    subject: `Overdue: ${data.title}`,
    html: shell(ctx, {
      preheader: `${data.title} is past its due date.`,
      heading: "Training is overdue",
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ctx.recipientName)},</p>
        <p style="margin:0 0 12px;"><strong>${escapeHtml(data.title)}</strong> was due on ${escapeHtml(data.dueDate)} and has not been completed.</p>
        <p style="margin:0 0 12px;">If something is blocking you, reply to your manager so it can be sorted out.</p>`,
      ctaLabel: "Complete now",
      ctaUrl: data.url,
    }),
    text: `Hi ${ctx.recipientName},\n\n${data.title} was due on ${data.dueDate} and has not been completed.\n\nComplete now: ${data.url}`,
  };
}

export function certificateEarnedEmail(
  ctx: TemplateContext,
  data: { courseTitle: string; certificateNumber: string; url: string; expiresAt: string | null },
): RenderedEmail {
  return {
    subject: `Certificate earned: ${data.courseTitle}`,
    html: shell(ctx, {
      preheader: `Your certificate for ${data.courseTitle} is ready.`,
      heading: "Certificate earned",
      bodyHtml: `
        <p style="margin:0 0 12px;">Nice work, ${escapeHtml(ctx.recipientName)}.</p>
        <p style="margin:0 0 12px;">You completed <strong>${escapeHtml(data.courseTitle)}</strong>.</p>
        <p style="margin:0 0 12px;"><strong>Certificate number:</strong> ${escapeHtml(data.certificateNumber)}</p>
        ${data.expiresAt ? `<p style="margin:0 0 12px;"><strong>Valid until:</strong> ${escapeHtml(data.expiresAt)}</p>` : ""}`,
      ctaLabel: "Download certificate",
      ctaUrl: data.url,
    }),
    text: `Nice work, ${ctx.recipientName}.\n\nYou completed ${data.courseTitle}.\nCertificate number: ${data.certificateNumber}\n\nDownload: ${data.url}`,
  };
}

export function managerActionEmail(
  ctx: TemplateContext,
  data: { subject: string; detail: string; url: string; ctaLabel: string },
): RenderedEmail {
  return {
    subject: data.subject,
    html: shell(ctx, {
      preheader: data.detail,
      heading: "Your action is needed",
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ctx.recipientName)},</p>
        <p style="margin:0 0 12px;">${escapeHtml(data.detail)}</p>`,
      ctaLabel: data.ctaLabel,
      ctaUrl: data.url,
    }),
    text: `Hi ${ctx.recipientName},\n\n${data.detail}\n\n${data.ctaLabel}: ${data.url}`,
  };
}

export function genericNotificationEmail(
  ctx: TemplateContext,
  data: { subject: string; heading: string; body: string; url?: string; ctaLabel?: string },
): RenderedEmail {
  return {
    subject: data.subject,
    html: shell(ctx, {
      preheader: data.body.slice(0, 120),
      heading: data.heading,
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ctx.recipientName)},</p>
        <p style="margin:0 0 12px;">${escapeHtml(data.body)}</p>`,
      ...(data.url && data.ctaLabel ? { ctaLabel: data.ctaLabel, ctaUrl: data.url } : {}),
    }),
    text: `Hi ${ctx.recipientName},\n\n${data.body}${data.url ? `\n\n${data.url}` : ""}`,
  };
}
