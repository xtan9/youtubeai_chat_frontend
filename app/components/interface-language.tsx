"use client";

import {useLocale, useTranslations} from "next-intl";
import {useRouter} from "next/navigation";
import {localeNames} from "@/i18n/locales";

export function InterfaceLanguage() {
  const locale = useLocale();
  const t = useTranslations("ui");
  const router = useRouter();
  return (
    <select aria-label={t("interfaceLanguage")} value={locale}
      className="max-w-24 rounded-md bg-transparent text-sm"
      onChange={(event) => {
        document.cookie = `locale=${event.target.value}; Path=/; Max-Age=31536000; SameSite=Lax`;
        router.refresh();
      }}>
      {Object.entries(localeNames).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  );
}
