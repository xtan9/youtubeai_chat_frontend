import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
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
