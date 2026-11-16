"use client";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type HTMLAttributes, type KeyboardEvent, type ReactNode, type MutableRefObject, type PointerEvent } from "react";
import { kindLabel } from "@/lib/edit/presets";
import { formatFrameTime } from "@/lib/edit/preview";
import { barKeyAction, clipKeyAction, rulerSteps, shiftTiming, type TimingEdit } from "@/lib/edit/text-ops";
import { FPS, type TimelineText } from "@/lib/edit/timeline";
import type { PreviewControl } from "@/components/player/player-panel";
import type { FrameStore } from "@/components/player/frame-store";
import { Badge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import styles from "./text-timeline.module.css";

// P2-3b timeline text row (T-091 spec, T-033 3.2.1·3.3, T-080 A-17). PC only. One row per text in list order. Keys are
// handled by the focused element alone and never reach the page (no window/document listener). Two tab stops:
// - the position bar (slider): ←/→ seek 1 frame, Shift 1 s, Home/End, Space play/pause. Text times never change.
// - the clips (roving, the chosen one has tabIndex 0): ←/→ move 1 frame, Shift 1 s, Alt end only (Alt+Shift 1 s),
//   ↑/↓ choose the clip above/below, Enter the text field, Space play/pause. The play position never changes.
//   Held keys are gathered and applied once per animation frame.
// Pointer: past 3 px a clip drag starts; the drag shows a temporary place and changes the draft once on release.
// Esc, pointercancel and lost capture put it back. The end handle changes the end only. Saving stays explicit.
type Props={texts:readonly TimelineText[];selectedId:string|null;onSelect:(id:string)=>void;onTiming:(id:string,next:(timing:TimelineText["timing"])=>TimelineText["timing"])=>void;
  onEnter:(text:TimelineText)=>void;totalFrames:number;videoFrames:number;limitFrames:number;scenes:readonly {startFrame:number;label:string}[];
  warned:ReadonlySet<string>;changed:ReadonlySet<string>;unchecked:ReadonlySet<string>;timeErrors:ReadonlySet<string>;frameStore:FrameStore;controlRef:MutableRefObject<PreviewControl|null>};
type Drag={id:string;mode:TimingEdit;pointerId:number;x:number;perFrame:number;origin:TimelineText["timing"];moved:boolean;element:HTMLElement};
export const LOCKED_TIME="필수 표기는 시간을 바꿀 수 없어요.";
const DRAGGING="끄는 중에는 키로 옮길 수 없어요. 놓거나 Esc로 취소해요.";
const LABEL_W=76,ROW_H=32,MIN_BAR=4,MIN_HIT=24;
const clock=(frame:number)=>{const seconds=Math.floor(frame/FPS);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;};

export function TextTimeline({texts,selectedId,onSelect,onTiming,onEnter,totalFrames,videoFrames,limitFrames,scenes,warned,changed,unchecked,timeErrors,frameStore,controlRef}:Props){
  const bodyRef=useRef<HTMLDivElement>(null),listRef=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null),pending=useRef<{id:string;mode:TimingEdit;delta:number}|null>(null),raf=useRef<number|null>(null),late=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const quiet=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),textsRef=useRef(texts),helpId=useId();
  const [announce,setAnnounce]=useState(""),[width,setWidth]=useState(0),[dragView,setDragView]=useState<{id:string;timing:TimelineText["timing"]}|null>(null);
  useEffect(()=>{textsRef.current=texts;});
  // Choosing a text from the row changes the edit fields above it (a subtitle's fields are much taller than a
  // disclosure's). Keep the row where it was on screen so the clip stays under the pointer and in view.
  const anchor=useRef<number|null>(null);
  const choose=(id:string)=>{if(id!==selectedId&&bodyRef.current)anchor.current=bodyRef.current.getBoundingClientRect().top;onSelect(id);};
  useLayoutEffect(()=>{const top=anchor.current;anchor.current=null;if(top===null||!bodyRef.current)return;const shift=bodyRef.current.getBoundingClientRect().top-top;if(Math.abs(shift)>1)window.scrollBy(0,shift);},[selectedId]);
  const total=Math.max(1,totalFrames),track=Math.max(0,width-LABEL_W),px=(frame:number)=>frame/total*track;
  useEffect(()=>{const element=bodyRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(element);return ()=>observer.disconnect();},[]);
  useEffect(()=>()=>{if(raf.current!==null)cancelAnimationFrame(raf.current);clearTimeout(late.current);clearTimeout(quiet.current);},[]);
  // Read once, 0.5 s after the keys stop (not on every repeat).
  const say=useCallback((text:string,delay=500)=>{clearTimeout(quiet.current);quiet.current=setTimeout(()=>setAnnounce(text),delay);},[]);
  // Choosing another text during a drag (for example in the list) ends the drag without changing anything.
  useEffect(()=>{const state=drag.current;if(!state||state.id===selectedId)return;drag.current=null;
    if(state.element.hasPointerCapture(state.pointerId))state.element.releasePointerCapture(state.pointerId);
    setDragView(null);if(state.moved)say("다른 글자를 골라 옮기기를 취소했어요.",0);},[selectedId,say]);
  const flush=useCallback(()=>{
    if(raf.current!==null){cancelAnimationFrame(raf.current);raf.current=null;}clearTimeout(late.current);
    const job=pending.current;pending.current=null;if(!job||job.delta===0)return;
    const before=textsRef.current.find(item=>item.id===job.id);if(!before)return;
    const next=shiftTiming(before.timing,job.delta,job.mode,limitFrames);
    if(next===before.timing){say(job.delta<0?"더 앞으로 옮길 수 없어요.":`${formatFrameTime(limitFrames)}까지만 옮길 수 있어요.`,0);return;}
    onTiming(job.id,timing=>shiftTiming(timing,job.delta,job.mode,limitFrames));
    // Held keys that ran into 0 or the limit: say where it stopped and why.
    const stopped=job.mode==="move"?next.startFrame!==before.timing.startFrame+job.delta:next.endFrame!==before.timing.endFrame+job.delta;
    say(`${formatFrameTime(next.startFrame)}부터 ${formatFrameTime(next.endFrame)}까지${stopped?job.delta<0?" · 더 앞으로 옮길 수 없어요.":` · ${formatFrameTime(limitFrames)}까지만 옮길 수 있어요.`:""}`);
  },[limitFrames,onTiming,say]);
  function queue(id:string,mode:TimingEdit,delta:number){
    if(pending.current&&(pending.current.id!==id||pending.current.mode!==mode))flush();
    pending.current={id,mode,delta:(pending.current?.delta??0)+delta};// Next animation frame; a slowed-down frame (hidden or busy window) still gets the change within 100 ms.
    if(raf.current===null){raf.current=requestAnimationFrame(flush);late.current=setTimeout(flush,100);}
  }
  // The clip buttons are always drawn, so the focus moves right away (no key can land on the old clip in between).
  const focusClip=(id:string)=>listRef.current?.querySelector<HTMLElement>(`[data-clip="${CSS.escape(id)}"]`)?.focus();
  function clipKeys(event:KeyboardEvent<HTMLButtonElement>,text:TimelineText,index:number){
    const action=clipKeyAction(event,text.locked,!!drag.current);if(!action)return;
    event.preventDefault();event.stopPropagation();
    if(action.type==="cancel")cancelDrag();
    else if(action.type==="dragging"){if(!event.repeat)say(DRAGGING,0);}
    else if(action.type==="enter"){flush();onEnter(text);}
    else if(action.type==="toggle"){if(!event.repeat)controlRef.current?.toggle();}
    else if(action.type==="select"){flush();const next=texts[index+action.step];if(next){choose(next.id);focusClip(next.id);}}
    else if(action.type==="locked"){if(!event.repeat)say(LOCKED_TIME,0);}
    else queue(text.id,action.mode,action.delta);
  }
  function startDrag(event:PointerEvent<HTMLButtonElement>,text:TimelineText){
    if(event.button!==0)return;flush();choose(text.id);
    if(text.locked){say(LOCKED_TIME,0);return;}
    if(track<=0)return;const mode:TimingEdit=(event.target as HTMLElement).dataset.handle==="end"?"end":"move";
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={id:text.id,mode,pointerId:event.pointerId,x:event.clientX,perFrame:track/total,origin:text.timing,moved:false,element:event.currentTarget};
  }
  function moveDrag(event:PointerEvent<HTMLButtonElement>){
    const state=drag.current;if(!state||event.pointerId!==state.pointerId)return;const dx=event.clientX-state.x;
    if(!state.moved&&Math.abs(dx)<=3)return;state.moved=true;
    setDragView({id:state.id,timing:shiftTiming(state.origin,Math.round(dx/state.perFrame),state.mode,limitFrames)});
  }
  function endDrag(event:PointerEvent<HTMLButtonElement>){
    const state=drag.current;if(!state||event.pointerId!==state.pointerId)return;drag.current=null;
    if(state.element.hasPointerCapture(state.pointerId))state.element.releasePointerCapture(state.pointerId);
    const now=textsRef.current.find(item=>item.id===state.id)?.timing;
    // The text changed some other way during the drag (time fields, cancel changes): the drag does not overwrite it.
    if(!now||now.startFrame!==state.origin.startFrame||now.endFrame!==state.origin.endFrame){setDragView(null);if(state.moved)say("시간이 바뀌어 옮기기를 취소했어요.",0);return;}
    const final=state.moved?shiftTiming(state.origin,Math.round((event.clientX-state.x)/state.perFrame),state.mode,limitFrames):state.origin;setDragView(null);
    if(final!==state.origin){onTiming(state.id,()=>final);say(`${formatFrameTime(final.startFrame)}부터 ${formatFrameTime(final.endFrame)}까지`,0);}
    focusClip(state.id);
  }
  function cancelDrag(){
    const state=drag.current;if(!state)return;drag.current=null;setDragView(null);
    if(state.element.hasPointerCapture(state.pointerId))state.element.releasePointerCapture(state.pointerId);
    if(state.moved)say("옮기기를 취소했어요.",0);
  }
  // The position bar and empty places of a row: seek only (the chosen text stays).
  const frameAt=(clientX:number)=>{const rect=bodyRef.current?.getBoundingClientRect();if(!rect||track<=0)return 0;return Math.round(Math.min(1,Math.max(0,(clientX-rect.left-LABEL_W)/track))*(total-1));};
  const scrubbing=useRef<number|null>(null);
  function seekDown(event:PointerEvent<HTMLDivElement>){if(event.button!==0||(event.target as HTMLElement).closest("[data-clip]"))return;event.currentTarget.setPointerCapture(event.pointerId);scrubbing.current=event.pointerId;controlRef.current?.seek(frameAt(event.clientX));}
  function seekMove(event:PointerEvent<HTMLDivElement>){if(scrubbing.current===event.pointerId)controlRef.current?.seek(frameAt(event.clientX));}
  function seekUp(event:PointerEvent<HTMLDivElement>){if(scrubbing.current!==event.pointerId)return;scrubbing.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
  function barKeys(event:KeyboardEvent<HTMLDivElement>){
    const control=controlRef.current;if(!control)return;const action=barKeyAction(event,control.frame(),total);if(!action)return;
    event.preventDefault();event.stopPropagation();
    if(action.type==="toggle"){if(!event.repeat)control.toggle();}else control.seek(action.frame);
  }
  const label=rulerSteps(total,track).label,seconds=Math.floor((total-1)/FPS),stop=texts.some(text=>text.id===selectedId)?selectedId:texts[0]?.id??null;
  return <div className={styles.wrap}>
    <p className={styles.help} id={helpId}>클립을 고르고 ←/→로 옮겨요. Alt+←/→는 끝 시간만 바꿔요.</p>
    <div className={styles.body} ref={bodyRef} style={{["--tl-label" as string]:`${LABEL_W}px`,["--tl-row" as string]:`${ROW_H}px`}}>
      <PositionBar store={frameStore} total={total} track={track} onKeyDown={barKeys} onPointerDown={seekDown} onPointerMove={seekMove} onPointerUp={seekUp} onPointerCancel={seekUp}>
        {Array.from({length:seconds+1},(_,second)=><span key={second} className={second%label===0?styles.major:styles.tick} style={{left:LABEL_W+px(second*FPS)}} aria-hidden="true">{second%label===0?clock(second*FPS):""}</span>)}
        {videoFrames<total&&<span className={`${styles.scene} ${styles.videoEnd}`} style={{left:LABEL_W+px(videoFrames)}} aria-hidden="true">영상 끝</span>}
        {scenes.map(scene=><span key={scene.startFrame+scene.label} className={styles.scene} style={{left:LABEL_W+px(scene.startFrame)}} aria-hidden="true">{scene.label}</span>)}
      </PositionBar>
      <div className={styles.rows} ref={listRef} role="group" aria-label="글자 클립" aria-describedby={helpId} onPointerDown={seekDown} onPointerMove={seekMove} onPointerUp={seekUp} onPointerCancel={seekUp}>
        {videoFrames<total&&<div className={styles.after} style={{left:LABEL_W+px(videoFrames)}} aria-hidden="true"/>}
        {texts.length===0&&<div className={styles.row}><span className={styles.name}/><span className={styles.empty}>아직 글자가 없어요. 위 &apos;글자 추가&apos;로 넣어요.</span></div>}
        {texts.map((text,index)=>{const view=dragView?.id===text.id?dragView.timing:text.timing,selected=text.id===selectedId,warn=!text.locked&&warned.has(text.id);
          const bar=Math.max(MIN_BAR,px(view.endFrame-view.startFrame)),hit=Math.max(MIN_HIT,bar),center=LABEL_W+px(view.startFrame)+bar/2;
          const name=`${kindLabel(text.kind)} ${text.content||"문구 없음"} ${formatFrameTime(text.timing.startFrame)}부터 ${formatFrameTime(text.timing.endFrame)}까지${warn?" · 확인할 것 있음":""}${unchecked.has(text.id)?" · 확인 전":""}${changed.has(text.id)?" · 저장 안 된 변경":""}${text.locked?" · 필수 표기, 시간 고정":""}${timeErrors.has(text.id)?" · 시간 칸 확인 필요":""}`;
          return <div key={text.id} className={styles.row}>
            <span className={styles.name} aria-hidden="true">{text.locked&&<Icon name="lock"/>}<Badge>{kindLabel(text.kind)}</Badge></span>
            <button type="button" data-clip={text.id} aria-pressed={selected} aria-label={name} tabIndex={text.id===stop?0:-1}
              className={`${styles.clip} ${selected?styles.selected:""} ${warn?styles.warn:""} ${text.locked?styles.locked:""}`} style={{left:center-hit/2,width:hit}}
              onFocus={()=>{if(!selected)choose(text.id);}} onBlur={flush} onKeyDown={event=>clipKeys(event,text,index)}
              onPointerDown={event=>startDrag(event,text)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={()=>{if(drag.current)cancelDrag();}}>
              <span className={styles.bar} style={{width:bar}}>{bar>=48&&<span className={styles.label}>{text.content.slice(0,40)}</span>}{changed.has(text.id)&&<span className={styles.dot}/>}</span>
              {selected&&!text.locked&&bar>=MIN_HIT&&<span className={styles.handle} data-handle="end" style={{left:(hit+bar)/2-8}} aria-hidden="true"/>}
              {dragView?.id===text.id&&<span className={styles.bubble} aria-hidden="true">{formatFrameTime(view.startFrame)}–{formatFrameTime(view.endFrame)}</span>}
            </button>
          </div>;})}
        <Playhead store={frameStore} left={LABEL_W} track={track} total={total}/>
      </div>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{announce}</p>
  </div>;
}

// Re-drawn on every Player frame; the rows are not.
const PositionBar=memo(function PositionBar({store,total,track,children,...handlers}:{store:FrameStore;total:number;track:number;children:ReactNode}&Pick<HTMLAttributes<HTMLDivElement>,"onKeyDown"|"onPointerDown"|"onPointerMove"|"onPointerUp"|"onPointerCancel">){
  const frame=useSyncExternalStore(store.subscribe,store.get,()=>0);
  return <div className={styles.ruler} role="slider" tabIndex={0} aria-label="재생 위치" aria-valuemin={0} aria-valuemax={total-1} aria-valuenow={frame} aria-valuetext={formatFrameTime(frame)} {...handlers}>
    {children}<span className={styles.head} style={{left:LABEL_W+frame/total*track}} aria-hidden="true"/>
  </div>;
});
function Playhead({store,left,track,total}:{store:FrameStore;left:number;track:number;total:number}){
  const frame=useSyncExternalStore(store.subscribe,store.get,()=>0);
  return <span className={styles.line} style={{left:left+frame/total*track}} aria-hidden="true"/>;
}
