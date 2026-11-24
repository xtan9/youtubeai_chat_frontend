import { useTranslations } from "next-intl";

export function ThinkingDots({ label }: { label?: string }) {
  const t = useTranslations("reader");
  return (
    <span role="status" aria-label={label ?? t("thinking")} className="flex items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="size-1.5 rounded-full bg-current motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
