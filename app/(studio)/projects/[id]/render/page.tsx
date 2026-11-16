import Link from "next/link";
import { notFound } from "next/navigation";
import { readProject } from "@/lib/services/projects";
import { WorkflowError } from "@/lib/domain/stages";
import { readEditing } from "@/lib/services/editing";
import { readRenders } from "@/lib/services/renders";
import { Badge, Callout, PageHeader } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/interactive";
import { BreadcrumbLabel } from "@/components/breadcrumb";
import { RenderPanel } from "@/components/render-panel/render-panel";
import styles from "@/components/render-panel/render-panel.module.css";

// 영상 만들기: a sub-screen of 수정·조립 (T-102 D-1, no new stage).
export default async function ProjectRenderPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  let data;try{data=readProject(id);}catch(error){if(error instanceof WorkflowError&&error.status===404)notFound();throw error;}
  const {project,snapshot,states}=data,edit=states.find(item=>item.stage==="edit"),locked=!edit||edit.status==="locked";
  const editName=snapshot.stages.find(item=>item.id==="edit")?.label??"수정·조립";
  const editing=locked?null:readEditing(id),saved=editing?.current?{revision:editing.current.revision,aspect:editing.aspect}:null;
  const renders=locked?null:await readRenders(id);
  return <><BreadcrumbLabel title={project.title} parent={snapshot.menu.label}/>
    <PageHeader title="영상 만들기" description={`${project.title} · ${editName} › 영상 만들기`} chips={<>{saved?<Badge>저장됨 · 타임라인 r{saved.revision} · {saved.aspect}</Badge>:<Badge>저장한 타임라인 없음</Badge>}<Badge>내용 버전 r{project.contentRevision}</Badge></>}/>
    <Tabs activeKey="edit" items={snapshot.stages.map(item=>({key:item.id,label:item.label,href:`/projects/${id}/${item.id}`,locked:states.find(entry=>entry.stage===item.id)?.status==="locked",lockedReason:"이전 단계를 완료하면 열려요."}))}/>
    {locked||!renders?<Callout title="이전 단계를 먼저 완료해 주세요.">장면 확인을 마치면 수정·조립에서 영상을 만들 수 있어요.</Callout>:<RenderPanel projectId={id} data={renders} saved={saved}/>}
    <Link className={styles.back} href={`/projects/${id}/edit`}>← {editName}으로 돌아가기</Link>
  </>;
}
