import { PrivateProjectWorkspace } from "./private-project-workspace";

import { PageHeader } from "@/components/ui/primitives";
import { getMenuConfig } from "@/lib/menus/server";
import { snapshotForMenu } from "@/lib/menus/snapshot";

export function PrivatePngProjectPage() {
  const config = getMenuConfig();
  const menu = config.menus.find(item => item.id === "shopping-shorts" && item.availability === "active");
  if (!menu) throw new Error("Shopping shorts menu unavailable");
  return <>
    <PageHeader title="새 프로젝트" description="제품 사진과 쇼핑숏츠 제작 정보를 등록하세요." />
    <PrivateProjectWorkspace snapshot={snapshotForMenu(config, menu)} />

  </>;
}
