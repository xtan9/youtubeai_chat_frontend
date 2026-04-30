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
  /** When true the URL has ?include_admins=1 and admin activity is shown. */
  checked: boolean;
}

/**
 * Small client toggle wired to ?include_admins URL state. Shared by
 * /admin and /admin/performance — both read the same URL param.
 *
 * Default unchecked = exclude admins (the operator-friendly default
 * the spec calls for).
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
