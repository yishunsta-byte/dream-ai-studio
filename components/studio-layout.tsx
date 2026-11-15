import type { ReactNode } from "react";
import { getMenuConfig } from "@/lib/menus/server";
import { StudioShell } from "./studio-shell";

export function StudioLayout({ children }: { children: ReactNode }) {
  const config = getMenuConfig();
  return <StudioShell navigation={{groups:config.groups,menus:config.menus.map(({id,label,group,phase,availability})=>({id,label,group,phase,availability})),workspaces:config.workspaces.map(({id,label})=>({id,label}))}} sampleMode={process.env.MOCK_MODE !== "false"}>{children}</StudioShell>;
}
