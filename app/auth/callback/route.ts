import { NextResponse } from "next/server";
// The client you created from the Server-Side Auth instructions
import {
  DEFAULT_AUTH_REDIRECT,
  normalizeAuthRedirect,
} from "@/lib/auth/signup-redirect";
import { createClient } from "@/lib/supabase/server";

const CALLBACK_ERROR_MESSAGE = "Authentication link is invalid or expired.";

function redirectToAuthError(origin: string): NextResponse {
  const url = new URL("/auth/error", origin);
  url.searchParams.set("error", CALLBACK_ERROR_MESSAGE);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = normalizeAuthRedirect(
    searchParams.get("next") ?? DEFAULT_AUTH_REDIRECT,
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host"); // original origin before load balancer
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        // we can be sure that there is no load balancer in between, so no need to watch for X-Forwarded-Host
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return redirectToAuthError(origin);
}
