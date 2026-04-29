import type { ReactNode } from "react";
import { requireAdminPage } from "./_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { fetchUsersTotal } from "@/lib/admin/queries";
import { reconcileAdminFlags } from "@/lib/admin/admin-flag-sync";
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

  // Fire-and-forget: reconcile is_admin flags against ADMIN_EMAILS. Never
  // blocks the layout render — eventual consistency is acceptable for
  // flag state. See lib/admin/admin-flag-sync.ts.
  void reconcileAdminFlags(client, principal.allowlist).catch((err) => {
    console.error("[admin-layout] reconcileAdminFlags rejected", {
      message: err instanceof Error ? err.message : String(err),
    });
  });

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
