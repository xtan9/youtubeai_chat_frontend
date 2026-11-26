"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InterfaceLanguage } from "@/app/components/interface-language";
import { InkIcon } from "./ink-icon";
import "./intent.css";

export function IntentShell({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  const t = useTranslations("intent");
  return (
    <div data-compact={compact || undefined} className="intent-shell ph-no-capture" data-ph-no-autocapture>
      <header>
        <Link className="brand" href="/workspace">
          <span className="brand-mark">
            <InkIcon name="layers" />
          </span>
          Workspace
        </Link>
        <div className="header-actions">
          <InterfaceLanguage />
          <Link className="link" href="/dashboard">
            {t("dashboard")}
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
