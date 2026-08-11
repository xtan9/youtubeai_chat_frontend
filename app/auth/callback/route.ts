import { NextResponse } from "next/server";
// The client you created from the Server-Side Auth instructions
import {
  DEFAULT_AUTH_REDIRECT,
  normalizeAuthRedirect,
} from "@/lib/auth/signup-redirect";
import { createClient } from "@/lib/supabase/server";
import { captureAnonymousTrialConversion } from "@/lib/analytics/server";

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
  const conversionMethod = searchParams.get("anonymous_trial_conversion");
  const governedConversionMethod =
    conversionMethod === "email" || conversionMethod === "google"
      ? conversionMethod
      : null;

  if (code) {
    const supabase = await createClient();
    const before = governedConversionMethod
      ? await supabase.auth.getUser()
      : null;
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (before?.data.user?.is_anonymous === true && governedConversionMethod) {
        const after = await supabase.auth.getUser();
        if (
          after.data.user?.is_anonymous === false &&
          after.data.user.id === before.data.user.id
        ) {
          await captureAnonymousTrialConversion(
            after.data.user.id,
            governedConversionMethod,
            { app_metadata: after.data.user.app_metadata },
          );
        }
      }
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
