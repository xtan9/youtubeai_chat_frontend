export const localeNames = { en: "English", zh: "简体中文", "zh-TW": "繁體中文" } as const;
export type Locale = keyof typeof localeNames;

export function resolveLocale(preference?: string, header?: string | null): Locale {
  if (preference && Object.hasOwn(localeNames, preference)) return preference as Locale;
  const preferences = (header ?? "").toLowerCase().split(",").map((entry) => {
    const [tag, weight] = entry.trim().split(/\s*;\s*q=/);
    return { tag, weight: Number(weight ?? 1) };
  }).filter(({ weight }) => weight > 0 && weight <= 1).sort((a, b) => b.weight - a.weight);
  for (const { tag } of preferences) {
    if (/^en(?:-|$)/.test(tag)) return "en";
    if (/^zh(?:-|$)/.test(tag)) {
      return /(?:^|-)(?:hant|tw|hk|mo)(?:-|$)/.test(tag) ? "zh-TW" : "zh";
    }
  }
  return "en";
}
