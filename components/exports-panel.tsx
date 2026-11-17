"use client";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExportsData } from "@/lib/services/exports";
import { exportErrorCopy, safeReason } from "@/lib/ui/errors";
import { formatBytes, formatExactBytes } from "@/lib/ui/format";
import { Badge, Button, Card, Callout, EmptyState, SampleBadge, StatusPill } from "./ui/primitives";
import { useToast } from "./ui/interactive";
import { Icon } from "./ui/Icon";
import { finishingRequest } from "./editing-panel";
import styles from "./exports-panel.module.css";
import { RenderWaitNote, useRenderWait } from "./render-panel/render-wait";
type Row=ExportsData["rows"][number];type Preview=Extract<ExportsData["preview"],{ready:true}>;
const date=(value:string|null)=>value?new Date(value).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"—";
// Folder summary rows from the same entry list the bundle is written from.
function tree(preview:Preview){const groups=new Map<string,string[]>();for(const entry of preview.entries){const [head,...rest]=entry.path.split("/");const key=rest.length?`${head}/`:head;groups.set(key,[...(groups.get(key)??[]),rest.join("/")]);}
 const rows=[...groups.entries()].map(([key,names])=>({key,note:key==="scenes/"?`장면 ${names.length}개${preview.entries.some(entry=>entry.path.startsWith("scenes/")&&entry.missing)?" · 파일 없음 있음":""}`:key==="audio/"?`소리 원본 ${preview.audio.length}개${preview.audioBlocked?" · 원본 확인 필요":""}`:key.endsWith("/")?names.join(" · "):""}));
 const top=rows.filter(row=>!row.key.endsWith("/")),folders=rows.filter(row=>row.key.endsWith("/"));return [...top,{key:"manifest.json",note:"파일 목록·해시"},...folders];}
function HashLine({hash}:{hash:string}){const [open,setOpen]=useState(false);const notify=useToast();async function copy(){try{await navigator.clipboard.writeText(hash);notify({tone:"success",message:"전체 해시를 복사했어요."});}catch{setOpen(true);}}
 return <><span className={styles.mono} title={`SHA256 ${hash}`}>{hash.slice(0,8)}</span> <Button size="sm" variant="ghost" aria-label="기록된 ZIP 해시 전체 복사" onClick={()=>void copy()}>전체 복사</Button>{open&&<span className={`${styles.mono} ${styles.full}`}>SHA256 {hash}</span>}</>;}
const roleLabel={voice:"목소리",music:"배경 음악",effect:"효과음"} as const;
function audioProblem(item:Preview["audio"][number]){return item.problem?(safeReason(item.problem.message)??({file_missing:"소리 원본을 찾을 수 없어요.",not_audio:"소리 파일이 아닌 자료예요.",file_changed:"소리 원본이 저장할 때와 달라요.",range:"쓰려는 구간이 원본 길이를 벗어나요."}[item.problem.reason])):null;}
function AudioPreview({preview,projectId}:{preview:Preview;projectId:string}){const id=useId();return <section className="stack" aria-labelledby={id}>
 <h3 id={id}>소리 원본 {preview.audio.length}개</h3>
 {preview.audio.length>0?<><p>같은 원본을 여러 클립에서 써도 파일은 한 번만 넣어요. 원본 전체를 담으며, 자르기·크기·페이드·곡 연결은 편집 설정으로 남겨요.</p><ul className={styles.audioSources}>{preview.audio.map(item=><li key={item.assetId} className={styles.audioSource}><h4>{item.title}</h4><p>{item.roles.map(role=>roleLabel[role]).join(" · ")} · 클립 {item.clipCount}개 · {item.sizeBytes===null?"원본 크기 기록 없음":`기록된 원본 크기 ${formatBytes(item.sizeBytes)}`}</p><div className="cluster">{item.isMock&&<SampleBadge size="sm"/>}{item.archived&&<Badge>보관한 원본</Badge>}<Badge>{item.rightsRecorded?"권리 기록 있음":"권리 기록 없음 · 직접 확인 필요"}</Badge></div>{item.problem&&<p className={styles.missing}><Icon name="warning" className={styles.icon} aria-hidden="true"/>{audioProblem(item)}</p>}</li>)}</ul><p className="muted">권리 기록이 있어도 사용권이 확인된 것은 아니에요. 원본마다 직접 확인해 주세요.</p><p className="muted">이 목록은 원본의 무결성 검사 통과 표시가 아니에요. 같은 크기로 바뀐 파일도 작성 단계의 해시 검사에서 실패할 수 있어요.</p></>:<p>이 묶음에는 소리 원본이 들어가지 않아요. 예전 형식의 소리 기록만으로는 원본 파일을 넣지 않아요.</p>}
 {preview.audioBlocked&&<Callout tone="warning" title="소리 원본을 확인해야 묶음을 만들 수 있어요."><Link href={`/projects/${projectId}/edit`}>편집에서 해당 소리 원본과 사용 구간을 확인해 주세요.</Link></Callout>}
 </section>;}
function Failure({row,onRetry,onCreate,busy,createReason}:{row:Row;onRetry:()=>void;onCreate:()=>void;busy:boolean;createReason:string|undefined}){const id=useId(),copy=exportErrorCopy({code:row.errorCode,retryable:row.retryable,message:row.error}),detail=row.errorCode==="EXPORT_INVALID"?safeReason(row.error,copy.reason):null;
 return <section aria-labelledby={id} className={styles.failure}><h3 id={id} className={styles.failureTitle}><Icon name="warning" className={styles.icon} aria-hidden="true"/><span>{copy.title}</span></h3><p>{copy.reason}</p>{detail&&<p>{detail}</p>}<p><strong>{copy.next}</strong></p>{copy.action==="retry"&&row.jobId?<Button loading={busy} onClick={onRetry}>{copy.actionLabel}</Button>:copy.action==="recreate"?<Button loading={busy} disabledReason={createReason} onClick={onCreate}>{copy.actionLabel}</Button>:null}{copy.links.map(link=><Link key={link.key} href="/jobs">{link.label}</Link>)}<p className={styles.code}>{copy.codeLine}</p></section>;}
export function ExportsPanel({data}:{data:ExportsData}){const [pending,setPending]=useState(""),[error,setError]=useState("");const router=useRouter(),notify=useToast();const working=data.rows.some(row=>["running","queued"].includes(row.jobStatus??""));useEffect(()=>{if(!working)return;const timer=setInterval(()=>router.refresh(),2000);return()=>clearInterval(timer);},[working,router]);
 const waitFor=useRenderWait(data.rows.filter(row=>row.jobStatus==="queued"&&row.jobId).map(row=>row.jobId!));
 const preview=data.preview.ready?data.preview:null,brokenAudio=preview?.audio.find(item=>item.problem);
 const createReason=!data.canCreate?"현재 내용의 검수 승인이 필요해요.":!preview?(data.preview.ready?"미리보기를 확인해 주세요.":data.preview.reason):preview.audioBlocked?(brokenAudio?audioProblem(brokenAudio)??"소리 원본을 확인해 주세요.":"소리 원본을 확인해 주세요."):preview.timelineError??(preview.timelineStale?"편집에서 지금 선택한 장면으로 다시 저장해 주세요.":!preview.editSaved?"편집에서 설정을 먼저 저장해 주세요.":preview.missing[0]?.reason);
 async function create(){if(createReason||pending)return;setPending("create");setError("");try{await finishingRequest(data.projectId,data.revision,"export");router.refresh();}catch(error){setError(safeReason((error as Error).message)??"묶음을 요청하지 못했어요. 원본과 저장 상태를 확인해 주세요.");}finally{setPending("");}}
 async function jobAction(jobId:string,action:"retry"|"cancel"){setPending(jobId);setError("");try{const response=await fetch("/api/jobs",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:jobId,action})});const result=await response.json();if(!response.ok)throw new Error(result.error);notify({tone:"success",message:action==="retry"?"묶음 만들기를 다시 시도해요.":"묶음 만들기 취소를 요청했어요."});router.refresh();}catch(error){setError((error as Error).message);}finally{setPending("");}}
 return <div className={`stack ${styles.panel}`}><Callout title="원본과 편집 설정을 담은 ZIP이에요."><p>합친 소리(믹스)·완성 영상(MP4)·실행 앱은 들어 있지 않아요. 이 앱에는 ZIP을 프로젝트로 다시 불러오는 기능이 없어요.</p><p>다른 편집 도구에서 원본과 편집 설정을 보고 손으로 맞춰야 해요. 소리 크기·페이드·음량 맞춤이 같은 결과를 보장하지 않아요. 앱 상태를 되돌리는 것은 <Link href="/settings">백업·복원</Link>이에요.</p><p>저장하지 않은 편집 변경은 포함하지 않아요. 현재 승인 기획과 검수·선택 결과를 다시 확인하고, ZIP 작성 뒤 파일·크기·해시를 재검증해요. 기존 묶음은 이후 수정해도 그대로 남아요. 최종 영상 내보내기와 게시 게이트는 열리지 않아요.</p></Callout>
 <Card><div className="stack"><div className="cluster"><h2>묶음에 들어갈 것</h2>{preview?.isMock&&<Badge>샘플 포함</Badge>}</div>{preview?<>
  <p>예상 약 {formatBytes(preview.estimatedBytes)} · 파일 {preview.fileCount}개 · 묶음 형식 v{preview.manifestVersion}</p>
  <p>이 ZIP이 백업에 더해져 예상 약 {formatBytes(preview.backupGrowthBytes)}만큼 백업도 커져요. 실제 ZIP 크기는 만든 뒤 표시해요. 큰 원본의 예상치 정확도와 작성 시간은 확인하지 않았어요.</p>
  <ul className={styles.tree} aria-label="묶음 폴더 구성"><li className={styles.root}>{preview.fileNameExample}</li>{tree(preview).map(row=><li key={row.key}><span>{row.key}</span>{row.note&&<span className={styles.note}>{row.note}</span>}</li>)}</ul>
  <AudioPreview preview={preview} projectId={data.projectId}/>
  {preview.missing.map(item=><p key={item.sceneNumber} className={styles.missing}><Icon name="warning" className={styles.icon} aria-hidden="true"/>{item.reason}</p>)}
  {preview.timelineError&&<p className={styles.missing} role="alert"><Icon name="warning" className={styles.icon} aria-hidden="true"/>{preview.timelineError}</p>}
  {preview.timelineStale&&<p className={styles.missing}><Icon name="warning" className={styles.icon} aria-hidden="true"/>편집 타임라인과 지금 선택한 장면 결과가 달라요. <Link href={`/projects/${data.projectId}/edit`}>편집에서 지금 선택으로 저장해 주세요.</Link></p>}
  {!preview.editSaved&&!preview.timelineError&&<p className="muted">편집에서 설정을 먼저 저장해 주세요. 저장한 설정을 묶음에 담아요.</p>}
  <details className={styles.details}><summary>파일 이름 모두 보기</summary><div className={styles.scroll}><table className={styles.files}><caption className="sr-only">ZIP 안 파일별 예정 구성</caption><thead><tr><th scope="col">ZIP 안 파일 이름</th><th scope="col">기록된 크기·상태</th></tr></thead><tbody>{preview.entries.map(entry=><tr key={entry.path}><td className={styles.mono}>{entry.path}</td><td>{entry.missing?(entry.path.startsWith("audio/")?"원본 확인 필요":"파일 없음"):formatBytes(entry.sizeBytes)}{entry.sample?" · 샘플":""}</td></tr>)}</tbody></table></div></details>
  <p className="muted">원본 소리·PNG·글꼴과 설정 자료를 담는 예상 용량이에요. 파일 목록에 있다고 무결성 검사를 통과했다는 뜻은 아니에요.</p>
 </>:<p>{data.preview.ready?null:data.preview.reason}</p>}</div></Card>
 {error&&<p role="alert" className={styles.missing}>{error}</p>}<Button loading={pending==="create"} loadingLabel="묶음 요청 중" disabledReason={createReason} onClick={()=>void create()}>현재 내용 r{data.revision} · 편집용 묶음 만들기</Button><Link href="/jobs">작업 대기열·처리기 상태 보기 →</Link>
 {!data.rows.length&&<EmptyState icon="folder" title="아직 만든 묶음이 없어요" description="검수를 승인한 뒤 편집용 묶음을 만들어 주세요."/>}
 {data.rows.map(row=>{const failed=row.status==="failed"&&row.jobStatus!=="canceled",running=["running","queued"].includes(row.jobStatus??"")&&row.status==="running";return <Card key={row.id} tone={failed?"danger":"default"}><div className="stack"><h2>내용 r{row.revision} · 편집용 묶음</h2><div className="cluster"><StatusPill status={row.status==="succeeded"?"done":row.jobStatus==="canceled"?"canceled":row.jobStatus==="queued"?"queued":row.status==="failed"?"failed":"running"}/>{row.isMock&&<SampleBadge/>}{row.revision!==data.revision&&<Badge>지금 내용과 다름</Badge>}</div>
  {running&&row.jobId&&<div className="cluster"><span>{row.jobStatus==="queued"?"대기 중":"만드는 중"} · {date(row.createdAt)}</span><Button size="sm" variant="ghost" loading={pending===row.jobId} onClick={()=>void jobAction(row.jobId!,"cancel")}>취소</Button></div>}
  {row.jobId&&(()=>{const wait=waitFor(row.jobId);return wait&&<RenderWaitNote wait={wait} currentProjectId={data.projectId}/>;})()}
  {failed&&<Failure row={row} busy={pending===row.jobId||pending==="create"} createReason={createReason} onRetry={()=>void jobAction(row.jobId!,"retry")} onCreate={()=>void create()}/>}
  {row.status==="failed"&&row.jobStatus==="canceled"&&<p>만들기를 취소했어요. 반쯤 만든 파일은 남기지 않았어요.</p>}
  {row.status==="succeeded"&&<dl className={styles.kv}>{row.fileName&&<><dt>파일 이름</dt><dd className={styles.mono}>{row.fileName}</dd></>}<dt>크기</dt><dd>{row.sizeBytes!==null?`${formatBytes(row.sizeBytes)} (${formatExactBytes(row.sizeBytes)})`:"파일 없음"}</dd><dt>만든 시각 · 파일</dt><dd>{date(row.completedAt??row.createdAt)} · 파일 {row.fileCount}개</dd>{row.sha256&&<><dt>만들 때 기록한 ZIP 해시</dt><dd><HashLine hash={row.sha256}/></dd></>}</dl>}
  {row.status==="succeeded"&&<p className="muted">이 묶음은 만들 당시 내용으로 남아요. 아래 파일 존재 여부는 현재 무결성 재검사 결과가 아니에요.</p>}
  {row.status==="succeeded"&&!row.available&&<Callout title="내보낸 파일이 없어요." tone="warning">저장 위치를 확인해 주세요. 완료 기록만으로 내려받을 수는 없어요.</Callout>}
  {row.available&&row.sizeBytes!==null&&<a className="action-link" href={`/api/exports/${row.id}`}>내려받기 · {formatBytes(row.sizeBytes)}{row.isMock?" · 샘플 포함":""}</a>}</div></Card>;})}</div>;
}
