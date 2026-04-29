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

export function AdminTopbar() {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const { email: adminEmail } = useAdmin();
  const current = findNavLabel(pathname);
  const initials = adminEmail.slice(0, 2).toUpperCase();
  useDismissable(menuOpen, menuWrapperRef, () => setMenuOpen(false));

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
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
              <AdminAvatarMenu
                onSignOut={handleSignOut}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
