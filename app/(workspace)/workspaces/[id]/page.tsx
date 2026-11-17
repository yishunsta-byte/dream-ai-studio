import { notFound } from "next/navigation";
import { getMenuConfig } from "@/lib/menus/server";
import { Card, Callout, PageHeader, PhaseChip } from "@/components/ui/primitives";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
 const blocked=await legacyPageGate();if(blocked)return blocked;
  const { id } = await params;
  const workspace = getMenuConfig().workspaces.find((entry)=>entry.id===id);
  if (!workspace) notFound();
  return <><PageHeader title={workspace.label} description={workspace.description} chips={<PhaseChip phase={8} />} /><Callout title="별도 프로젝트 P8 · 준비 중이에요.">전문 업무는 콘텐츠 작업실과 분리해서 개발해요. 지금은 안내만 볼 수 있어요.</Callout><Card><h2>하지 않는 것</h2><ul className="clean-list">{workspace.notDoing.map((item)=><li key={item}>{item}</li>)}</ul></Card></>;
}
