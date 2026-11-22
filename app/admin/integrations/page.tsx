import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPlatformIntegrations } from "@/components/admin/admin-platform-integrations";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { apiPlatformLabel } from "@/components/admin/admin-paths";
import { adminLoginPath } from "@/lib/auth/config";
import { appConfig } from "@/lib/config/app";
import { getRenderAuth } from "@/lib/auth/render";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${apiPlatformLabel} · ${appConfig.name}`, robots: { index: false, follow: false } };

export default async function AdminIntegrationsPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: "/admin/integrations" }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  return <AdminPlatformIntegrations email={auth.email} />;
}
