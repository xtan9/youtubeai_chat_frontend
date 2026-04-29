"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { buildAdminNav, isNavItemActive } from "./nav-config";

interface AdminSidebarProps {
  adminEmail: string;
  usersTotal: number | null;
}

export function AdminSidebar({ adminEmail, usersTotal }: AdminSidebarProps) {
  const pathname = usePathname() ?? "";
  const initials = adminEmail.slice(0, 2).toUpperCase();
  const handle = adminEmail.split("@")[0];
  const nav = buildAdminNav({ usersTotal });

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <span className="sb-mark">YA</span>
        <span className="sb-brand">youtubeai</span>
        <span className="sb-divider">/</span>
        <span className="sb-brand muted">admin</span>
        <span className="sb-pill-admin">
          <span className="dot" /> Internal
        </span>
      </div>

      <nav className="sb-nav">
        {nav.map((section) => (
          <div key={section.label}>
            <div className="sb-section">{section.label}</div>
            {section.items.map((item) => {
              const isActive = isNavItemActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn("sb-item", isActive && "active")}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge && <span className="badge">{item.badge}</span>}
                  {item.alert && <span className="alert-dot" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sb-footer">
        <span className="sb-avatar">{initials}</span>
        <div>
          <div className="sb-name">{handle}</div>
          <div className="sb-role">admin</div>
        </div>
      </div>
    </aside>
  );
}
