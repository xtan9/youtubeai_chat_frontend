import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip middleware check. You can remove this once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: DO NOT REMOVE auth.getUser()

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in users get the personal dashboard instead of the marketing
  // homepage. The redirect lives here (not in `app/page.tsx`) so anonymous
  // visitors and crawlers still see the marketing/SEO content at `/`.
  if (user && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Allow public access to summary pages and home page
  const isPublicPath =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/summary") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/privacy") ||
    request.nextUrl.pathname.startsWith("/terms") ||
    // Marketing surfaces — must be crawlable. Auth-gating these would
    // hand search engines a /auth/login page instead of the actual
    // content, killing SEO/AEO and bouncing users who arrive from a
    // Google or ChatGPT cite.
    request.nextUrl.pathname === "/blog" ||
    request.nextUrl.pathname.startsWith("/blog/") ||
    request.nextUrl.pathname === "/faq" ||
    request.nextUrl.pathname.startsWith("/faq/") ||
    // Public marketing/conversion page — anon users need to see plans before
    // signing up; gating it would break the top-of-funnel upgrade flow.
    request.nextUrl.pathname === "/pricing" ||
    // Design-system showcase is purely a visual reference for components and
    // tokens — no user data — so it's reachable without auth. Lets reviewers
    // and contributors browse the catalogue without logging in.
    request.nextUrl.pathname.startsWith("/design-system") ||
    // Smoke tests hit /api/health from an unauthenticated runner. The
    // endpoint itself reads only server env vars (no user context) and
    // returns shallow infra status, so exposing it publicly is safe.
    request.nextUrl.pathname === "/api/health" ||
    // Stripe webhook deliveries arrive with a Stripe-Signature header but
    // no Supabase JWT — they cannot authenticate via Supabase by design.
    // The route handler verifies the signature with STRIPE_WEBHOOK_SECRET
    // and rejects unsigned/forged requests itself; bypassing the auth
    // redirect here is what lets the handler actually run. Without this,
    // every webhook is 307'd to an HTML login page and signature
    // verification never runs — the entire payment flow silently breaks.
    request.nextUrl.pathname.startsWith("/api/webhooks/") ||
    // Billing routes (checkout, portal) handle their own auth check and
    // return JSON 401 for unauthenticated requests. Redirecting them to
    // /auth/login via middleware turns a clean JSON response into an
    // HTML 307 that fetch() can't act on, so the frontend can't show
    // "session expired" or retry. The route handlers gate access; the
    // middleware just gets out of the way.
    request.nextUrl.pathname.startsWith("/api/billing/") ||
    // /api/me/entitlements serves all three tiers (anon / free / pro)
    // from a single endpoint. Redirecting unauth callers to /auth/login
    // would prevent the anon-cookie branch from running, breaking the
    // homepage's UI hydration for genuinely-anonymous visitors.
    request.nextUrl.pathname === "/api/me/entitlements";

  if (!user && !isPublicPath) {
    // no user and not accessing a public path, redirect to login
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
