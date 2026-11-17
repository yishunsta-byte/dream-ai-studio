"use client";
// P2-4 영상 만들기 화면 (T-102 3~9장). Server values only: what the API does not send is not shown.
// Polls every 2 seconds while a render is queued or running (T-102 5장).
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { RenderBlocker } from "@/lib/render/input";
import type { RenderView } from "@/lib/services/renders";
import { Badge, Button, Card, EmptyState, SampleBadge, StatusPill } from "../ui/primitives";
import { ConfirmPanel, useToast } from "../ui/interactive";
import { stagesFor, announceStage, attemptLine, audioResultCopy, aspectLabel, blockerLines, canceledCopy, duration, failureCopy, linkHref, linkLabel, mb, progressCopy } from "./copy";
import styles from "./render-panel.module.css";

export type RendersData={workerOnline:boolean;contentRevision:number;timelineId:string|null;check:{ready:boolean;blockers:RenderBlocker[]}|null;renders:RenderView[]};
export type SavedRenderTimeline={revision:number;aspect:string;audioMode:"none"|"aac"|"unsupported";audioClips:number};
type Saved=SavedRenderTimeline|null;
const isActive=(render:RenderView)=>render.status==="queued"||render.status==="running";
const when=(iso:string)=>new Date(iso).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});
const codecName=(codec:string|null)=>codec==="h264"?"H.264":codec??"코덱 확인 전";

export function RenderPanel({projectId,data,saved}:{projectId:string;data:RendersData;saved:Saved}){
  const router=useRouter(),notify=useToast(),[refreshing,startRefresh]=useTransition();
  const [busy,setBusy]=useState<""|"request"|"cancel">(""),[error,setError]=useState(""),[confirm,setConfirm]=useState(false),[playing,setPlaying]=useState<string|null>(null),[live,setLive]=useState("");
  const active=data.renders.find(isActive)??null,results=data.renders.filter(render=>!isActive(render));
  const title=useRef<HTMLHeadingElement>(null),focusCard=useRef(false),focusInCard=useRef(false);
  const refresh=()=>startRefresh(()=>router.refresh());

  useEffect(()=>{if(!active)return;const timer=setInterval(()=>startRefresh(()=>router.refresh()),2000);return()=>clearInterval(timer);},[active,router]);
  // Stage changes are read once (live region); the end is one Toast and the live text is cleared (T-102 5.1).
  const seen=useRef<Map<string,{status:string;stage:string|null}>|null>(null);
  useEffect(()=>{
    const before=seen.current,next=new Map<string,{status:string;stage:string|null}>();
    for(const render of data.renders){
      next.set(render.id,{status:render.status,stage:render.stage});const old=before?.get(render.id);if(!old)continue;
      if(isActive(render)&&render.status==="running"&&render.stage&&(old.stage!==render.stage||old.status!=="running"))setLive(announceStage(render));
      if((old.status==="queued"||old.status==="running")&&!isActive(render)){
        setLive("");
        if(render.status==="succeeded")notify({tone:"success",message:render.canceledLate?"취소한 뒤에 영상이 끝났어요. 보관만 해요.":"영상을 만들었어요. 파일 확인을 통과했어요."});
        else if(render.status==="failed")notify({tone:"error",message:"영상을 만들지 못했어요. 이유를 만든 영상 목록에 적어 뒀어요."});
        else if(render.status==="canceled")notify({tone:"success",message:"영상 만들기를 취소했어요."});
        // Focus moves only when it was inside the progress card (T-102 5.2).
        if(focusInCard.current){focusInCard.current=false;requestAnimationFrame(()=>document.getElementById(`render-${render.id}`)?.focus());}
      }
    }
    seen.current=next;
  },[data.renders,notify]);
  useEffect(()=>{if(focusCard.current&&active){focusCard.current=false;title.current?.focus();}},[active]);

  const lines=blockerLines(data.check?.blockers??[]),activeBlock=data.check?.blockers.some(blocker=>blocker.code==="RENDER_ACTIVE")||!!active;
  const blockedReason=active?(active.timelineRevision===saved?.revision&&!active.stale?"이 내용으로 만들고 있어요. 아래 진행 상황을 봐 주세요.":`타임라인 r${active.timelineRevision} 영상을 만드는 중이에요. 끝나거나 취소한 뒤 만들 수 있어요.`)
    :activeBlock?"이 프로젝트의 다른 영상을 만들고 있어요. 끝나거나 취소한 뒤 만들 수 있어요."
    :!data.check?"시작 전 확인을 하지 못했어요. 새로고침해 주세요."
    :lines.length?"위 이유를 고치면 만들 수 있어요."
    :!data.check.ready?"이전 단계를 먼저 완료해 주세요.":undefined;

  async function request(){
    if(!data.timelineId||busy)return;setBusy("request");setError("");
    try{
      const response=await fetch(`/api/projects/${projectId}/renders`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({revision:data.contentRevision,timelineId:data.timelineId})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setError(body.blockers?.length?"시작 전 확인에서 막혔어요. 위의 이유를 확인해 주세요.":body.error??"영상 만들기를 요청하지 못했어요.");refresh();return;}
      notify({tone:"success",message:body.result?.existing?"이미 만들고 있어요. 그 작업을 보여 드려요.":"영상 만들기를 요청했어요."});
      focusCard.current=true;if(active)title.current?.focus();refresh();
    }catch{setError("영상 만들기를 요청하지 못했어요. 잠시 뒤 다시 시도해 주세요.");}finally{setBusy("");}
  }
  async function cancel(){
    if(!active)return;setBusy("cancel");setError("");
    try{const response=await fetch(`/api/renders/${active.id}/cancel`,{method:"POST"});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error);notify({tone:"success",message:"취소를 요청했어요. 지금 단계가 끝나는 대로 멈춰요."});setConfirm(false);refresh();}
    catch(problem){setError(problem instanceof Error&&problem.message?problem.message:"취소하지 못했어요.");setConfirm(false);}finally{setBusy("");}
  }
  const makeButton=(label:string,variant:"primary"|"secondary"="primary")=><Button variant={variant} loading={busy==="request"||refreshing} loadingLabel="요청 중" disabledReason={blockedReason} onClick={()=>void request()}>{label}</Button>;

  return <div className="stack">
    <Card><section className="stack" aria-labelledby="render-make">
      <h2 id="render-make">새 영상 만들기</h2>
      <p>{saved?<>저장한 타임라인 r{saved.revision} · {saved.aspect}으로 만들어요. 편집에서 저장하지 않은 변경은 들어가지 않아요.</>:"저장한 타임라인으로만 만들어요."}</p>
      {saved&&<p>{saved.audioMode==="aac"?`저장한 소리 ${saved.audioClips}개를 함께 합쳐요. 이 기기의 재생 음소거는 결과에 영향을 주지 않아요.`:saved.audioMode==="unsupported"?"예전 형식의 소리 설정이에요. 위의 시작 전 확인을 보고 편집에서 다시 저장해 주세요.":"저장한 타임라인으로 소리 없는 영상을 만들어요."}</p>}
      {lines.length>0&&<div className={styles.blockers}><h3>만들기 전에 고칠 것 {lines.length}개</h3><ul>{lines.map(line=><li key={line.key}><span>{line.text}</span>{line.link&&<> <Link href={linkHref(line.link,projectId)}>{linkLabel[line.link]}</Link></>}{line.code&&<span className={styles.code}> {line.code}</span>}</li>)}</ul></div>}
      {!data.workerOnline&&!active&&<p className="muted">작업 처리기가 꺼져 있어요. 지금 요청해 두면 처리기가 켜질 때 시작해요.</p>}
      <div className={styles.actions}>{makeButton("영상 만들기")}</div>
      {error&&<p role="alert" className={styles.error}>{error}</p>}
    </section></Card>

    {active&&<Card><section className="stack" aria-labelledby="render-progress" onFocus={()=>{focusInCard.current=true;}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))focusInCard.current=false;}}>
      <ProgressBody render={active} title={title} onCancel={()=>setConfirm(true)}/>
      <p className="sr-only" aria-live="polite">{live}</p>
    </section></Card>}

    <Card><section className="stack" aria-labelledby="render-results">
      <h2 id="render-results">만든 영상</h2>
      {results.length===0?<EmptyState title="아직 만든 영상이 없어요" description="영상 만들기를 누르면 여기에 결과가 남아요. 예전 결과는 지우거나 덮어쓰지 않아요."/>:
        <ul className={styles.rows}>{results.map(render=><ResultRow key={render.id} render={render} playing={playing===render.id} onPlay={()=>setPlaying(playing===render.id?null:render.id)} remake={makeButton}/>)}</ul>}
    </section></Card>

    <Card><section className="stack" aria-labelledby="render-export">
      <h2 id="render-export">완성 영상 내보내기</h2>
      <p><StatusPill status="locked"/> 소리 편집과 자막 파일(P2-6) 등 남은 단계의 확인이 끝나면 열려요. 편집용 묶음 내보내기는 지금처럼 쓸 수 있어요.</p>
    </section></Card>

    <ConfirmPanel open={confirm} title="영상 만들기를 취소할까요?" description="만들던 부분은 버려요. 이미 만든 영상은 그대로예요." confirmLabel="취소하기" closeLabel="계속 만들기" tone="danger" confirming={busy==="cancel"} onDismiss={()=>setConfirm(false)} onConfirm={()=>void cancel()}/>
  </div>;
}

function ProgressBody({render,title,onCancel}:{render:RenderView;title:RefObject<HTMLHeadingElement|null>;onCancel:()=>void}){
  const copy=progressCopy(render),aspect=aspectLabel(render.width,render.height),running=render.status==="running";
  const stages=stagesFor(render),current=stages.findIndex(stage=>stage.key===render.stage),barId=useId();
  const percent=render.audioMode==="none"&&render.stage==="compose"&&render.progress!==null?Math.floor(render.progress*100):null;
  return <>
    <div className={styles.head}><h2 id="render-progress" ref={title} tabIndex={-1}>영상 만드는 중 · 타임라인 r{render.timelineRevision} · {aspect}</h2>{render.stale&&<StatusPill status="warning">지금 내용과 다름 · 타임라인 r{render.timelineRevision}</StatusPill>}{render.isSample&&<SampleBadge size="sm"/>}</div>
    <p className={styles.pillLine}><StatusPill status={running&&!render.cancelRequested?"running":"queued"}>{copy.pill}</StatusPill></p>
    <p>{copy.body}</p>
    {running&&<ol className={styles.stages} aria-label="진행 단계">{stages.map((stage,index)=>{const state=index<current?"done":index===current?"now":"todo";return <li key={stage.key} className={styles[state]} aria-current={state==="now"?"step":undefined}><span aria-hidden="true">{state==="done"?"✓":state==="now"?"●":"○"}</span> <span className="sr-only">{state==="done"?"끝남":state==="now"?"지금":"남음"}: </span>{index+1}. {stage.label}</li>;})}</ol>}
    {percent!==null&&<div className={styles.bar}><span id={barId}>장면과 글자 합치기</span><progress aria-labelledby={barId} max={100} value={percent} aria-valuetext={`${percent}%${render.elapsedSec!==null?` · ${duration(render.elapsedSec)} 지남`:""}`}/></div>}
    {render.stage==="verify"&&running&&<p className={styles.checking}>확인 중</p>}
    <p className="muted">{render.elapsedSec!==null&&<>지난 시간 <time dateTime={`PT${render.elapsedSec}S`}>{duration(render.elapsedSec)}</time> · </>}{render.audioMode==="none"&&render.etaSec!==null&&<>이 PC의 이전 기록으로 남은 시간 약 {duration(render.etaSec)} · </>}{attemptLine(render)}</p>
    <p className="muted">PC에서 만들어요. 창을 닫아도 작업 처리기가 켜져 있으면 계속돼요.</p>
    {!render.cancelRequested&&<div className={styles.actions}><Button variant="secondary" onClick={onCancel}>취소</Button></div>}
  </>;
}

function ResultRow({render,playing,onPlay,remake}:{render:RenderView;playing:boolean;onPlay:()=>void;remake:(label:string,variant?:"primary"|"secondary")=>ReactNode}){
  const aspect=aspectLabel(render.width,render.height),videoId=useId(),ok=render.status==="succeeded";
  const usable=ok&&!render.canceledLate&&render.fileExists,failure=render.status==="failed"?failureCopy(render):null;
  const audio=audioResultCopy(render);
  return <li className={styles.row}>
    <div className={`${styles.thumb} ${styles[`a${aspect.replace(":","x")}`]}`} aria-hidden="true">{aspect}</div>
    <div className={styles.body}>
      <h3 id={`render-${render.id}`} tabIndex={-1} className={styles.name}>{render.fileName}</h3>
      <div className={styles.chips}>
        {ok&&render.verify?.result==="passed"&&<StatusPill status="done">파일 확인 통과</StatusPill>}
        {ok&&!render.fileExists&&<StatusPill status="failed">파일 없음</StatusPill>}
        {render.status==="failed"&&<StatusPill status="failed"/>}
        {render.status==="canceled"&&<StatusPill status="canceled"/>}
        {render.canceledLate&&<StatusPill status="canceled">취소 뒤 끝남</StatusPill>}
        {render.stale&&<StatusPill status="warning">지금 내용과 다름 · 타임라인 r{render.timelineRevision}</StatusPill>}
        {ok&&<Badge>{audio.badge}</Badge>}{render.isSample&&<SampleBadge size="sm"/>}{render.textOnlyChange&&<Badge>글자만 바뀜</Badge>}
      </div>
      {ok&&<p>{render.width}×{render.height} · {render.durationSec.toFixed(1)}초 · {codecName(render.codec)} · {render.fps}fps · {audio.track}</p>}
      {ok&&<p>{audio.summary}{audio.measurement&&<> · {audio.measurement}</>}</p>}
      {ok&&render.audio&&<details className={styles.audioDetails}><summary>소리 확인 세부 정보</summary><p>기준: 음량 {render.audio.target.integrated} LUFS ±{render.audio.target.tolerance} LU · 최대 피크 {render.audio.target.truePeakMax} dBTP</p><p className={styles.code}>처리 프로필 {render.audio.profile} · 도구 {render.audio.ffmpeg}</p></details>}
      {ok&&<p className="muted">확인 안 한 것: 자막 표시 오차 {render.subtitleMeasure===null?"측정 전":"측정함"} · 휴대폰 재생 {render.phonePlayback===null?"확인 전":"확인함"}</p>}
      {ok&&render.stale&&!render.canceledLate&&<p>보관만 해요. 지금 내용으로 다시 만들어야 검수·내보내기에 쓸 수 있어요.</p>}
      {render.canceledLate&&<p>취소한 뒤에 끝난 영상이에요. 보관만 하고 자동으로 쓰지 않아요. 재생·내려받기는 하지 않고 백업에는 함께 들어가요.</p>}
      {ok&&!render.fileExists&&<p className={styles.error}>영상 파일을 찾지 못했어요. 백업에 함께 들어가는 파일이라 원래 있어야 해요. 파일을 옮겼거나 지웠는지 확인해 주세요. 다시 만들 수도 있어요.</p>}
      {ok&&render.cleanupLeft.length>0&&<p className={styles.cleanup}>영상은 만들었지만 임시 파일 정리를 확인해 주세요.</p>}
      {failure&&<p>{failure.text}</p>}
      {render.status==="canceled"&&<p>{canceledCopy(render)}</p>}
      <p className={styles.meta}><time dateTime={render.finishedAt??render.createdAt}>{when(render.finishedAt??render.createdAt)}</time>{render.elapsedSec!==null&&` · ${duration(render.elapsedSec)} 걸림`}{render.status==="failed"&&render.errorCode&&<span className={styles.code}> · {render.errorCode}{render.error?` · ${render.error.attempts}/${render.error.maxAttempts}번 시도`:""}</span>}</p>
      <div className={styles.actions}>
        {usable&&<><Button variant="secondary" aria-expanded={playing} aria-controls={videoId} onClick={onPlay}>{playing?"영상 닫기":"영상 보기"}</Button><a className={styles.download} href={`/api/renders/${render.id}/file?download`} download={render.fileName}>내려받기{render.sizeBytes!==null&&` · ${mb(render.sizeBytes)}`}</a></>}
        {usable&&render.stale&&remake("지금 내용으로 만들기","secondary")}
        {(render.status==="failed"||render.status==="canceled"||(ok&&!render.fileExists))&&remake("다시 만들기","secondary")}
      </div>
      {usable&&<div id={videoId} hidden={!playing}>{playing&&<ResultPlayback render={render} aspect={aspect}/>}</div>}
    </div>
  </li>;
}

function ResultPlayback({render,aspect}:{render:RenderView;aspect:string}){
  const video=useRef<HTMLVideoElement>(null),[muted,setMuted]=useState(true),[error,setError]=useState(false),hintId=useId();
  const hasAudio=render.audioMode==="aac"&&render.audioStreams===1&&render.verify?.result==="passed";
  return <div className="stack">
    <p id={hintId} className="muted">{hasAudio?`이 기기에서 소리 ${muted?"꺼짐":"켜짐"}. 재생 버튼을 누르면 시작돼요. 재생 음소거와 기기 음량은 내려받는 파일에 영향을 주지 않아요.`:"재생 버튼을 누르면 영상이 시작돼요."}</p>
    <video ref={video} className={`${styles.video} ${styles[`v${aspect.replace(":","x")}`]}`} controls muted={muted} playsInline preload="metadata" src={`/api/renders/${render.id}/file`} aria-label={`${render.fileName} 재생`} aria-describedby={hintId} onVolumeChange={()=>setMuted(video.current?.muted??true)} onError={()=>setError(true)}/>
    {hasAudio&&<div className={styles.actions}><Button variant="secondary" aria-pressed={!muted} onClick={()=>{if(video.current){video.current.muted=!video.current.muted;setMuted(video.current.muted);}}}>{muted?"이 기기에서 소리 켜기":"이 기기에서 소리 끄기"}</Button></div>}
    {error&&<p role="alert" className={styles.error}>이 기기에서 영상을 열지 못했어요. 내려받은 파일로 재생을 확인해 주세요.</p>}
  </div>;
}
