"use client";

import {
  useRouter,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Calendar, ChevronDown, RefreshCcw } from "lucide-react";
import { Btn } from "./atoms";
import { DateRangePopover } from "./date-range-popover";
import { useDismissable } from "./use-dismissable";

interface DashboardControlsProps {
  windowDays: number;
  includeAdmins: boolean;
}

const WINDOW_LABEL: Record<number, string> = {
  7: "Last 7 days",
  14: "Last 14 days",
  30: "Last 30 days",
  90: "Last 90 days",
};

export function DashboardControls({
  windowDays,
  includeAdmins,
}: DashboardControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);
  useDismissable(open, wrapperRef, () => setOpen(false));

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  const toggleIncludeAdmins = () => {
    const sp = new URLSearchParams(searchParams.toString());
    if (includeAdmins) sp.delete("include_admins");
    else sp.set("include_admins", "1");
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  const label = WINDOW_LABEL[windowDays] ?? `Last ${windowDays} days`;

  return (
    <div className="row gap-8">
      <Btn
        size="sm"
        kind={includeAdmins ? undefined : "ghost"}
        onClick={toggleIncludeAdmins}
        title="Toggle whether admin-account activity is included in metrics"
      >
        {includeAdmins ? "incl. admins" : "real users"}
      </Btn>
      <div ref={wrapperRef} style={{ position: "relative" }}>
        <Btn size="sm" onClick={() => setOpen(!open)}>
          <Calendar size={13} /> {label}
          <ChevronDown size={12} />
        </Btn>
        {open && (
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              zIndex: 50,
            }}
          >
            <DateRangePopover onClose={() => setOpen(false)} />
          </div>
        )}
      </div>
      <Btn
        size="sm"
        kind="ghost"
        aria-label="Refresh"
        onClick={refresh}
        disabled={isPending}
      >
        <RefreshCcw size={13} />
      </Btn>
    </div>
  );
}
