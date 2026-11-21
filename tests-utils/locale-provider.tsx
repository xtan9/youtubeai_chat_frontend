import {NextIntlClientProvider} from "next-intl";
import {render} from "@testing-library/react";
import type {ReactElement, ReactNode} from "react";
import messages from "@/i18n/messages/en.json";

export function TestLocaleProvider({children}: {children: ReactNode}) {
  return <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">{children}</NextIntlClientProvider>;
}

export function renderWithLocale(ui: ReactElement) {
  return render(ui, {wrapper: TestLocaleProvider});
}
