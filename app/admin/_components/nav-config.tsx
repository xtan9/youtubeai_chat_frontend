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

export interface NavItemConfig {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: string;
  alert?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItemConfig[];
}

export interface BuildAdminNavOptions {
  usersTotal: number | null;
}

export function buildAdminNav({ usersTotal }: BuildAdminNavOptions): NavSection[] {
  return [
    {
      label: "Overview",
      items: [
        { href: "/admin", label: "Dashboard", icon: <LayoutDashboard className="icon" /> },
      ],
    },
    {
      label: "People",
      items: [
        {
          href: "/admin/users",
          label: "Users",
          icon: <Users className="icon" />,
          badge:
            usersTotal !== null
              ? usersTotal.toLocaleString("en-US")
              : undefined,
        },
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
}

// Internal canonical reference used by findNavLabel/isNavItemActive — these
// helpers don't depend on the badge state, so they read from a stable nav
// snapshot built with usersTotal=null.
const NAV_REFERENCE: NavSection[] = buildAdminNav({ usersTotal: null });

export function findNavLabel(pathname: string): string {
  for (const section of NAV_REFERENCE) {
    for (const item of section.items) {
      if (item.href === pathname) return item.label;
    }
  }
  return "Page";
}

/** Active when the path equals the item or is a strict descendant. Avoids `/admin/audit` matching `/admin/audit-archive`. */
export function isNavItemActive(itemHref: string, pathname: string): boolean {
  if (itemHref === "/admin") return pathname === "/admin";
  return pathname === itemHref || pathname.startsWith(itemHref + "/");
}
