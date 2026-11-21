import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { resolveLocale } from "./locales";

export default getRequestConfig(async () => {
  const preference = (await cookies()).get("locale")?.value;
  const locale = resolveLocale(preference, (await headers()).get("accept-language"));
  return { locale, messages: (await import(`./messages/${locale}.json`)).default };
});
