import Link from "next/link";
import { notFound } from "next/navigation";
import { readProject } from "@/lib/services/projects";
import { stageOrder, WorkflowError, type Stage } from "@/lib/domain/stages";
import { Badge, Card, Callout, PageHeader, Stepper } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/interactive";
import { BreadcrumbLabel } from "@/components/breadcrumb";
import { readPlanning } from "@/lib/services/planning";
import { BriefPanel, PlanEditor } from "@/components/planning-panel";
import { ProductionPanel } from "@/components/production-panel";
import { readProduction } from "@/lib/services/production";

export default async function ProjectStagePage({params}:{params:Promise<{id:string;stage:string}>}) {
 const {id,stage}=await params;if(!stageOrder.includes(stage as Stage))notFound();
 let data;try{data=readProject(id);}catch(error){if(error instanceof WorkflowError&&error.status===404)notFound();throw error;}
 const {project,snapshot,states,inputs}=data;
 const current=states.find((item)=>item.stage===stage)!;
 const stageName=snapshot.stages.find((item)=>item.id===stage)!.label;
 const planning=(stage==="brief"||stage==="plan")&&current.status!=="locked"?readPlanning(id):null;
 return <><BreadcrumbLabel title={project.title} parent={snapshot.menu.label} /><PageHeader title={project.title} description={`${snapshot.menu.label} · ${stageName}`} chips={<><Badge>{project.aspect} · {project.lengthSec}초</Badge><Badge>내용 버전 r{project.contentRevision}</Badge></>} />
  <Stepper steps={snapshot.stages.map((item)=>{const state=states.find((entry)=>entry.stage===item.id)!;return {key:item.id,label:item.label,gate:item.gate,state:state.status==="approved"?"done":state.status==="locked"?"locked":item.id===stage?"current":"waiting",note:state.status==="locked"?"이전 단계 완료 후":state.status==="approved"?"완료했어요":state.note??"내용을 살펴봐 주세요"};})} />
  <Tabs activeKey={stage} items={snapshot.stages.map((item)=>({key:item.id,label:item.label,href:`/projects/${id}/${item.id}`,locked:states.find((entry)=>entry.stage===item.id)?.status==="locked",lockedReason:"이전 단계를 완료하면 열려요."}))} />
  {current.status==="locked" ? <Callout title="이전 단계를 먼저 완료해 주세요.">지금은 이 단계의 작업을 시작할 수 없어요.</Callout>:stage==="produce"?<ProductionPanel data={readProduction(id)}/>:planning?stage==="brief"?<BriefPanel data={planning}/>:<PlanEditor key={project.contentRevision+":"+project.approvedPlanId} data={planning}/>:<><Callout title={`${stageName} 내용을 살펴보세요.`}>단계별 제작 기능을 이어서 연결하고 있어요.</Callout><Card><h2>등록한 내용</h2><dl className="project-inputs">{[...snapshot.commonInputs,...snapshot.menu.inputs].filter((field)=>inputs[field.id]!==undefined).map((field)=><div key={field.id}><dt>{field.label}</dt><dd>{Array.isArray(inputs[field.id]) ? `${(inputs[field.id] as unknown[]).length}개 연결됨` : typeof inputs[field.id]==="boolean"?inputs[field.id]?"예":"아니요":String(inputs[field.id])}</dd></div>)}</dl></Card></>}
  <Link href={`/menus/${project.menuId}`}>분야 소개로 돌아가기 →</Link>
 </>;
}
