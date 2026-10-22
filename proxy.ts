import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/ingest" || pathname.startsWith("/ingest/")) {
    // Public PostHog scripts/events must bypass sign-in. Strip application
    // credentials before next.config.ts forwards the request to PostHog.
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    return NextResponse.next({ request: { headers } });
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Analytics images also need credential stripping despite the static
    // extension exclusions in the general application matcher below.
    "/ingest/:path*",
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next internals)
     * - favicon.ico, sitemap.xml, robots.txt, manifest.json (static endpoints
     *   that crawlers and PWA installers fetch unauthenticated)
     * - any path ending in a static asset extension
     *
     * Without manifest.json in this list, Supabase auth was redirecting
     * /manifest.json to /auth/login, breaking PWA installability and
     * generating a "Manifest: Line 1, column 1, Syntax error" in every
     * browser console.
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
