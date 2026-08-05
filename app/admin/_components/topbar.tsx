"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronDown, Search, Command } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Btn, Avatar } from "./atoms";
import { AdminAvatarMenu } from "./avatar-menu";
import { findNavLabel } from "./nav-config";
import { useAdmin } from "./admin-context";
import { useDismissable } from "./use-dismissable";
import { ReportCompletenessNotice } from "./report-completeness";
import type { ReportCompletenessWarning } from "@/lib/admin/report-completeness";

export function AdminTopbar({
  completenessWarnings = [],
}: {
  completenessWarnings?: readonly ReportCompletenessWarning[];
}) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const { email: adminEmail } = useAdmin();
  const current = findNavLabel(pathname);
  const initials = adminEmail.slice(0, 2).toUpperCase();
  useDismissable(menuOpen, menuWrapperRef, () => setMenuOpen(false));

  async function handleSignOut() {
    const supabase = createClient();
    setSignOutError(null);

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.error("[admin-topbar] signOut failed", {
          status: error.status ?? null,
          message: error.message,
        });
        setSignOutError("Couldn't sign you out. Check your connection and try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (error: unknown) {
      console.error("[admin-topbar] signOut failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      setSignOutError("Couldn't sign you out. Check your connection and try again.");
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="crumbs">
          <span>Admin</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-cur">{current}</span>
        </div>
        <div className="topbar-r">
          <Btn size="sm" kind="ghost">
            <Search size={13} /> Search
            <span className="kbd">
              <Command size={9} />K
            </span>
          </Btn>
          <div ref={menuWrapperRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="btn btn-ghost btn-sm"
              style={{ padding: "3px 4px" }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Avatar idx={1} label={initials} size={22} />
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  zIndex: 50,
                }}
              >
                <AdminAvatarMenu onSignOut={handleSignOut} />
              </div>
            )}
          </div>
        </div>
      </div>
      {signOutError ? (
        <div className="auth-action-error" role="alert" aria-live="assertive">
          {signOutError}
        </div>
      ) : null}
      <ReportCompletenessNotice warnings={completenessWarnings} />
    </>
  );
}
