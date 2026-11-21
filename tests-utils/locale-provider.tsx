import {NextIntlClientProvider} from "next-intl";
import type {ReactNode} from "react";
import messages from "@/i18n/messages/en.json";

export function TestLocaleProvider({children}: {children: ReactNode}) {
  return <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">{children}</NextIntlClientProvider>;
}
