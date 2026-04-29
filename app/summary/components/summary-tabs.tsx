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
  /**
   * True while it is not yet decided whether chat will unlock — i.e.
   * the summary's cache lookup / stream is still in flight. The
   * auto-bounce-away-from-?tab=chat effect is suppressed during this
   * window so that a reload of `?tab=chat` against a cached summary
   * doesn't flicker to the Summary tab before the cache resolves.
   */
  readonly chatLockPending?: boolean;
  readonly summaryContent: ReactNode;
  readonly chatContent: ReactNode;
}

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
  chatLockPending = false,
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
  // The `chatLockPending` guard: while the parent reports that the
  // summary's cache lookup hasn't resolved yet, `chatLocked` is true
  // by virtue of "no data yet, no error yet" — bouncing here would
  // cost the user their `?tab=chat` deep link the instant they reload
  // a cached summary. Wait until the parent says the lock decision is
  // final.
  useEffect(() => {
    if (active === "chat" && chatLocked && !chatLockPending) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("tab");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }
  }, [active, chatLocked, chatLockPending, pathname, router, searchParams]);

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
