"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Activity,
  Gauge,
  DollarSign,
  Shield,
  Video,
  Languages,
  ScrollText,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface NavItemConfig {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: string;
  alert?: boolean;
}

const SECTIONS: { label: string; items: NavItemConfig[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: <LayoutDashboard className="icon" /> },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/admin/users", label: "Users", icon: <Users className="icon" />, badge: "1,284" },
      { href: "/admin/audit", label: "Audit log", icon: <Activity className="icon" /> },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/admin/performance",
        label: "Performance",
        icon: <Gauge className="icon" />,
        alert: true,
      },
      { href: "/admin/cost", label: "Cost", icon: <DollarSign className="icon" /> },
      { href: "/admin/reliability", label: "Reliability", icon: <Shield className="icon" /> },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/channels", label: "Channels", icon: <Video className="icon" /> },
      { href: "/admin/languages", label: "Languages", icon: <Languages className="icon" /> },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/audit-archive", label: "Audit archive", icon: <ScrollText className="icon" /> },
      { href: "/admin/settings", label: "Settings", icon: <Settings className="icon" /> },
    ],
  },
];

interface SidebarProps {
  adminEmail: string;
}

export function AdminSidebar({ adminEmail }: SidebarProps) {
  const pathname = usePathname();
  const initials = adminEmail.slice(0, 2).toUpperCase();
  const handle = adminEmail.split("@")[0];

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
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="sb-section">{section.label}</div>
            {section.items.map((item) => {
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname?.startsWith(item.href);
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
