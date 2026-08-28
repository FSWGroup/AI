import { NextResponse, type NextRequest } from 'next/server';

// /careers is the public job board Indeed links applicants to. It renders
// only jobs a recruiter has explicitly published — see lib/recruiting/postings.
const PUBLIC_PATHS = ['/login', '/mfa', '/reset', '/activate', '/careers'];

/**
 * Edge-level gate: unauthenticated requests to app pages bounce to /login
 * before any server work happens. This is a fast-path convenience only —
 * real authentication/authorization always happens server-side in layouts,
 * pages and server actions (src/lib/authz).
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const hasSessionCookie = request.cookies.has('fsw_session');

  if (!isPublic && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
};
