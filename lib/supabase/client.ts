import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAuthCookieOptions } from "./auth-cookie";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    { cookieOptions: getSupabaseAuthCookieOptions() },
  );
}
