"use client";

import { createContext, useContext, type ReactNode } from "react";

interface AdminContextValue {
  email: string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  return <AdminContext.Provider value={{ email }}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}
