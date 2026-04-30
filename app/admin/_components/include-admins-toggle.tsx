"use client";

import {
  useRouter,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface IncludeAdminsToggleProps {
  checked: boolean;
}

/**
 * Toggle wired to the ?include_admins URL param. Default unchecked
 * because admin activity skews operator-facing metrics.
 */
export function IncludeAdminsToggle({ checked }: IncludeAdminsToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (next) sp.set("include_admins", "1");
    else sp.delete("include_admins");
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="row gap-8" style={{ alignItems: "center" }}>
      <Label
        htmlFor="include-admins-toggle"
        className="muted"
        style={{ cursor: "pointer", fontSize: 12, fontWeight: 500 }}
      >
        Include admins
      </Label>
      <Switch
        id="include-admins-toggle"
        checked={checked}
        onCheckedChange={handleChange}
        aria-label="Include admins"
      />
    </div>
  );
}
