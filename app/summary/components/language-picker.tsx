"use client";

import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  SUPPORTED_OUTPUT_LANGUAGES,
  getLanguage,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";

interface LanguagePickerProps {
  /**
   * Language of the currently-rendered summary. `null` means "video-native"
   * — no explicit translation picked yet; button shows "Auto" to avoid
   * lying about which language is on screen (we don't know the video's
   * language client-side on first render).
   */
  readonly currentLanguage: SupportedLanguageCode | null;
  /** Browser-preferred language from `pickDefaultLanguage`. Tagged in the menu. */
  readonly browserLanguage: SupportedLanguageCode;
  /** Fires for any selection, including the already-current one (parent decides what's a no-op). */
  readonly onSelect: (code: SupportedLanguageCode) => void;
  readonly isDark: boolean;
  readonly disabled?: boolean;
}

export function LanguagePicker({
  currentLanguage,
  browserLanguage,
  onSelect,
  isDark,
  disabled,
}: LanguagePickerProps) {
  const current = currentLanguage ? getLanguage(currentLanguage) : null;
  const buttonLabel = current ? current.native : "Auto";
  const ariaLabel = current
    ? `Summary language: ${current.english}. Click to change.`
    : "Summary language: video's own language. Click to translate.";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={
            isDark
              ? "bg-white/5 border-white/20 text-white hover:bg-white/10"
              : "bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200"
          }
        >
          <Globe className="mr-2 h-4 w-4" />
          {buttonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Tailwind v4 doesn't resolve shadcn's default `bg-popover` token
        // without a `@config`/`@theme` bridge in globals.css, so the menu
        // ships fully transparent and the summary bleeds through. Pin the
        // background via arbitrary-value utilities that read the CSS vars
        // directly — works in both light and dark because `--popover` is
        // defined in both `:root` and `.dark`.
        className="max-h-96 overflow-y-auto min-w-56 bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))]"
      >
        {SUPPORTED_OUTPUT_LANGUAGES.map((lang) => {
          const isCurrent = currentLanguage !== null && lang.code === currentLanguage;
          const isBrowser =
            lang.code === browserLanguage && !isCurrent;
          return (
            <DropdownMenuItem
              key={lang.code}
              onSelect={() => onSelect(lang.code)}
              data-testid={`lang-option-${lang.code}`}
              aria-current={isCurrent ? "true" : undefined}
              // Same Tailwind-v4 story as the container's bg-[hsl(var(--popover))]:
              // shadcn's default `focus:bg-accent` doesn't resolve without a
              // theme bridge, so keyboard nav and hover render without any
              // highlight. Pin the focus/hover state via arbitrary values.
              className="flex items-center justify-between gap-3 focus:bg-[hsl(var(--accent))] focus:text-[hsl(var(--accent-foreground))]"
            >
              <span className="flex flex-col">
                <span className="font-medium">{lang.native}</span>
                {lang.english !== lang.native && (
                  <span className="text-xs text-muted-foreground">
                    {lang.english}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {isBrowser && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Your&nbsp;language
                  </span>
                )}
                {isCurrent && <Check className="h-4 w-4" />}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
