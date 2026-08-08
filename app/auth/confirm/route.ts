import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import {
  DEFAULT_AUTH_REDIRECT,
  normalizeAuthRedirect,
} from "@/lib/auth/signup-redirect";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

function redirectToAuthError(request: NextRequest, message: string): never {
  const url = new URL("/auth/error", request.url);
  url.searchParams.set("error", message);
  redirect(`${url.pathname}${url.search}`);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = normalizeAuthRedirect(
    searchParams.get("next") ?? DEFAULT_AUTH_REDIRECT,
  );

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      redirect(next);
    } else {
      redirectToAuthError(request, error.message);
    }
  }

  redirectToAuthError(request, "No token hash or type");
}
