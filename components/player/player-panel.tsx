"use client";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MutableRefObject, type RefObject } from "react";
import { Player, type ErrorFallback, type PlayerRef } from "@remotion/player";
import { clampFrame, formatFrameTime, PREVIEW_ASPECTS, previewProps, SAFE_AREA, spokenFrameTime, type PreviewAspect, type PreviewAsset, type PreviewProps } from "@/lib/edit/preview";
import type { Timeline } from "@/lib/edit/timeline";
import type { FontRef } from "@/lib/edit/fonts";
import { retryFonts, useFontStates, type FontState } from "./font-loader";
import type { FrameStore } from "./frame-store";
import { Badge, Button, Callout, EmptyState, IconButton, SampleBadge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { TimelineComposition } from "./timeline-composition";
import styles from "./player-panel.module.css";

// P2-2 preview (T-067 3.3, T-068, T-072). Shows the timeline on screen; never saves, never calls a write API.
// Keys are handled only on the stage and its buttons (no document/window key handlers): typing elsewhere is untouched.
// P2-3 (T-080): the editor passes its fonts, the selected text and the texts it warns about (outlines), and gets a
// small control to read the frame and seek ("지금 재생 위치로", "이 글자 처음으로"). Without textWarnings the panel keeps
// its own P2-2 frame check.
export type PreviewControl={frame:()=>number;seek:(frame:number)=>void;toggle:()=>void};
export type PlayerPanelProps={projectId:string;timeline:Timeline|null;savedAspect:PreviewAspect;assets:ReadonlyMap<string,PreviewAsset>;dirty:boolean;timeInvalid:boolean;fonts?:readonly FontRef[];selectedTextId?:string|null;textWarnings?:ReadonlySet<string>;controlRef?:MutableRefObject<PreviewControl|null>;frameStore?:FrameStore};
const NO_FONTS:readonly FontRef[]=[],NO_TEXTS:readonly Timeline["text"][number][]=[];
type Status="paused"|"playing"|"waiting"|"error";
// F073-1: a render error on the first mount, after an aspect change or on a retry happens before the event listeners
// below are attached, so the Player error event is lost. The fallback the Player draws in place of the picture tells
// the panel itself — from an effect, never by setting parent state during render — and shows the same words.
function PlayerFailed({onFailed}:{onFailed:()=>void}){
  useEffect(()=>{onFailed();},[onFailed]);
  return <div className={styles.loading} role="alert">미리보기를 띄우지 못했어요.</div>;
}

// Player only (D3: controls are siblings so a new time does not draw the Player again).
const StageView=memo(function StageView({playerRef,props,initialFrame,onFailed}:{playerRef:RefObject<PlayerRef|null>;props:PreviewProps;initialFrame:number;onFailed:()=>void}){
  const fallback=useCallback<ErrorFallback>(()=><PlayerFailed onFailed={onFailed}/>,[onFailed]);
  return <Player ref={playerRef} component={TimelineComposition} inputProps={props} durationInFrames={props.durationInFrames} compositionWidth={props.width} compositionHeight={props.height} fps={props.fps}
    style={{width:"100%",aspectRatio:`${props.width} / ${props.height}`}}
    controls={false} clickToPlay={false} doubleClickToFullscreen={false} allowFullscreen={false}
    spaceKeyToPlayOrPause={false} // T-067 3.4: when on, the Player focuses its own play button whenever playing changes.
    loop={false} autoPlay={false} moveToBeginningWhenEnded={false} initialFrame={clampFrame(initialFrame,props.durationInFrames)}
    defaultPremountInSeconds={2} numberOfSharedAudioTags={0} browserMediaControlsBehavior={{mode:"prevent-media-session"}}
    errorFallback={fallback}
    // Remotion License (4.0.543 LICENSE.md, T-037): free for an individual; used for 은영님's personal work (T-040, PLAN 2.3).
    // Check again on an organisation change, P7 or a version change.
    acknowledgeRemotionLicense/>;
});

const motionQuery="(prefers-reduced-motion: reduce)";
const subscribeMotion=(notify:()=>void)=>{const media=window.matchMedia(motionQuery);media.addEventListener("change",notify);return ()=>media.removeEventListener("change",notify);};
export function PlayerPanel({projectId,timeline,savedAspect,assets,dirty,timeInvalid,fonts=NO_FONTS,selectedTextId=null,textWarnings,controlRef,frameStore}:PlayerPanelProps){
  const rootRef=useRef<HTMLDivElement>(null);
  // Master D-4: while a time field is wrong the last valid timeline stays on the stage (derived state, no effect).
  const json=timeline?JSON.stringify(timeline):null,[shownJson,setShownJson]=useState(json);
  if(json!==null&&json!==shownJson)setShownJson(json);
  const shown=useMemo(()=>shownJson?JSON.parse(shownJson) as Timeline:null,[shownJson]);
  const [aspect,setAspect]=useState<PreviewAspect>(savedAspect),[safeOn,setSafeOn]=useState(true);
  const [status,setStatus]=useState<Status>("paused");
  const [frame,setFrame]=useState(0),[mount,setMount]=useState({key:0,initialFrame:0}),[announce,setAnnounce]=useState(""),[outside,setOutside]=useState(false);
  const reducedMotion=useSyncExternalStore(subscribeMotion,()=>window.matchMedia(motionQuery).matches,()=>false);
  const playerRef=useRef<PlayerRef|null>(null),stageRef=useRef<HTMLDivElement>(null),quiet=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  // Fonts of the texts on the stage, loaded before the Player is first drawn (delayRender has no effect in the Player,
  // T-067 3.5). Later font changes keep the Player up and redraw when the new face arrives.
  const {result:fontResult}=useFontStates(shown?.text??NO_TEXTS,fonts);
  const missing=useMemo(()=>Object.entries(fontResult?.states??{}).filter(([,state])=>state!=="ok"),[fontResult]);
  const named=(state:FontState)=>missing.filter(([,value])=>value===state).map(([family])=>family).join(", ");
  // T-088 C-5: "글꼴 다시 불러오기" shows loading until the new attempt answers. Success → focus the chosen text's edit
  // heading (or the stage); the same failure → focus stays on the button with a status line beside it.
  const [retry,setRetry]=useState<{key:string;waitFor:number}|null>(null);
  const answered=!!retry&&!!fontResult&&fontResult.key===retry.key&&fontResult.attempt>=retry.waitFor,retrying=!!retry&&!answered,stillFailed=answered&&missing.some(([,state])=>state==="failed");
  useEffect(()=>{if(answered&&!stillFailed)(document.querySelector<HTMLElement>("[data-text-heading]")??stageRef.current)?.focus();},[answered,stillFailed]);
  const props=useMemo(()=>shown?previewProps(shown,assets,{aspect,reducedMotion,missingFamilies:missing.map(([family])=>family),selectedTextId,warnings:textWarnings}):null,[shown,assets,aspect,reducedMotion,missing,selectedTextId,textWarnings]);
  const ready=fontResult!==null&&props!==null,last=props?props.durationInFrames-1:0;

  // Player events → our state (play/pause/ended/waiting/resume/error/frameupdate, N2 PlayerStateEventMap).
  useEffect(()=>{
    const player=playerRef.current;if(!player||!ready)return;
    const onPlay=()=>setStatus("playing"),onPause=()=>{setStatus(old=>old==="error"?old:"paused");const now=player.getCurrentFrame();setAnnounce(`멈춤, ${spokenFrameTime(now)}`);},onWaiting=()=>setStatus("waiting"),onResume=()=>setStatus(player.isPlaying()?"playing":"paused"),onError=()=>setStatus("error"),onFrame=({detail}:{detail:{frame:number}})=>setFrame(detail.frame);
    player.addEventListener("play",onPlay);player.addEventListener("pause",onPause);player.addEventListener("ended",onPause);player.addEventListener("waiting",onWaiting);player.addEventListener("resume",onResume);player.addEventListener("error",onError);player.addEventListener("frameupdate",onFrame);player.addEventListener("seeked",onFrame);
    return ()=>{player.removeEventListener("play",onPlay);player.removeEventListener("pause",onPause);player.removeEventListener("ended",onPause);player.removeEventListener("waiting",onWaiting);player.removeEventListener("resume",onResume);player.removeEventListener("error",onError);player.removeEventListener("frameupdate",onFrame);player.removeEventListener("seeked",onFrame);};
  },[ready,mount.key]);
  // T-068 2.1 / Q-4: hiding the tab pauses (the Player itself keeps going when hidden); coming back does not play.
  useEffect(()=>{const onVisibility=()=>{if(document.visibilityState==="hidden")playerRef.current?.pause();};document.addEventListener("visibilitychange",onVisibility);return ()=>document.removeEventListener("visibilitychange",onVisibility);},[]);
  useEffect(()=>()=>clearTimeout(quiet.current),[]);
  // Safe-area check on the drawn text (spec rule: the real outline), for the frame on screen.
  useEffect(()=>{
    if(!ready||!props||textWarnings)return;const id=requestAnimationFrame(()=>{
      const container=playerRef.current?.getContainerNode();if(!container)return;const rect=container.getBoundingClientRect(),safe=SAFE_AREA[props.aspect];
      const inner={top:rect.top+rect.height*safe.top,bottom:rect.bottom-rect.height*safe.bottom,left:rect.left+rect.width*safe.left,right:rect.right-rect.width*safe.right};
      setOutside([...container.querySelectorAll<HTMLElement>("[data-text-body]")].some(element=>{const box=element.getBoundingClientRect();return box.width>0&&(box.top<inner.top-0.5||box.bottom>inner.bottom+0.5||box.left<inner.left-0.5||box.right>inner.right+0.5);}));
    });return ()=>cancelAnimationFrame(id);
  },[frame,props,ready,mount.key,textWarnings]);

  const seek=useCallback((target:number)=>{const player=playerRef.current;if(!player||!props)return;const next=clampFrame(target,props.durationInFrames);player.seekTo(next);setFrame(next);
    // Screen readers hear the place once the keys stop for 0.3 s (T-068 3장), not on every repeat.
    clearTimeout(quiet.current);quiet.current=setTimeout(()=>setAnnounce(spokenFrameTime(next)),300);},[props]);
  const toggle=useCallback((event?:Parameters<PlayerRef["play"]>[0])=>{const player=playerRef.current;if(!player||!props)return;
    if(player.isPlaying()){player.pause();return;}
    // At the last frame play starts again from 0 (T-068 2.1).
    if(player.getCurrentFrame()>=props.durationInFrames-1)player.seekTo(0);player.play(event);},[props]);
  useEffect(()=>{if(controlRef)controlRef.current={frame:()=>playerRef.current?.getCurrentFrame()??0,seek,toggle:()=>toggle()};});
  useEffect(()=>{frameStore?.set(frame);},[frame,frameStore]);
  function keys(event:KeyboardEvent<HTMLElement>,onStage:boolean){
    if(!ready||event.altKey||event.ctrlKey||event.metaKey)return;const now=playerRef.current?.getCurrentFrame()??frame,step=event.shiftKey?30:1;
    if(event.key===" "&&onStage){event.preventDefault();event.stopPropagation();if(!event.repeat)toggle(event);return;}
    const target=event.key==="ArrowLeft"?now-step:event.key==="ArrowRight"?now+step:event.key==="Home"?0:event.key==="End"?last:null;if(target===null)return;
    event.preventDefault();event.stopPropagation();seek(target);
  }
  // Preview-only aspect: state here only, the Player is drawn again at the same place; focus stays on the button.
  function changeAspect(next:PreviewAspect){if(next===aspect)return;retried.current=false;const now=playerRef.current?.getCurrentFrame()??frame;setAspect(next);setMount(old=>({key:old.key+1,initialFrame:now}));setFrame(now);setStatus("paused");}
  const failed=useCallback(()=>setStatus("error"),[]),retried=useRef(false);
  // Retry draws the Player again: focus goes to the new stage, and if it fails again the error box comes back with
  // focus on its button. An aspect change is not a retry: its focus stays on the aspect button.
  function reload(){retried.current=true;setStatus("paused");setMount(old=>({key:old.key+1,initialFrame:frame}));}
  const focusRetry=useCallback((box:HTMLDivElement|null)=>{if(box&&retried.current){retried.current=false;box.querySelector("button")?.focus();}},[]);
  const focusStage=useCallback((stage:HTMLDivElement|null)=>{stageRef.current=stage;if(stage&&retried.current)stage.focus();},[]);

  if(!shown||!props)return <EmptyState title="보여 줄 장면이 없어요." description="만들기 단계에서 장면을 추가해 주세요." action={<Link href={`/projects/${projectId}/produce`}>만들기 단계로</Link>}/>;
  const ratio=`${props.width} / ${props.height}`,safe=SAFE_AREA[props.aspect],moved=props.texts.some(text=>text.movedForPreview),playing=status==="playing"||status==="waiting";
  const waitReason=ready?undefined:"준비가 끝나면 쓸 수 있어요.";
  return <div ref={rootRef} className={styles.panel}>
    {aspect!==savedAspect&&<div className={styles.row}><Badge variant="dashed">미리보기 비율 {aspect} · 저장 안 됨</Badge><Button variant="ghost" size="sm" onClick={()=>{changeAspect(savedAspect);
      // This row goes away with the click: focus moves to the saved aspect button, not to the page (T-072 G-7).
      requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLButtonElement>(`[data-aspect="${savedAspect}"]`)?.focus());}}>원래 비율로({savedAspect})</Button></div>}
    {status==="error"?<div ref={focusRetry} className={styles.errorBox}><Callout tone="danger" title="미리보기를 띄우지 못했어요.">글자 편집과 저장은 그대로 할 수 있어요.</Callout><Button variant="secondary" onClick={reload}>미리보기 다시 불러오기</Button></div>:
    <div ref={focusStage} className={styles.stage} style={{aspectRatio:ratio}} tabIndex={0} aria-label={`미리보기 · ${props.aspect}`} onKeyDown={event=>keys(event,true)}>
      {ready?<StageView key={mount.key} playerRef={playerRef} props={props} initialFrame={mount.initialFrame} onFailed={failed}/>:<div className={styles.loading}><Icon name="spinner" className={styles.spin}/><span>미리보기를 준비하고 있어요.</span></div>}
      {ready&&safeOn&&<div className={styles.safe} aria-hidden="true"><span style={{top:0,left:0,right:0,height:`${safe.top*100}%`}}/><span style={{bottom:0,left:0,right:0,height:`${safe.bottom*100}%`}}/><span style={{top:`${safe.top*100}%`,bottom:`${safe.bottom*100}%`,left:0,width:`${safe.left*100}%`}}/><span style={{top:`${safe.top*100}%`,bottom:`${safe.bottom*100}%`,right:0,width:`${safe.right*100}%`}}/><i data-safe-line style={{top:`${safe.top*100}%`,bottom:`${safe.bottom*100}%`,left:`${safe.left*100}%`,right:`${safe.right*100}%`}}/></div>}
      {props.sample&&<span className={styles.sample}><SampleBadge size="sm"/></span>}
      {status==="waiting"&&<span className={styles.waiting} role="status"><Icon name="spinner" className={styles.spin}/><span className="sr-only">파일을 읽고 있어요.</span></span>}
    </div>}
    <div className={styles.transport}>
      <IconButton label={playing?"멈춤":"재생"} icon={playing?"pause":"play"} disabled={!ready||status==="error"} onClick={event=>toggle(event)} onKeyDown={event=>keys(event,false)}/>
      <IconButton label="1/30초 뒤로" icon="step-back" disabled={!ready||status==="error"} onClick={()=>seek((playerRef.current?.getCurrentFrame()??frame)-1)} onKeyDown={event=>keys(event,false)}/>
      <IconButton label="1/30초 앞으로" icon="step-forward" disabled={!ready||status==="error"} onClick={()=>seek((playerRef.current?.getCurrentFrame()??frame)+1)} onKeyDown={event=>keys(event,false)}/>
      <span className={styles.time} aria-live="off">{formatFrameTime(frame)} <span className={styles.muted}>/ {formatFrameTime(props.durationInFrames)}</span></span>
      {waitReason&&<span className={styles.reason}>{waitReason}</span>}
    </div>
    <div className={styles.transport} role="group" aria-label="미리보기 비율">
      {PREVIEW_ASPECTS.map(item=><Button key={item} variant="secondary" size="sm" aria-pressed={aspect===item} data-aspect={item} onClick={()=>changeAspect(item)}>{item}</Button>)}
      <Button variant="secondary" size="sm" aria-pressed={safeOn} onClick={()=>setSafeOn(old=>!old)}>안전 영역 보기</Button>
    </div>
    <p className="sr-only" aria-live="polite">{announce}</p>
    {outside&&<Callout tone="warning" title="글자가 안전 영역을 벗어났어요.">{`문구 길이·크기·위치를 고치고 미리보기를 다시 확인해 주세요.${missing.length?" (대신 그린 글꼴 기준)":""}`}</Callout>}
    {/* T-084 B-1: each font state says what is true now; only a failed file can be fetched again. */}
    {named("timeout")&&<Callout tone="warning" title={`${named("timeout")} 글꼴을 아직 다 불러오지 못했어요.`}>파일이 커서 시간이 걸려요. 그동안은 기본 글꼴로 보여 줘요. 다 받으면 저절로 바뀌어요.</Callout>}
    {named("failed")&&<Callout tone="warning" title={`${named("failed")} 글꼴을 불러오지 못해 기본 글꼴로 대신 보여 줘요.`}>글꼴 파일을 읽지 못했어요. 영상 만들기 전에 글꼴을 확인해 주세요. <Button variant="secondary" size="sm" loading={retrying} loadingLabel="다시 불러오는 중" onClick={()=>{if(fontResult)setRetry({key:fontResult.key,waitFor:fontResult.attempt+1});retryFonts();}}>글꼴 다시 불러오기</Button> <span role="status">{stillFailed?"다시 불러왔지만 아직 읽지 못했어요.":""}</span></Callout>}
    {named("unavailable")&&<Callout tone="warning" title={`${named("unavailable")} 글꼴은 지금 쓸 수 없어 기본 글꼴로 대신 보여 줘요.`}>저장한 값은 그대로 둬요. 다른 글꼴을 고르면 바뀌어요.</Callout>}
    <div className={styles.notes}>
      {timeInvalid&&<p>시간 칸을 고칠 때까지 마지막으로 맞았던 내용으로 보여 줘요.</p>}
      {dirty&&!timeInvalid&&<p>저장하지 않은 고침도 미리보기에 보여요.</p>}
      {moved&&<p>미리보기에서만 글자 위치를 옮겨 보여 줘요. 저장하지 않았어요.</p>}
      {reducedMotion&&props.texts.some(text=>text.animated)&&<p>움직임 줄이기 설정이라 글자 움직임은 생략해 보여요. 영상 만들기 결과는 그대로예요.</p>}
      <p>이 미리보기는 영상과 글자만 소리 없이 보여 줘요. 소리 파일은 아래 소리 칸의 원본 듣기로 하나씩, 합친 소리는 영상 만들기 결과에서 들어요.</p>
      <p>미리보기 영상은 조금 어긋날 수 있어요. 자막 맞춤은 영상 만들기 결과로 확인해요.</p>
    </div>
    <p className={`${styles.keys} ${styles.pcOnly}`}><b>키는 초점이 있는 곳 하나만 움직여요.</b><br/>재생 화면: Space 재생·멈춤 · ←/→ 1/30초 · Shift+←/→ 1초 · Home/End 처음·끝<br/>글자 칸: 글자만 고쳐요. 미리보기가 키를 가로채지 않아요.</p>
    <details className={`${styles.keys} ${styles.mobileOnly}`}><summary>키보드 사용법</summary><p><b>키는 초점이 있는 곳 하나만 움직여요.</b><br/>재생 화면: Space 재생·멈춤 · ←/→ 1/30초 · Shift+←/→ 1초 · Home/End 처음·끝<br/>글자 칸: 글자만 고쳐요. 미리보기가 키를 가로채지 않아요.</p></details>
  </div>;
}
