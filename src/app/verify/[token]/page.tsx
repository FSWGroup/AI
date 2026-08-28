import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { Icon } from "@/components/icons";

/**
 * PUBLIC certificate verification. No authentication. Reveals only:
 * certificate number, person name, course title, issue date, expiry, and
 * validity status — nothing else about the person or the organization.
 */
export default async function VerifyCertificatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();

  if (!settings.features.publicCertificateVerification) {
    return (
      <Shell appName={settings.brand.appName}>
        <NeutralMessage title="Verification is not enabled" description="This organization has not enabled public certificate verification." />
      </Shell>
    );
  }

  const certificate = await prisma.certificate.findFirst({
    where: { verificationToken: token },
    select: {
      certificateNumber: true,
      userNameSnapshot: true,
      courseTitleSnapshot: true,
      issuedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!certificate) {
    return (
      <Shell appName={settings.brand.appName}>
        <NeutralMessage title="Verification link not recognized" description="This link may be mistyped, or the certificate is no longer eligible for public verification." />
      </Shell>
    );
  }

  const now = Date.now();
  const status = certificate.revokedAt ? "REVOKED" : certificate.expiresAt && certificate.expiresAt.getTime() < now ? "EXPIRED" : "VALID";
  const statusColor = status === "VALID" ? "text-success-700" : status === "EXPIRED" ? "text-warning-700" : "text-danger-700";

  return (
    <Shell appName={settings.brand.appName}>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Icon name="certificate" className="h-6 w-6 text-[var(--brand-primary)]" />
          <p className={`text-[0.875rem] font-semibold ${statusColor}`}>
            {status === "VALID" ? "Valid certificate" : status === "EXPIRED" ? "This certificate has expired" : "This certificate has been revoked"}
          </p>
        </div>
        <dl className="flex flex-col gap-3 text-[0.9375rem]">
          <Row label="Certificate number" value={certificate.certificateNumber} />
          <Row label="Issued to" value={certificate.userNameSnapshot} />
          <Row label="Course" value={certificate.courseTitleSnapshot} />
          <Row label="Issued" value={certificate.issuedAt.toISOString().slice(0, 10)} />
          <Row label="Expires" value={certificate.expiresAt ? certificate.expiresAt.toISOString().slice(0, 10) : "No expiration"} />
        </dl>
      </div>
      <p className="mt-4 text-center text-[0.75rem] text-[var(--text-muted)]">
        This page confirms only the details above. No other personal or organizational information is disclosed.
      </p>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border-subtle)] pb-2 last:border-0 last:pb-0">
      <dt className="text-[0.8125rem] text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right font-medium text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function NeutralMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-8 text-center shadow-sm">
      <Icon name="certificate" className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
      <p className="mt-3 text-[0.9375rem] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[0.8125rem] text-[var(--text-muted)]">{description}</p>
    </div>
  );
}

function Shell({ appName, children }: { appName: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4 py-12">
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-[0.8125rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{appName} · Certificate verification</p>
        {children}
      </div>
    </div>
  );
}
