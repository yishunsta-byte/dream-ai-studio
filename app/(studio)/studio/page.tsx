import Link from "next/link";
import { getMenuConfig } from "@/lib/menus/server";
import { Badge, Callout, Card, EmptyState, PageHeader, PhaseChip, StatusPill } from "@/components/ui/primitives";
import { listProjects } from "@/lib/services/projects";
import { readRecentOperations } from "@/lib/services/history";
import { checkStartup } from "@/lib/services/startup";
import { stageOrder } from "@/lib/domain/stages";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";

export default async function Home() {
 const blocked=await legacyPageGate();if(blocked)return blocked;
  const config = getMenuConfig();
  if(!checkStartup().canStart)return <><PageHeader title="작업실"/><Callout title="작업 전에 시작 점검이 필요해요." tone="warning"><Link href="/setup">시작 점검 확인</Link></Callout></>;
  const projects=listProjects();
  let recent:ReturnType<typeof readRecentOperations>|null=null;try{recent=readRecentOperations();}catch{/* 최근 상태를 읽지 못해도 작업실을 유지한다. */}
  const columns=[{key:"ready",label:"이번 주 우선"},{key:"producing",label:"제작 중"},{key:"review",label:"검수 필요"},{key:"failed",label:"실패"}] as const;
  const category=(project:typeof projects[number])=>project.status==="warning"?"failed":project.nextStage==="review"?"review":["produce","edit"].includes(project.nextStage)?"producing":"ready";
  const attention=[{label:"확인 필요",status:"failed",count:projects.filter((project)=>category(project)==="failed").length},{label:"승인 대기",status:"approval",count:projects.filter((project)=>project.status==="approval").length},{label:"검수 대기",status:"queued",count:projects.filter((project)=>category(project)==="review").length},{label:"만드는 중",status:"running",count:projects.filter((project)=>project.status==="running").length}] as const;
  return (
    <><PageHeader title="작업실" description="아이디어를 작품으로, 한 단계씩 완성해요." chips={<Badge tone="accent">나만의 AI 콘텐츠 작업실</Badge>} actions={<Link className="action-link" href="/projects/new">새 프로젝트</Link>} />
      <Card><h2>최근 백업·내보내기</h2>{recent?<><p>이 환경의 백업 성공: {recent.backups.lastSuccess?.verifiedAt?new Date(recent.backups.lastSuccess.verifiedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"아직 없어요"}{recent.backups.lastSuccess?.available===false&&" · 이 PC에 파일 없음"}<br/>최근 실패: {recent.backups.lastFailure?new Date(recent.backups.lastFailure.finishedAt??recent.backups.lastFailure.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"아직 없어요"}</p><ul>{recent.exports.map(row=><li key={row.id}><Link href={`/api/exports/${row.id}`}>{row.title} · 편집용 묶음</Link></li>)}</ul></>:<p>최근 상태를 읽지 못했어요. 설정에서 다시 확인해 주세요.</p>}<div className="cluster"><Link href="/settings">백업·복원 설정</Link><Link href="/history">생성·활동 기록</Link></div></Card>
      {attention.some((item)=>item.count>0)&&<div className="cluster" aria-label="먼저 살펴볼 작업">{attention.filter((item)=>item.count>0).map((item)=><Link href="#projects" key={item.label}><Card><StatusPill status={item.status}>{item.label} · {item.count}</StatusPill></Card></Link>)}</div>}
      {!projects.length ? <Card><EmptyState title="첫 작품을 준비해 볼까요?" description="아직 등록한 프로젝트가 없어요. 만들고 싶은 분야를 먼저 둘러보세요." action={<Link href="/menus/shopping-shorts">쇼핑숏츠 둘러보기 →</Link>} /></Card>:<section id="projects" className="project-columns" aria-label="프로젝트 진행 현황">{columns.map((column)=><div key={column.key} className="stack"><h2>{column.label} <Badge>{projects.filter((project)=>category(project)===column.key).length}</Badge></h2>{projects.filter((project)=>category(project)===column.key).map((project)=><Card key={project.id} className="project-card"><div className="cluster"><Badge>{project.menuLabel}</Badge><Badge>{project.aspect} · {project.lengthSec}초</Badge></div><h3><Link href={`/projects/${project.id}/${project.nextStage}`}>{project.title}</Link></h3><div className="mini-progress" aria-label={`${project.states.filter((state)=>state.status==="approved").length}/7단계 완료`}>{stageOrder.map((stage)=><span key={stage} data-done={project.states.find((state)=>state.stage===stage)?.status==="approved"} />)}</div><div className="cluster"><StatusPill status={project.status} /><time dateTime={project.updatedAt}>{new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(project.updatedAt))}</time></div></Card>)}{!projects.some((project)=>category(project)===column.key)&&<p className="muted">이 단계의 프로젝트가 없어요.</p>}</div>)}</section>}
      <section className="stack" aria-labelledby="fields-heading"><div><h2 id="fields-heading">어떤 작품을 만들까요?</h2><p className="muted">지금 시작할 수 있는 분야부터, 앞으로 열릴 작업까지 살펴보세요.</p></div><div className="grid">{config.groups.slice().sort((a,b)=>a.order-b.order).flatMap((group)=>config.menus.filter((menu)=>menu.group===group.id).map((menu)=><Card key={menu.id}><div className="stack"><div className="cluster"><Badge>{group.label}</Badge><PhaseChip phase={Number(menu.phase.slice(1)) as 0|1|2|3|4|5|6|7|8} /></div><h3>{menu.label}</h3><p className="muted">{menu.description}</p><Link href={`/menus/${menu.id}`}>{menu.availability === "active" ? "분야 살펴보기" : "준비 중인 분야 둘러보기"} →</Link></div></Card>))}</div></section>
    </>
  );
}
