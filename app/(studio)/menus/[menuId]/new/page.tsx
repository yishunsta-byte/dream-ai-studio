import { notFound } from "next/navigation";
import { getMenuConfig } from "@/lib/menus/server";
import { PageHeader } from "@/components/ui/primitives";
import { ProjectForm } from "@/components/project-form";
import { projectChoices } from "@/lib/services/projects";
import { snapshotForMenu } from "@/lib/menus/snapshot";

export default async function NewProjectPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const config=getMenuConfig();
  const menu = config.menus.find((entry)=>entry.id===menuId);
  if (!menu || menu.availability !== "active") notFound();
  return <><PageHeader title="새 프로젝트" description={`${menu.label}의 목표와 자료를 알려 주세요.`} /><ProjectForm snapshot={snapshotForMenu(config,menu)} choices={projectChoices()} /></>;
}
