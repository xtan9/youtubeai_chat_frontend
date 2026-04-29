import type { ReactNode } from "react";
import { requireAdminPage } from "./_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { fetchUsersTotal } from "@/lib/admin/queries";
import { AdminProvider } from "./_components/admin-context";
import { AdminSidebar } from "./_components/sidebar";
import { AdminTopbar } from "./_components/topbar";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const usersTotal = await fetchUsersTotal(client);

  return (
    <AdminProvider email={principal.email}>
      <div data-admin-scope>
        <div className="admin-app">
          <AdminSidebar adminEmail={principal.email} usersTotal={usersTotal} />
          <main className="admin-main">
            <AdminTopbar />
            {children}
          </main>
        </div>
      </div>
    </AdminProvider>
  );
}
