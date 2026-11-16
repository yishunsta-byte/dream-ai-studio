"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { EditingData } from "@/lib/services/editing";
import { canonicalJson, framesToSeconds, textEndLimit, timelineSrt, totalFrames, type Timeline } from "@/lib/edit/timeline";
import { safeViolations } from "@/lib/edit/text-ops";
import { Badge, Button, Card, Callout } from "./ui/primitives";
import { useToast } from "./ui/interactive";
import styles from "./finishing-panel.module.css";
import editorStyles from "./text-editor/text-editor.module.css";
import { PlayerLoader } from "./player/player-loader";
import type { PreviewControl } from "./player/player-panel";
import type { MeasureResult } from "./player/text-measure";
import type { PreviewAsset } from "@/lib/edit/preview";
import { hasWarning, TextEditor, type TextWarning, type TimeState } from "./text-editor/text-editor";
const sourceLabel={"p1-migration":" · P1 글자 설정에서 옮김","restore-version":" · 이전 버전으로 되돌림",user:""} as const;
// Off-screen real-font measurement draws with the Player's composition (remotion): client only, loaded on demand.
const TextMeasure=dynamic(()=>import("./player/text-measure").then(module=>module.TextMeasure),{ssr:false,loading:()=>null});
export async function finishingRequest(projectId:string,revision:number,action:string,extra:Record<string,unknown>={}){const response=await fetch(`/api/projects/${projectId}/finishing`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,revision,...extra})});const result=await response.json();if(!response.ok)throw new Error(result.error??"처리하지 못했어요.");return result;}

// A saved version (new timeline id or content revision) starts a fresh editor: the draft is the saved one again.
export function EditingPanel({data}:{data:EditingData}){return <Editor key={`${data.timelineId??"draft"}:${data.revision}`} data={data}/>;}

// P2-3a (T-079, T-080): the text editor on the timeline. The screen edits a draft Timeline (saved one + current clips,
// or a computed draft) and saves it explicitly (CAS on content revision + timeline id, same content = no new version).
function Editor({data}:{data:EditingData}){
 const initial=data.draft,savedJson=useMemo(()=>canonicalJson(initial),[initial]);
 const [draft,setDraft]=useState<Timeline>(initial),[selectedId,setSelectedId]=useState<string|null>(initial.text[0]?.id??null);
 const [times,setTimes]=useState<TimeState>({}),[measure,setMeasure]=useState<MeasureResult|null>(null),[placeCheck,setPlaceCheck]=useState<ReadonlySet<string>>(()=>new Set());
 const [pending,setPending]=useState(false),[error,setError]=useState("");const router=useRouter(),notify=useToast(),controlRef=useRef<PreviewControl|null>(null);
 const dirty=canonicalJson(draft)!==savedJson,timeInvalid=Object.keys(times).length>0,emptyText=draft.text.some(layer=>!layer.content.trim());
 const stale=data.stale.length>0,empty=draft.video.filter(clip=>clip.sceneVersionId===null).length,videoFrames=totalFrames(draft.video),limitFrames=textEndLimit(draft.video,data.lengthSec);
 const ordered=draft.video.map(clip=>data.production.scenes.find(scene=>scene.id===clip.sceneId)!).filter(Boolean);
 const assets=useMemo(()=>{const map=new Map<string,PreviewAsset>();for(const scene of data.production.scenes)for(const version of scene.versions)if(version.asset)map.set(version.asset.id,{kind:version.asset.kind,available:version.asset.available,isMock:version.asset.isMock});return map;},[data.production]);
 // Real-font warnings in the saved aspect (T-080 6장). They never block saving.
 const warnings=useMemo(()=>{const out:Record<string,TextWarning>={};for(const layer of draft.text){const measured=measure?.texts[layer.id];
   out[layer.id]={sides:measured&&measure?safeViolations(measured.rect,draft.aspect,measure.width,measure.height):[],lines:measured&&measured.font==="ok"&&layer.content.trim()?measured.lines:null,maxLines:layer.style.maxLines,font:measured?.font??"checking",beyond:layer.timing.endFrame>videoFrames};}
  return out;},[draft.text,draft.aspect,measure,videoFrames]);
 const warned=useMemo(()=>new Set(Object.entries(warnings).filter(([,warning])=>hasWarning(warning)&&warning.font==="ok").map(([id])=>id)),[warnings]);
 const onMeasure=useCallback((result:MeasureResult)=>setMeasure(result),[]);
 useEffect(()=>{if(!dirty)return;const onLeave=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener("beforeunload",onLeave);return ()=>window.removeEventListener("beforeunload",onLeave);},[dirty]);
 // Typed text is trimmed when saved; a text whose words did not change keeps its saved bytes (outer spaces too).
 function forSave():Timeline{const saved=new Map(initial.text.map(layer=>[layer.id,layer.content]));return {...draft,text:draft.text.map(layer=>saved.get(layer.id)===layer.content?layer:{...layer,content:layer.content.trim()})};}
 async function save(event?:FormEvent){event?.preventDefault();if(timeInvalid||emptyText)return;setPending(true);setError("");try{const response=await fetch(`/api/projects/${data.projectId}/timeline`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save",revision:data.revision,timelineId:data.timelineId,timeline:forSave()})});const result=await response.json();if(!response.ok)throw new Error(result.error??"저장하지 못했어요.");notify({tone:"success",message:result.result?.created===false?"바뀐 내용이 없어 새 버전을 만들지 않았어요.":"새 타임라인 버전을 저장했어요. 현재 내용으로 다시 검수해 주세요."});router.refresh();}catch(error){setError((error as Error).message);}finally{setPending(false);}}
 async function complete(){setPending(true);setError("");try{await finishingRequest(data.projectId,data.revision,"complete-edit");router.push(`/projects/${data.projectId}/review`);router.refresh();}catch(error){setError((error as Error).message);}finally{setPending(false);}}
 function moveScene(index:number,direction:number){setDraft(old=>{const video=[...old.video];[video[index],video[index+direction]]=[video[index+direction],video[index]];return {...old,video};});}
 function cancel(){setDraft(initial);setTimes({});setPlaceCheck(new Set());setSelectedId(old=>initial.text.some(layer=>layer.id===old)?old:initial.text[0]?.id??null);notify({tone:"success",message:"저장한 상태로 되돌렸어요."});}
 const saveReason=timeInvalid?"시작·끝 시간을 먼저 확인해 주세요.":emptyText?"문구를 적어 주세요.":!dirty&&!!data.savedId&&!stale?"저장할 변경이 없어요.":undefined;
 return <div className="stack">
  <Callout title="글자와 장면 순서를 고치는 화면이에요. 완성 영상은 아직 만들지 않아요.">문구·모양·순서만 고쳐도 생성 결과는 그대로 유지해요. 저장하면 새 타임라인 버전과 새 내용 버전이 생기고 검수를 다시 해야 해요. 시간은 1/30초 단위로 저장해요. 음성에 자동으로 맞추지 않아요.</Callout>
  <form onSubmit={save} className={editorStyles.header}>
   <p aria-live="polite">{data.current?<>저장됨 · 타임라인 r{data.current.revision} · <time dateTime={data.current.createdAt}>{new Date(data.current.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time>{sourceLabel[data.current.source]}</>:"아직 저장하지 않은 초안이에요. 저장하면 타임라인 r1이 만들어져요."}</p>
   {dirty&&<><Badge>저장하지 않은 변경</Badge><Button type="button" variant="ghost" size="sm" onClick={cancel}>변경 취소</Button></>}
   <Button type="submit" loading={pending} disabledReason={saveReason}>새 글자 설정 저장</Button>
  </form>
  {data.fromP1&&dirty&&<p className="muted">저장하면 모든 글자 시간이 1/30초 단위로 맞춰져요. 차이는 0.017초 이하예요.</p>}
  {stale&&<Callout title="선택한 장면 결과가 바뀌었어요." tone="warning">저장한 타임라인과 지금 선택이 달라요. 이 화면은 지금 선택으로 보여 줘요. 저장해야 검수로 넘어갈 수 있어요.</Callout>}
  {empty>0&&<Callout title={`결과를 선택하지 않은 장면이 ${empty}개 있어요.`} tone="warning">빈 자리로 순서와 길이만 지켜요. 내보내기 전에 만들기 단계에서 결과를 선택해 주세요.</Callout>}
  {error&&<p role="alert">{error}</p>}
  <div className={styles.editor}>
   <Card><div className="stack"><h2>미리보기</h2>
    <PlayerLoader projectId={data.projectId} timeline={draft} savedAspect={data.aspect as Timeline["aspect"]} assets={assets} dirty={dirty} timeInvalid={timeInvalid} fonts={data.fonts} selectedTextId={selectedId} textWarnings={warned} controlRef={controlRef}/>
    <div className={styles.mobileOnly}><Callout title="장면 순서·글자 모양·시간은 PC에서 바꿔요.">휴대폰에서는 미리보기를 보고 글자 문구를 고칠 수 있어요.</Callout></div>
   </div></Card>
   <Card><div className="stack"><h2>글자</h2>
    <TextEditor draft={draft} initial={initial} setDraft={setDraft} selectedId={selectedId} setSelectedId={setSelectedId} fonts={data.fonts} required={data.requiredDisclosures} plannedFrames={data.plannedFrames} videoFrames={videoFrames} limitFrames={limitFrames} aspect={draft.aspect} warnings={warnings} measure={measure} placeCheck={placeCheck} setPlaceCheck={setPlaceCheck} times={times} setTimes={setTimes} controlRef={controlRef} p1Times={data.fromP1?data.p1Times:null}/>
   </div></Card>
  </div>
  <Card><div className={`stack ${styles.pcOnly}`}><h2>장면 순서</h2>{ordered.map((scene,index)=><div className={styles.order} key={scene.id}><span>{index+1}. {scene.title}{draft.video[index]?.sceneVersionId===null&&<> <Badge>결과 선택 필요</Badge></>}</span><Button variant="ghost" size="sm" disabled={index===0} aria-label={`${scene.title} 위로`} onClick={()=>moveScene(index,-1)}>위로</Button><Button variant="ghost" size="sm" disabled={index===ordered.length-1} aria-label={`${scene.title} 아래로`} onClick={()=>moveScene(index,1)}>아래로</Button></div>)}</div>
   <h2>수동 자막 미리보기 (SRT)</h2><pre className={styles.srt} aria-label="읽기 전용 수동 자막">{(!dirty&&data.savedSrt!==null?data.savedSrt:timelineSrt(draft.text))||"직접 입력한 자막이 없어요."}</pre>{data.fromP1&&<p className="muted">지금 묶음은 P1에서 옮긴 시간 그대로예요. 한 번 저장하면 모든 시간이 1/30초 단위로 맞춰져요.</p>}
   {draft.text.some(layer=>layer.timing.endFrame>videoFrames)&&<p className="muted">영상은 {framesToSeconds(videoFrames)}초예요. 영상보다 긴 글자는 자르지 않고 그대로 둬요.</p>}</Card>
  {data.completed&&!dirty&&!stale?<Link className="action-link" href={`/projects/${data.projectId}/review`}>현재 내용 검수하기</Link>:<Button loading={pending} disabledReason={dirty||!data.savedId?"글자 설정을 먼저 저장해 주세요.":stale?"지금 선택으로 다시 저장해 주세요.":undefined} onClick={()=>void complete()}>수정 확인 완료 · 검수로</Button>}<Link href={`/projects/${data.projectId}/export`}>이전 편집용 묶음 보기 →</Link>
  <TextMeasure texts={draft.text} aspect={draft.aspect} fonts={data.fonts} onResult={onMeasure}/>
 </div>;
}
