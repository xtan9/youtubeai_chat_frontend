"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const SUMMARY_TAB_VALUES = ["summary", "chat"] as const;
export type SummaryTabValue = (typeof SUMMARY_TAB_VALUES)[number];

interface SummaryTabsProps {
  readonly chatLocked: boolean;
  readonly chatLockedReason?: string;
  readonly summaryContent: ReactNode;
  readonly chatContent: ReactNode;
}

// Window during which `?tab=chat` won't be auto-bounced even if the
// chat tab is currently locked. Cache hits for previously-summarized
// videos resolve in well under this; permanent locks (no summary
// exists) outlast it and bounce normally. Tuned by observation in
// prod — the predicate-based suppression in the prior round of this
// fix flipped false before `dataWithLiveTimers` populated, causing
// the bounce to fire anyway on cached reloads.
const BOUNCE_DELAY_MS = 1500;

function isValidTab(value: string | null): value is SummaryTabValue {
  return value === "summary" || value === "chat";
}

/**
 * Two-tab strip that syncs the active tab to ?tab= so back/forward and
 * deep links work. The chat trigger is disabled (with a tooltip) until
 * the parent reports the summary is ready.
 */
export function SummaryTabs({
  chatLocked,
  chatLockedReason = "Available after summary completes",
  summaryContent,
  chatContent,
}: SummaryTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const active: SummaryTabValue = useMemo(
    () => (isValidTab(tabParam) ? tabParam : "summary"),
    [tabParam]
  );

  // If chat is locked but the URL still says ?tab=chat (e.g. user
  // bookmarked the chat tab and came back to a non-cached video), bounce
  // the URL state back to summary so the disabled tab doesn't render an
  // empty content panel.
  //
  // We delay the bounce by `BOUNCE_DELAY_MS` rather than gating on a
  // parent-supplied "still loading" predicate: the prior predicate-
  // based fix flipped false before `dataWithLiveTimers` populated on
  // cached reloads, so the bounce fired anyway. The timer survives
  // re-renders because the cleanup only runs when chatLocked changes
  // — if chat unlocks within the window, the timer is cleared and no
  // bounce fires; if it doesn't, the bounce lands and the user gets
  // sent to Summary.
  useEffect(() => {
    if (active !== "chat" || !chatLocked) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("tab");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }, BOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [active, chatLocked, pathname, router, searchParams]);

  const setTab = useCallback(
    (value: string) => {
      if (!isValidTab(value)) return;
      const next = new URLSearchParams(searchParams.toString());
      if (value === "summary") {
        next.delete("tab");
      } else {
        next.set("tab", value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  return (
    <Tabs value={active} onValueChange={setTab} className="w-full gap-3">
      <TabsList className="self-start">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        {chatLocked ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <TabsTrigger value="chat" disabled aria-disabled="true">
                    Chat
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>{chatLockedReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <TabsTrigger value="chat">Chat</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="summary">{summaryContent}</TabsContent>
      <TabsContent value="chat">{chatContent}</TabsContent>
    </Tabs>
  );
}
