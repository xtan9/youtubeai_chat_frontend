import type { ReactNode } from "react";
import { requireAdminPage } from "./_components/admin-gate";
import { AdminProvider } from "./_components/admin-context";
import { AdminSidebar } from "./_components/sidebar";
import { AdminTopbar } from "./_components/topbar";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { email } = await requireAdminPage();

  return (
    <AdminProvider email={email}>
      <div data-admin-scope>
        <div className="admin-app">
          <AdminSidebar adminEmail={email} />
          <main className="admin-main">
            <AdminTopbar adminEmail={email} />
            {children}
          </main>
        </div>
      </div>
    </AdminProvider>
  );
}
