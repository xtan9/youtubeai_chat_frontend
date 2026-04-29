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
   * Distinguishes a permanent lock from a momentarily-disabled tab
   * (cache lookup in flight, stream still producing). Only permanent
   * locks should rewrite the URL away from `?tab=chat`; momentary
   * locks resolve on their own and the user gets the chat surface
   * they asked for.
   *
   * Parent computes this from `!!streamError` — the only state
   * where we know chat will never unlock without user action.
   */
  readonly chatPermanentlyLocked?: boolean;
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
  chatPermanentlyLocked = false,
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

  // If chat is PERMANENTLY locked (parent reports a streamError), the
  // URL's `?tab=chat` will never resolve to a usable chat surface —
  // rewrite it back to Summary so the user lands somewhere useful.
  //
  // For momentary locks (cache lookup in flight, stream still
  // producing) we DO NOT bounce: the prior time-based delays kept
  // racing with the streaming pipeline and bouncing legitimate
  // cached reloads in production. Tying the bounce to a
  // "definitively won't unlock" signal eliminates the race entirely.
  useEffect(() => {
    if (active !== "chat" || !chatPermanentlyLocked) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("tab");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [active, chatPermanentlyLocked, pathname, router, searchParams]);

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
