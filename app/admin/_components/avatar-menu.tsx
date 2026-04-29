"use client";

import { UserCheck, Users, Moon, Command, LogOut } from "lucide-react";
import { Avatar, Pill } from "./atoms";
import { useAdmin } from "./admin-context";

interface AvatarMenuProps {
  onSignOut: () => void | Promise<void>;
}

export function AdminAvatarMenu({ onSignOut }: AvatarMenuProps) {
  const { email: adminEmail } = useAdmin();
  const initials = adminEmail.slice(0, 2).toUpperCase();
  const handle = adminEmail.split("@")[0];

  return (
    <div className="menu" onClick={(e) => e.stopPropagation()} style={{ minWidth: 280 }}>
      <div className="menu-h">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Avatar idx={1} label={initials} size={32} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{handle}</div>
            <div className="text-xs muted mono">{adminEmail}</div>
          </div>
        </div>
        <div className="row gap-6" style={{ marginTop: 8 }}>
          <Pill tone="bad">
            <span className="dot" />
            admin
          </Pill>
          <Pill mono>session</Pill>
        </div>
      </div>
      <div className="menu-item" aria-disabled="true" style={{ opacity: 0.5, cursor: "default" }}>
        <UserCheck className="icon" /> View as user… <span className="kbd">⌥V</span>
      </div>
      <div className="menu-item" aria-disabled="true" style={{ opacity: 0.5, cursor: "default" }}>
        <Users className="icon" /> Switch admin…
      </div>
      <div className="menu-item" aria-disabled="true" style={{ opacity: 0.5, cursor: "default" }}>
        <Moon className="icon" /> Theme
        <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 12 }}>System ▾</span>
      </div>
      <div className="menu-item" aria-disabled="true" style={{ opacity: 0.5, cursor: "default" }}>
        <Command className="icon" /> Command palette <span className="kbd">⌘K</span>
      </div>
      <div className="menu-sep" />
      <div className="menu-item" onClick={() => void onSignOut()}>
        <LogOut className="icon" />
        <span style={{ color: "var(--bad)" }}>Sign out</span>
      </div>
    </div>
  );
}
