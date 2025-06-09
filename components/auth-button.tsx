import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/server";
import { ProfileAvatarWrapper } from "./profile-avatar-wrapper";

export async function AuthButton() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? (
    <ProfileAvatarWrapper user={user} />
  ) : (
    <div className="flex gap-2">
      <Button asChild size="sm" variant={"outline"} className="border-white/20 text-white hover:bg-white/10">
        <Link href="/auth/login">Sign in</Link>
      </Button>
      <Button asChild size="sm" variant={"default"} className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600">
        <Link href="/auth/sign-up">Sign up</Link>
      </Button>
    </div>
  );
}
