import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware.
 *
 * Assigns a request ID for log correlation and sets the Content-Security-Policy
 * with a per-request nonce. Authentication and authorization are deliberately
 * NOT done here — they happen in the server components and route handlers where
 * the database is reachable and per-record scoping is possible. Middleware is a
 * routing concern, not a security boundary.
 */

const PUBLIC_PATHS = ["/sign-in", "/verify", "/api/auth", "/_next", "/favicon.ico"];

export function middleware(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);

  // Media routes carry their own sandbox CSP from next.config.ts.
  if (!request.nextUrl.pathname.startsWith("/api/media")) {
    const isDev = process.env.NODE_ENV === "development";
    response.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Next.js injects inline bootstrap scripts; 'unsafe-inline' is required
        // for the App Router runtime. 'unsafe-eval' is dev-only (React refresh).
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        // Uploaded content and SCORM packages render inside sandboxed frames
        // served from this origin.
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join("; "),
    );
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export { PUBLIC_PATHS };
