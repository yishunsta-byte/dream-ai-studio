"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { EditingData } from "@/lib/services/editing";
import { canonicalJson, framesToSeconds, textEndLimit, timelineSrt, totalFrames, type Timeline } from "@/lib/edit/timeline";
import { afterSave, beyondVideo, laterChanges, liveTimeFields, replaceText, safeViolations, type LaterChange } from "@/lib/edit/text-ops";
import { kindLabel } from "@/lib/edit/presets";
import { formatFrameTime } from "@/lib/edit/preview";
import { Badge, Button, Card, Callout } from "./ui/primitives";
import { useToast } from "./ui/interactive";
import styles from "./finishing-panel.module.css";
import editorStyles from "./text-editor/text-editor.module.css";
import { PlayerLoader } from "./player/player-loader";
import type { PreviewControl } from "./player/player-panel";
import type { MeasureResult } from "./player/text-measure";
import type { PreviewAsset } from "@/lib/edit/preview";
import { hasWarning, TextEditor, type TextWarning, type TimeState } from "./text-editor/text-editor";
import { TextTimeline } from "./text-editor/text-timeline";
import { createFrameStore } from "./player/frame-store";
const sourceLabel={"p1-migration":" · P1 글자 설정에서 옮김","restore-version":" · 이전 버전으로 되돌림",user:""} as const;
// Off-screen real-font measurement draws with the Player's composition (remotion): client only, loaded on demand.
const TextMeasure=dynamic(()=>import("./player/text-measure").then(module=>module.TextMeasure),{ssr:false,loading:()=>null});
export async function finishingRequest(projectId:string,revision:number,action:string,extra:Record<string,unknown>={}){const response=await fetch(`/api/projects/${projectId}/finishing`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,revision,...extra})});const result=await response.json();if(!response.ok)throw new Error(result.error??"처리하지 못했어요.");return result;}

// The page starts a new editor for every content revision. A save of this screen has one life: the POST and the page
// refresh that brings the saved version, ending when the editor of that version is on screen (T-093 F093-1).
// During that life the saving editor keeps its live state here (every change, until it goes away), and the editor
// the refresh starts takes it over: what was changed after sending stays as an unsaved change on top of the saved
// version. Only its owner writes it and it is removed when the owner goes away (the refresh's new editor has read it
// by then), so a save of an editor that is gone, a cancelled change or a later visit can never bring a draft back
// (F093-2). No time limit: a slow refresh keeps everything.
// It is taken over only by the editor of exactly the version this save made (content revision + timeline id from the
// save's answer, T-096 F096-1). If the refresh brings a newer version saved elsewhere, that version is shown as it is:
// what was changed after sending is listed for the person, never laid over it (no silent rebase, no merge).
type Handover={owner:symbol;projectId:string;sent:Timeline;arrived:{revision:number;timelineId:string}|null;draft:Timeline;times:TimeState;selectedId:string|null};
let handover:Handover|null=null;
const CONFLICT="다른 창에서 먼저 저장했어요. 지금 고친 내용은 그대로 있어요. 새로고침하면 고친 내용이 사라지니, 필요한 문구를 따로 적어 둔 뒤 새로고침해 주세요.";
export function EditingPanel({data}:{data:EditingData}){return <Editor key={data.projectId} data={data}/>;}

// P2-3a (T-079, T-080): the text editor on the timeline. The screen edits a draft Timeline (saved one + current clips,
// or a computed draft) and saves it explicitly (CAS on content revision + timeline id, same content = no new version).
function Editor({data}:{data:EditingData}){
 const initial=data.draft,savedJson=useMemo(()=>canonicalJson(initial),[initial]);
 const [me]=useState(()=>Symbol("editor"));
 // Taken over from the saving editor of the previous revision (read, not cleared: a thrown-away render may read again).
 const [took]=useState(()=>{const from=handover;if(!from||!from.arrived||from.owner===me||from.projectId!==data.projectId)return null;
  if(from.arrived.revision===data.revision&&from.arrived.timelineId===data.timelineId)return {...afterSave(from.draft,from.sent,initial),times:from.times,selectedId:from.selectedId,missed:null};
  // A newer version from elsewhere: shown as it is. Changes made after sending (if any) are only listed.
  const missed=laterChanges(from.sent,from.draft);return missed.texts.length||missed.order?{draft:initial,kept:false,times:{},selectedId:from.selectedId,missed}:null;});
 const [draft,setDraft]=useState<Timeline>(took?.draft??initial),[frameStore]=useState(createFrameStore);
 const [selectedId,setSelectedId]=useState<string|null>(took?.selectedId&&(took.draft.text.some(layer=>layer.id===took.selectedId))?took.selectedId:initial.text[0]?.id??null);
 const [times,setTimes]=useState<TimeState>(took?.times??{}),[measure,setMeasure]=useState<MeasureResult|null>(null),[placeCheck,setPlaceCheck]=useState<ReadonlySet<string>>(()=>new Set());
 const [completing,setCompleting]=useState(false),[error,setError]=useState(""),[kept,setKept]=useState(!!took?.kept),[missed,setMissed]=useState(took?.missed??null),missedRef=useRef<HTMLDivElement>(null);const router=useRouter(),notify=useToast(),controlRef=useRef<PreviewControl|null>(null),statusRef=useRef<HTMLParagraphElement>(null),errorRef=useRef<HTMLParagraphElement>(null),formRef=useRef<HTMLFormElement>(null);
 const [saving,setSaving]=useState<"post"|"refresh"|null>(null),[refreshing,startRefresh]=useTransition(),mounted=useRef(true),posting=useRef(false);
 useEffect(()=>{mounted.current=true;
  // The saved version is on screen: focus on its saved-state line (T-084 C-2).
  if(took?.missed)missedRef.current?.focus();else if(took)statusRef.current?.focus();
  return ()=>{mounted.current=false;if(handover?.owner===me)handover=null;};},[me,took]);
 // While this editor's save is on its way, its latest state is what the next editor takes over.
 useEffect(()=>{if(handover?.owner===me)handover={...handover,draft,times,selectedId};});

 const savingNow=saving==="post"||(saving==="refresh"&&refreshing),busy=savingNow||completing;
 // Typed times of a text that is gone do not block saving (T-093 F093-3A).
 const liveTimes=useMemo(()=>liveTimeFields(times,draft.text),[times,draft.text]);
 const dirty=canonicalJson(draft)!==savedJson,timeInvalid=Object.keys(liveTimes).length>0,emptyText=draft.text.some(layer=>!layer.content.trim());
 const stale=data.stale.length>0,empty=draft.video.filter(clip=>clip.sceneVersionId===null).length,videoFrames=totalFrames(draft.video),limitFrames=textEndLimit(draft.video,data.lengthSec);
 const ordered=draft.video.map(clip=>data.production.scenes.find(scene=>scene.id===clip.sceneId)!).filter(Boolean);
 const assets=useMemo(()=>{const map=new Map<string,PreviewAsset>();for(const scene of data.production.scenes)for(const version of scene.versions)if(version.asset)map.set(version.asset.id,{kind:version.asset.kind,available:version.asset.available,isMock:version.asset.isMock});return map;},[data.production]);
 // Real-font warnings in the saved aspect (T-080 6장). They never block saving.
 const warnings=useMemo(()=>{const out:Record<string,TextWarning>={};for(const layer of draft.text){const measured=measure?.texts[layer.id];
   out[layer.id]={sides:measured&&measure?safeViolations(measured.rect,draft.aspect,measure.width,measure.height):[],lines:measured&&measured.font==="ok"&&layer.content.trim()?measured.lines:null,maxLines:layer.style.maxLines,font:measured?.font??"checking",beyond:beyondVideo(layer,videoFrames)};}
  return out;},[draft.text,draft.aspect,measure,videoFrames]);
 const warned=useMemo(()=>new Set(Object.entries(warnings).filter(([,warning])=>hasWarning(warning)&&warning.font==="ok").map(([id])=>id)),[warnings]);
 const onMeasure=useCallback((result:MeasureResult)=>setMeasure(result),[]);
 // Timeline row (P2-3b): a moved text drops its typed time fields (they showed the old time).
 const onTiming=useCallback((id:string,next:(timing:Timeline["text"][number]["timing"])=>Timeline["text"][number]["timing"])=>{
  setDraft(old=>replaceText(old,id,layer=>{const timing=next(layer.timing);return timing===layer.timing||(timing.startFrame===layer.timing.startFrame&&timing.endFrame===layer.timing.endFrame)?layer:{...layer,timing};}));
  setTimes(old=>{if(!(`${id}:start` in old)&&!(`${id}:end` in old))return old;const next={...old};delete next[`${id}:start`];delete next[`${id}:end`];return next;});},[]);
 // Enter on a clip: its text field (a locked disclosure has none, so the edit fields' heading).
 const onEnter=useCallback((text:Timeline["text"][number])=>{setSelectedId(text.id);const target=()=>document.getElementById(`text-content-${text.id}`)??document.querySelector<HTMLElement>("[data-text-heading]");
  // The chosen text's fields are already on screen (focusing a clip chose it), so the focus moves at once.
  const now=document.getElementById(`text-content-${text.id}`);if(now||text.locked)target()?.focus();else requestAnimationFrame(()=>target()?.focus());},[]);
 const savedText=useMemo(()=>new Map(initial.text.map(layer=>[layer.id,canonicalJson(layer)])),[initial]);
 const rowSets=useMemo(()=>({changed:new Set(draft.text.filter(layer=>savedText.get(layer.id)!==canonicalJson(layer)).map(layer=>layer.id)),
  unchecked:new Set(Object.entries(warnings).filter(([,warning])=>warning.font!=="ok").map(([id])=>id)),
  timeErrors:new Set(Object.keys(liveTimes).map(key=>key.split(":")[0]))}),[draft.text,savedText,warnings,liveTimes]);
 const scenes=useMemo(()=>draft.video.map((clip,index)=>({startFrame:totalFrames(draft.video.slice(0,index)),label:`장면 ${index+1}`})),[draft.video]);
 const rowFrames=Math.max(limitFrames,videoFrames,30,...draft.text.map(layer=>layer.timing.endFrame));
 useEffect(()=>{if(!dirty)return;const onLeave=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener("beforeunload",onLeave);return ()=>window.removeEventListener("beforeunload",onLeave);},[dirty]);
 // Typed text is trimmed when saved; a text whose words did not change keeps its saved bytes (outer spaces too).
 function forSave():Timeline{const saved=new Map(initial.text.map(layer=>[layer.id,layer.content]));return {...draft,text:draft.text.map(layer=>saved.get(layer.id)===layer.content?layer:{...layer,content:layer.content.trim()})};}
 async function save(event?:FormEvent){event?.preventDefault();// Clicks before the screen shows the busy button (double click, Enter + click) send one POST only.
  if(timeInvalid||emptyText||busy||posting.current)return;posting.current=true;const sent=draft;setSaving("post");setError("");
  handover={owner:me,projectId:data.projectId,sent,arrived:null,draft,times,selectedId};
  try{const response=await fetch(`/api/projects/${data.projectId}/timeline`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save",revision:data.revision,timelineId:data.timelineId,timeline:forSave()})});const result=await response.json();
   // An editor that is gone (the page was left) does nothing with a late answer.
   if(!mounted.current)return;
   if(!response.ok)throw new Error(response.status===409?CONFLICT:result.error??"저장하지 못했어요.");
   if(result.result?.created===false){if(handover?.owner===me)handover=null;setSaving(null);notify({tone:"success",message:"바뀐 내용이 없어 새 버전을 만들지 않았어요."});statusRef.current?.focus();return;}
   notify({tone:"success",message:"새 타임라인 버전을 저장했어요. 현재 내용으로 다시 검수해 주세요."});
   const arrived=result.result&&typeof result.result.revision==="number"&&typeof result.result.timelineId==="string"?{revision:result.result.revision as number,timelineId:result.result.timelineId as string}:null;
   if(handover?.owner===me)handover=arrived?{...handover,arrived}:null;setSaving("refresh");startRefresh(()=>router.refresh());
  }catch(error){if(!mounted.current)return;if(handover?.owner===me)handover=null;setSaving(null);setError((error as Error).message);requestAnimationFrame(()=>errorRef.current?.focus());}
  finally{posting.current=false;}}
 async function complete(){setCompleting(true);setError("");try{await finishingRequest(data.projectId,data.revision,"complete-edit");router.push(`/projects/${data.projectId}/review`);router.refresh();}catch(error){setError((error as Error).message);requestAnimationFrame(()=>errorRef.current?.focus());}finally{if(mounted.current)setCompleting(false);}}
 function moveScene(index:number,direction:number){setDraft(old=>{const video=[...old.video];[video[index],video[index+direction]]=[video[index+direction],video[index]];return {...old,video};});}
 function cancel(){if(busy)return;setDraft(initial);setTimes({});setKept(false);setPlaceCheck(new Set());setSelectedId(old=>initial.text.some(layer=>layer.id===old)?old:initial.text[0]?.id??null);notify({tone:"success",message:"저장한 상태로 되돌렸어요."});
  // The cancel button goes away: focus moves to save (or, when there is nothing to save, to the saved-state line).
  requestAnimationFrame(()=>{const save=formRef.current?.querySelector<HTMLButtonElement>("button[type=submit]");if(save&&!save.disabled)save.focus();else statusRef.current?.focus();});}
 const saveReason=timeInvalid?"시작·끝 시간을 먼저 확인해 주세요.":emptyText?"문구를 적어 주세요.":!dirty&&!!data.savedId&&!stale?"저장할 변경이 없어요.":undefined;
 return <div className="stack">
  <Callout title="글자와 장면 순서를 고치는 화면이에요. 완성 영상은 아직 만들지 않아요.">문구·모양·순서만 고쳐도 생성 결과는 그대로 유지해요. 저장하면 새 타임라인 버전과 새 내용 버전이 생기고 검수를 다시 해야 해요. 시간은 1/30초 단위로 저장해요. 음성에 자동으로 맞추지 않아요.</Callout>
  <form ref={formRef} onSubmit={save} className={editorStyles.header}>
   <p ref={statusRef} tabIndex={-1} aria-live="polite">{data.current?<>저장됨 · 타임라인 r{data.current.revision} · <time dateTime={data.current.createdAt}>{new Date(data.current.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time>{sourceLabel[data.current.source]}{kept&&dirty&&" · 저장하는 동안 고친 내용은 아직 저장하지 않았어요."}</>:"아직 저장하지 않은 초안이에요. 저장하면 타임라인 r1이 만들어져요."}</p>
   {dirty&&<><Badge>저장하지 않은 변경</Badge><Button type="button" variant="ghost" size="sm" disabledReason={busy?"저장이 끝난 뒤 취소할 수 있어요.":undefined} onClick={cancel}>변경 취소</Button></>}
   <Button type="submit" loading={savingNow} disabledReason={saveReason}>새 글자 설정 저장</Button>
  </form>
  {data.fromP1&&dirty&&<p className="muted">저장하면 모든 글자 시간이 1/30초 단위로 맞춰져요. 차이는 0.017초 이하예요.</p>}
  {stale&&<Callout title="선택한 장면 결과가 바뀌었어요." tone="warning">저장한 타임라인과 지금 선택이 달라요. 이 화면은 지금 선택으로 보여 줘요. 저장해야 검수로 넘어갈 수 있어요.</Callout>}
  {empty>0&&<Callout title={`결과를 선택하지 않은 장면이 ${empty}개 있어요.`} tone="warning">빈 자리로 순서와 길이만 지켜요. 내보내기 전에 만들기 단계에서 결과를 선택해 주세요.</Callout>}
  {error&&<p role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
  {missed&&<div ref={missedRef} tabIndex={-1} className={editorStyles.missed}><Callout tone="warning" title="저장하는 동안 다른 창에서 더 새 버전을 저장했어요.">
   <p>지금 화면은 그 새 버전{data.current?` (타임라인 r${data.current.revision})`:""}이에요. 저장을 보낸 뒤 고친 내용은 이 버전에 넣지 않았어요. 아래를 보고 필요한 것만 다시 고쳐 주세요.</p>
   <ul>{missed.texts.map(item=><MissedItem key={item.change+item.id} item={item}/>)}{missed.order&&<li>장면 순서를 바꿨어요.</li>}</ul>
   <Button variant="secondary" size="sm" onClick={()=>{setMissed(null);requestAnimationFrame(()=>statusRef.current?.focus());}}>확인했어요</Button>
  </Callout></div>}
  <div className={styles.editor}>
   <Card><div className="stack"><h2>미리보기</h2>
    <PlayerLoader projectId={data.projectId} timeline={draft} savedAspect={data.aspect as Timeline["aspect"]} assets={assets} dirty={dirty} timeInvalid={timeInvalid} fonts={data.fonts} selectedTextId={selectedId} textWarnings={warned} controlRef={controlRef} frameStore={frameStore}/>
    <div className={styles.mobileOnly}><Callout title="장면 순서·글자 모양·시간은 PC에서 바꿔요.">휴대폰에서는 미리보기를 보고 글자 문구를 고칠 수 있어요.</Callout></div>
   </div></Card>
   <Card><div className="stack"><h2>글자</h2>
    <TextEditor draft={draft} initial={initial} setDraft={setDraft} selectedId={selectedId} setSelectedId={setSelectedId} fonts={data.fonts} required={data.requiredDisclosures} plannedFrames={data.plannedFrames} videoFrames={videoFrames} limitFrames={limitFrames} aspect={draft.aspect} warnings={warnings} measure={measure} placeCheck={placeCheck} setPlaceCheck={setPlaceCheck} times={times} setTimes={setTimes} controlRef={controlRef} p1Times={data.fromP1?data.p1Times:null}/>
   </div></Card>
  </div>
  <div className={styles.pcOnly}><Card><div className="stack"><h2>타임라인</h2>
   <TextTimeline texts={draft.text} selectedId={selectedId} onSelect={setSelectedId} onTiming={onTiming} onEnter={onEnter} totalFrames={rowFrames} videoFrames={videoFrames} limitFrames={limitFrames} scenes={scenes} warned={warned} changed={rowSets.changed} unchecked={rowSets.unchecked} timeErrors={rowSets.timeErrors} frameStore={frameStore} controlRef={controlRef}/>
  </div></Card></div>
  <Card><div className={`stack ${styles.pcOnly}`}><h2>장면 순서</h2>{ordered.map((scene,index)=><div className={styles.order} key={scene.id}><span>{index+1}. {scene.title}{draft.video[index]?.sceneVersionId===null&&<> <Badge>결과 선택 필요</Badge></>}</span><Button variant="ghost" size="sm" disabled={index===0} aria-label={`${scene.title} 위로`} onClick={()=>moveScene(index,-1)}>위로</Button><Button variant="ghost" size="sm" disabled={index===ordered.length-1} aria-label={`${scene.title} 아래로`} onClick={()=>moveScene(index,1)}>아래로</Button></div>)}</div>
   <h2>수동 자막 미리보기 (SRT)</h2><pre className={styles.srt} aria-label="읽기 전용 수동 자막">{(!dirty&&data.savedSrt!==null?data.savedSrt:timelineSrt(draft.text))||"직접 입력한 자막이 없어요."}</pre>{data.fromP1&&<p className="muted">지금 묶음은 P1에서 옮긴 시간 그대로예요. 한 번 저장하면 모든 시간이 1/30초 단위로 맞춰져요.</p>}
   {draft.text.some(layer=>beyondVideo(layer,videoFrames))&&<p className="muted">영상은 {framesToSeconds(videoFrames)}초예요. 영상보다 긴 글자는 자르지 않고 그대로 둬요.</p>}</Card>
  {data.completed&&!dirty&&!stale?<Link className="action-link" href={`/projects/${data.projectId}/review`}>현재 내용 검수하기</Link>:<Button loading={completing} disabledReason={savingNow?"저장이 끝난 뒤 넘어갈 수 있어요.":dirty||!data.savedId?"글자 설정을 먼저 저장해 주세요.":stale?"지금 선택으로 다시 저장해 주세요.":undefined} onClick={()=>void complete()}>수정 확인 완료 · 검수로</Button>}<Link href={`/projects/${data.projectId}/export`}>이전 편집용 묶음 보기 →</Link>
  <TextMeasure texts={draft.text} aspect={draft.aspect} fonts={data.fonts} onResult={onMeasure}/>
 </div>;
}
const CHANGE_LABEL={changed:"고친 글자",added:"새로 넣은 글자",removed:"뺀 글자"} as const;
function MissedItem({item}:{item:LaterChange}){
 return <li><span className={editorStyles.missedHead}>{CHANGE_LABEL[item.change]}</span> · {kindLabel(item.kind)} · {formatFrameTime(item.timing.startFrame)}–{formatFrameTime(item.timing.endFrame)}<br/><span className={editorStyles.missedText}>{item.content||"문구 없음"}</span></li>;
}
