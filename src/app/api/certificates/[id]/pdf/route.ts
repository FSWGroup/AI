import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor, actorHas } from "@/lib/auth/guard";
import { renderCertificatePdf } from "@/lib/services/certificate";

/**
 * GET /api/certificates/[id]/pdf
 *
 * Authorized download: the certificate's own owner, or anyone holding
 * reports.view or people.view (the platform's cross-person visibility
 * scopes) may fetch it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  }

  const certificate = await prisma.certificate.findUnique({
    where: { id },
    select: { id: true, userId: true, certificateNumber: true },
  });
  if (!certificate) {
    return NextResponse.json({ error: "Certificate not found." }, { status: 404 });
  }

  const isOwner = certificate.userId === actor.id;
  const hasScope = actorHas(actor, "reports.view") || actorHas(actor, "people.view");
  if (!isOwner && !hasScope) {
    return NextResponse.json({ error: "You don't have permission to view this certificate." }, { status: 403 });
  }

  const bytes = await renderCertificatePdf(certificate.id);

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${certificate.certificateNumber}.pdf"`,
      "Cache-Control": "private, max-age=0, no-cache",
    },
  });
}
