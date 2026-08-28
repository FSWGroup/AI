import { NextResponse } from "next/server";
import { verifyCertificate } from "@/lib/services/certificate";

/**
 * GET /api/certificates/verify/[token]
 *
 * Public (unauthenticated) verification endpoint — only reachable when the
 * publicCertificateVerification feature flag is on, since verifyCertificate()
 * itself refuses to resolve a token otherwise. Returns only the minimal,
 * non-sensitive fields needed to confirm a certificate is genuine.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await verifyCertificate(token);
  return NextResponse.json(result, { status: result.valid ? 200 : 404 });
}
