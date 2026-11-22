import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPlatformIntegrations } from "@/components/admin/admin-platform-integrations";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { adminLoginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API 및 플랫폼 연동 · Dream AI Studio", robots: { index: false, follow: false } };

export default async function AdminIntegrationsPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: "/admin/integrations" }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  return <AdminPlatformIntegrations email={auth.email} />;
}
