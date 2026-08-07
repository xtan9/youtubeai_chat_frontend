"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

export const SUMMARY_TAB_VALUES = ["summary", "transcript", "chat"] as const;
export type SummaryTabValue = (typeof SUMMARY_TAB_VALUES)[number];

export interface SummaryTabsHandle {
  /**
   * Saves the current tab's document position before another interaction
   * temporarily reveals content above the tab rail (for example, a
   * Transcript timestamp revealing the Video).
   */
  preserveActiveScrollPosition: () => void;
}

interface SummaryTabsProps {
  readonly chatLocked: boolean;
  readonly chatLockedReason?: string;
  /**
   * Distinguishes a permanent lock from a momentarily-disabled tab
   * (cache lookup in flight, stream still producing). Only permanent
   * locks should rewrite the URL away from `?tab=chat`; momentary
   * locks resolve on their own and the Learner gets the Video Chat
   * surface they asked for.
   */
  readonly chatPermanentlyLocked?: boolean;
  readonly summaryContent: ReactNode;
  readonly transcriptContent: ReactNode;
  readonly chatContent: ReactNode;
}

const MOBILE_STICKY_TOP_FALLBACK_PX = 73;

function getDocumentOffsetTop(element: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

function isValidTab(value: string | null): value is SummaryTabValue {
  return SUMMARY_TAB_VALUES.some((tab) => tab === value);
}

/**
 * URL-backed Summary workspace navigation. Phones get Summary, Transcript,
 * and Chat as peer tabs; larger screens retain the established Summary/Chat
 * strip because Transcript remains beside the Video there.
 */
export const SummaryTabs = forwardRef<SummaryTabsHandle, SummaryTabsProps>(
  function SummaryTabs(
    {
      chatLocked,
      chatLockedReason = "Available after summary completes",
      chatPermanentlyLocked = false,
      summaryContent,
      transcriptContent,
      chatContent,
    },
    ref,
  ) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isMobile = useIsMobile();
    const tabParam = searchParams.get("tab");
    const requestedTab: SummaryTabValue = isValidTab(tabParam)
      ? tabParam
      : "summary";
    const active: SummaryTabValue =
      !isMobile && requestedTab === "transcript" ? "summary" : requestedTab;
    const railRef = useRef<HTMLDivElement>(null);
    const previousActiveRef = useRef<SummaryTabValue | null>(null);
    const scrollPositionsRef = useRef<Partial<Record<SummaryTabValue, number>>>({});
    const preservedBeforeRevealRef = useRef<SummaryTabValue | null>(null);

    // The app header grows from 73px to 89px when its brand wraps on narrow
    // phones. Reflect the measured height into a CSS variable instead of
    // pinning the rail to a brittle breakpoint-specific constant.
    useEffect(() => {
      if (!isMobile) return;
      const rail = railRef.current;
      const header = document.querySelector<HTMLElement>("header");
      if (!rail || !header) return;
      const workspace = rail.parentElement;
      if (!workspace) return;

      const updateStickyTop = () => {
        workspace.style.setProperty(
          "--summary-tabs-sticky-top",
          `${Math.ceil(header.getBoundingClientRect().height)}px`,
        );
      };
      updateStickyTop();

      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(updateStickyTop);
      observer?.observe(header);
      return () => {
        observer?.disconnect();
        workspace.style.removeProperty("--summary-tabs-sticky-top");
      };
    }, [isMobile]);

    useImperativeHandle(
      ref,
      () => ({
        preserveActiveScrollPosition: () => {
          if (!isMobile) return;
          scrollPositionsRef.current[active] = window.scrollY;
          preservedBeforeRevealRef.current = active;
        },
      }),
      [active, isMobile],
    );

    // A first visit starts at the panel boundary beneath the pinned rail;
    // returning restores the previous document position. Refs hold these
    // transient values so scrolling never causes React re-renders.
    useLayoutEffect(() => {
      const previousActive = previousActiveRef.current;
      if (previousActive === null) {
        previousActiveRef.current = active;
        return;
      }
      if (previousActive === active) return;

      if (isMobile) {
        if (preservedBeforeRevealRef.current === previousActive) {
          preservedBeforeRevealRef.current = null;
        }

        const savedPosition = scrollPositionsRef.current[active];
        const rail = railRef.current;
        const stickyTop = rail
          ? Number.parseFloat(
              getComputedStyle(rail).getPropertyValue(
                "--summary-tabs-sticky-top",
              ),
            ) || MOBILE_STICKY_TOP_FALLBACK_PX
          : MOBILE_STICKY_TOP_FALLBACK_PX;
        const railTop = rail
          ? getDocumentOffsetTop(rail) - stickyTop
          : 0;
        const target = Math.max(0, savedPosition ?? railTop);
        const frame = window.requestAnimationFrame(() => {
          window.scrollTo({ top: target, behavior: "auto" });
        });

        previousActiveRef.current = active;
        return () => window.cancelAnimationFrame(frame);
      }

      previousActiveRef.current = active;
    }, [active, isMobile]);

    // A permanently locked Video Chat cannot recover without a new Summary
    // Run. Replace that deep link with Summary; momentary locks remain on the
    // requested URL and unlock in place when processing finishes.
    useEffect(() => {
      if (active !== "chat" || !chatPermanentlyLocked) return;
      const next = new URLSearchParams(searchParams.toString());
      next.delete("tab");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }, [active, chatPermanentlyLocked, pathname, router, searchParams]);

    const setTab = useCallback(
      (value: string) => {
        if (!isValidTab(value)) return;
        if (isMobile) {
          scrollPositionsRef.current[active] = window.scrollY;
        }
        const next = new URLSearchParams(searchParams.toString());
        if (value === "summary") {
          next.delete("tab");
        } else {
          next.set("tab", value);
        }
        const query = next.toString();
        router.push(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      },
      [active, isMobile, pathname, router, searchParams],
    );

    return (
      <Tabs value={active} onValueChange={setTab} className="w-full gap-3">
        <div
          ref={railRef}
          data-testid="summary-tab-rail"
          className="sticky top-[var(--summary-tabs-sticky-top,73px)] z-40 -mx-4 bg-surface-base/95 px-4 py-2 backdrop-blur-md md:static md:z-auto md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
        >
          <TabsList className="w-full self-start md:w-fit">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            {isMobile ? (
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
            ) : null}
            {chatLocked ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex flex-1" tabIndex={0}>
                      <TabsTrigger
                        value="chat"
                        className="w-full"
                        disabled
                        aria-disabled="true"
                      >
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
        </div>
        <TabsContent value="summary">{summaryContent}</TabsContent>
        {isMobile ? (
          <TabsContent value="transcript">{transcriptContent}</TabsContent>
        ) : null}
        <TabsContent value="chat">{chatContent}</TabsContent>
      </Tabs>
    );
  },
);
