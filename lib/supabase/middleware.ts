import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

function isPublicPath(pathname: string): boolean {
  return (
    // Public product, auth, and marketing surfaces must remain crawlable and
    // usable before a Learner has a session.
    pathname === "/" ||
    pathname.startsWith("/summary") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname === "/faq" ||
    pathname.startsWith("/faq/") ||
    pathname === "/pricing" ||
    pathname.startsWith("/design-system") ||
    // These API routes perform their own health, signature, or tier-aware
    // authorization checks and must not be converted into HTML redirects.
    pathname === "/api/health" ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/billing/") ||
    pathname === "/api/me/entitlements"
  );
}

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/login";
  return NextResponse.redirect(url);
}

function redirectToDashboard(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/dashboard", request.url));
}

function isAuthenticatedEntryPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/auth/login" ||
    pathname === "/auth/login/"
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip middleware check. You can remove this once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const publicPath = isPublicPath(request.nextUrl.pathname);

  // Authenticated Supabase browsers carry sb-*-auth-token (or a chunked
  // variant). With no auth cookie there is no session to validate or refresh,
  // so avoid a remote auth call for crawlers and unauthenticated requests.
  if (!hasSupabaseAuthCookie(request)) {
    return publicPath ? supabaseResponse : redirectToLogin(request);
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

  // Logged-in users get the personal dashboard instead of public entry
  // surfaces. The redirect lives here (not in a cached page component) so
  // the decision always sees the request's current auth cookies.
  // The `!is_anonymous` guard excludes Supabase anonymous-auth sessions
  // (issued by the hero demo's signInAnonymously() so visitors can chat
  // without signing up) — those users have a real JWT but no account, so
  // they should keep seeing the marketing homepage and login form, not get
  // bounced to a dashboard with an empty greeting and no history.
  if (
    user &&
    !(user.is_anonymous ?? false) &&
    isAuthenticatedEntryPath(request.nextUrl.pathname)
  ) {
    return redirectToDashboard(request);
  }

  if (!user && !publicPath) {
    // no user and not accessing a public path, redirect to login
    return redirectToLogin(request);
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
