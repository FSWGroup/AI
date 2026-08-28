import Link from "next/link";
import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Certificates" };

export default async function CertificatesPage() {
  const actor = await requirePermission("training.view");

  const certificates = await prisma.certificate.findMany({
    where: { userId: actor.id },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      certificateNumber: true,
      courseTitleSnapshot: true,
      issuedAt: true,
      expiresAt: true,
      revokedAt: true,
      courseId: true,
    },
  });

  return (
    <>
      <PageHeader title="Certificates" description="Every certificate you've earned, ready to download or share." />
      <PageBody>
        {certificates.length === 0 ? (
          <EmptyState
            icon={<Icon name="certificate" className="h-5 w-5" />}
            title="No certificates yet"
            description="Complete a course with a certification to see it here."
            actions={
              <Link href="/catalog">
                <Button size="sm">Browse the catalog</Button>
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {certificates.map((cert) => {
              const expired = cert.expiresAt ? cert.expiresAt.getTime() < Date.now() : false;
              return (
                <Card key={cert.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
                        <Icon name="certificate" className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">{cert.courseTitleSnapshot}</p>
                        <p className="text-[0.8125rem] text-[var(--text-muted)]">
                          {cert.certificateNumber} · Issued {formatInTimeZone(cert.issuedAt, actor.timezone, "MMMM d, yyyy")}
                        </p>
                        {cert.expiresAt && (
                          <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)]">
                            {expired ? "Expired" : "Valid until"} {formatInTimeZone(cert.expiresAt, actor.timezone, "MMMM d, yyyy")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {cert.revokedAt ? (
                        <Badge tone="danger">Revoked</Badge>
                      ) : expired ? (
                        <Badge tone="warning">Expired</Badge>
                      ) : (
                        <Badge tone="success">Valid</Badge>
                      )}
                      <a href={`/api/certificates/${cert.id}/pdf`} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm">
                          <Glyph name="download" className="h-4 w-4" />
                          Download
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
