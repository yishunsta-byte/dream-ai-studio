import Link from "next/link";
import { notFound } from "next/navigation";
import { getMenuConfig } from "@/lib/menus/server";
import { Badge, Card, Callout, EmptyState, PageHeader, PhaseChip } from "@/components/ui/primitives";
import { listProjects } from "@/lib/services/projects";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";

export default async function MenuPage({ params }: { params: Promise<{ menuId: string }> }) {
 const blocked=await legacyPageGate();if(blocked)return blocked;
  const { menuId } = await params;
  const config = getMenuConfig();
  const menu = config.menus.find((entry) => entry.id === menuId);
  if (!menu) notFound();
  const active = menu.availability === "active";
  const group = config.groups.find((entry) => entry.id === menu.group);
  const projects=listProjects().filter((project)=>project.menuId===menu.id);
  return <><PageHeader title={menu.label} description={menu.description} chips={<><Badge>{group?.label}</Badge><PhaseChip phase={Number(menu.phase.slice(1)) as 0|1|2|3|4|5|6|7|8} /><Badge>{menu.defaultAspect}{menu.defaultLengthSec > 0 ? ` · ${menu.defaultLengthSec}초` : ""}</Badge></>} actions={active ? <Link className="action-link" href={`/menus/${menu.id}/new`}>프로젝트 준비하기 →</Link> : undefined} />
    {!active && <Callout title={`준비 단계 ${menu.phase} · 지금은 둘러보기만 할 수 있어요.`}>필요한 자료와 제작 순서를 미리 살펴보세요. 이 분야의 만들기는 준비가 끝나면 열려요.</Callout>}
    <div className="grid"><Card><h2>필요한 것</h2><ul className="clean-list">{[...config.commonInputs.filter((field)=>field.required),...menu.inputs].map((field)=><li key={field.id}>{field.label}{field.required && <span aria-label="필수"> *</span>}{field.help && <p className="muted">{field.help}</p>}</li>)}</ul></Card><Card><h2>기획 순서</h2><ol className="clean-list">{menu.planSteps.map((step)=><li key={step.id}>{step.label}{step.help && <p className="muted">{step.help}</p>}</li>)}</ol></Card><Card><h2>받는 결과</h2><ul className="clean-list">{menu.outputs.map((output)=><li key={output.id}>{output.label}</li>)}</ul><h3>검수 기준</h3><p>공통 {config.commonReview.length}개 · 분야 {menu.review.length}개</p><p className="muted">선택한 내용에 따라 검수 항목이 추가돼요.</p></Card></div>
    {menu.unconfirmed.length > 0 && <Callout tone="warning" title="아직 확인 안 된 것"><ul className="clean-list">{menu.unconfirmed.map((item)=><li key={item}>{item}</li>)}</ul></Callout>}
    <Card>{projects.length ? <><h2>이 분야의 프로젝트</h2><ul className="clean-list">{projects.map((project)=><li key={project.id}><Link href={`/projects/${project.id}/${project.nextStage}`}>{project.title}</Link></li>)}</ul></>:<EmptyState title="아직 이 분야의 프로젝트가 없어요" description={active ? "자료를 준비하고 새 프로젝트를 등록해 보세요." : "이 분야가 열리면 프로젝트를 만들 수 있어요."} />}</Card>
  </>;
}
