"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Search, Command } from "lucide-react";
import { Btn, Avatar } from "./atoms";
import { AdminAvatarMenu } from "./avatar-menu";

const PATH_LABELS: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/users": "Users",
  "/admin/audit": "Audit log",
  "/admin/performance": "Performance",
};

interface TopbarProps {
  adminEmail: string;
}

export function AdminTopbar({ adminEmail }: TopbarProps) {
  const pathname = usePathname() ?? "/admin";
  const [menuOpen, setMenuOpen] = useState(false);
  const current = PATH_LABELS[pathname] ?? "Page";
  const initials = adminEmail.slice(0, 2).toUpperCase();

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
        <div style={{ position: "relative" }}>
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
                adminEmail={adminEmail}
                onClose={() => setMenuOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
