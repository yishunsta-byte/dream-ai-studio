"use client";
import { useId, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { FontRef } from "@/lib/edit/fonts";
import { fontStack } from "@/lib/edit/fonts";
import { ANIMATION_LABELS, kindLabel, presetFor, PRESETS, QUICK_LOOK_KINDS, type TextKind } from "@/lib/edit/presets";
import { formatFrameTime } from "@/lib/edit/preview";
import { applyPreset, changeKind, insertText, moveInsideSafeArea, moveText, newTextLayer, parseFrameTime, removeText, replaceText, type SafeSide } from "@/lib/edit/text-ops";
import { canonicalJson, framesToSeconds, TEXT_KINDS, type Timeline, type TimelineText } from "@/lib/edit/timeline";
import type { MeasureResult } from "@/components/player/text-measure";
import type { PreviewControl } from "@/components/player/player-panel";
import { Badge, Button, Callout, EmptyState } from "@/components/ui/primitives";
import { Field, useToast } from "@/components/ui/interactive";
import { Icon } from "@/components/ui/Icon";
import styles from "./text-editor.module.css";

// P2-3a text editor (T-079 3장, T-080 3~10장): the list of texts and one editor for the chosen text. Every change goes
// to the draft timeline the preview shows; nothing is saved until the page's save button. Keys are the browser's own
// (buttons, fields); there is no page-wide shortcut.
export type TimeState=Record<string,{raw:string;error:string}>;
export type TextWarning={sides:SafeSide[];lines:number|null;maxLines:number;font:"ok"|"missing"|"timeout"|"checking";beyond:boolean};
type Props={draft:Timeline;initial:Timeline;setDraft:Dispatch<SetStateAction<Timeline>>;selectedId:string|null;setSelectedId:(id:string|null)=>void;
  fonts:readonly FontRef[];required:readonly string[];plannedFrames:number;videoFrames:number;limitFrames:number;aspect:Timeline["aspect"];
  warnings:Record<string,TextWarning>;measure:MeasureResult|null;placeCheck:ReadonlySet<string>;setPlaceCheck:Dispatch<SetStateAction<ReadonlySet<string>>>;
  times:TimeState;setTimes:Dispatch<SetStateAction<TimeState>>;controlRef:MutableRefObject<PreviewControl|null>;p1Times:Record<string,{startSec:number;endSec:number}>|null};

const DISCLOSURE_REASON:Record<string,string>={"광고":"광고로 등록한 프로젝트예요.","AI 생성":"실사형 AI 영상으로 등록한 프로젝트예요.","가상인물":"가상인물 추천으로 등록한 프로젝트예요."};
const SWATCHES=[["#FFFFFF","흰색"],["#FFD84D","노랑"],["#111111","검정"],["#172636","남색"]] as const;
const IN=["none","fade","pop","slide-up","typewriter"] as const,EMPHASIS=["none","bounce","shake","scale"] as const,OUT=["none","fade","slide-down"] as const;
const SIDE_TITLE:Record<string,Record<SafeSide,[string,string]>>={
  "9:16":{bottom:["아래 안전 영역(20%)에 걸쳐 있어요.","휴대폰 앱의 설명 글·버튼에 가려질 수 있어요."],top:["위 안전 영역(12%)에 걸쳐 있어요.","앱 위쪽 표시에 가려질 수 있어요."],right:["오른쪽 안전 영역(12%)에 걸쳐 있어요.","좋아요·댓글 버튼에 가려질 수 있어요."],left:["화면 왼쪽 밖으로 나가 있어요.","글자 일부가 잘려 보여요."]},
};
const edgeTitle:[string,string]=["화면 가장자리(5%)에 너무 붙어 있어요.","일부 화면에서 잘려 보일 수 있어요."];
const shortTime=(frame:number)=>formatFrameTime(frame);
export function warningLines(warning:TextWarning|undefined,aspect:Timeline["aspect"]):[string,string][]{
  if(!warning)return [];const out:[string,string][]=[];
  if(warning.font==="missing"||warning.font==="timeout")out.push(["글꼴을 불러오지 못해 크기를 확인하지 못했어요.","대신 그린 글꼴로는 경고를 판단하지 않아요."]);
  else if(warning.font==="ok"){
    const sides=aspect==="9:16"?warning.sides.map(side=>SIDE_TITLE["9:16"][side]):warning.sides.length?[edgeTitle]:[];out.push(...sides);
    if(warning.lines!==null&&warning.lines>warning.maxLines)out.push([`글자가 길어 ${warning.lines}줄이 돼요. 최대 ${warning.maxLines}줄이에요.`,"문구를 줄이거나 크기를 줄여 주세요."]);
  }
  if(warning.beyond)out.push(["영상보다 긴 글자예요.","자르지 않고 그대로 두었어요. 필요하면 끝 시간을 직접 줄여 주세요."]);
  return out;
}
export const hasWarning=(warning:TextWarning|undefined)=>!!warning&&(warning.font==="ok"&&(warning.sides.length>0||(warning.lines!==null&&warning.lines>warning.maxLines))||warning.beyond);

export function TextEditor(props:Props){
  const {draft,initial,setDraft,selectedId,setSelectedId,videoFrames,plannedFrames,required,warnings,placeCheck,controlRef}=props;
  const notify=useToast(),listRef=useRef<HTMLUListElement>(null),addRef=useRef<HTMLDetailsElement>(null);
  const selected=draft.text.find(layer=>layer.id===selectedId)??null;
  const before=new Map(initial.text.map(layer=>[layer.id,canonicalJson(layer)]));
  const missing=required.filter(content=>!draft.text.some(layer=>layer.kind==="disclosure"&&layer.content===content));
  const focusLater=(selector:string)=>requestAnimationFrame(()=>document.querySelector<HTMLElement>(selector)?.focus());
  function add(kind:TextKind,content=""){
    const layer=newTextLayer(kind,{startFrame:controlRef.current?.frame()??0,videoFrames,plannedFrames,content,stack:draft.text.filter(item=>item.kind==="disclosure").length});
    setDraft(old=>insertText(old,layer));setSelectedId(layer.id);if(addRef.current)addRef.current.open=false;
    const length=layer.timing.endFrame-layer.timing.startFrame;if(kind!=="disclosure"&&length<90)notify({tone:"success",message:`영상이 짧아 ${framesToSeconds(length)}초만 들어갔어요.`});
    focusLater(kind==="disclosure"?`[data-text-heading]`:`#text-content-${CSS.escape(layer.id)}`);
  }
  function move(id:string,direction:1|-1){
    setDraft(old=>moveText(old,id,direction));
    // Focus stays with the moved row's same button, or its other button when this one turns off (T-080 7장).
    requestAnimationFrame(()=>{const row=listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`);const same=row?.querySelector<HTMLButtonElement>(`[data-move="${direction}"]`);(same&&!same.disabled?same:row?.querySelector<HTMLButtonElement>(`[data-move="${-direction}"]`))?.focus();});
  }
  return <div className={styles.editor}>
    {missing.map(content=><Callout key={content} tone="warning" title={`필요한 표기 '${content}'가 없어요.`}>검수에서 표기 항목을 통과할 수 없어요.<span className={styles.pcOnly}> <Button variant="secondary" size="sm" onClick={()=>add("disclosure",content)}>표기 추가</Button></span></Callout>)}
    {draft.text.length===0?<EmptyState title="아직 글자가 없어요." description="PC에서 글자를 추가할 수 있어요."/>:
    <ul ref={listRef} className={styles.list} aria-label="글자 목록">
      {draft.text.map((layer,index)=>{const warning=warnings[layer.id],label=kindLabel(layer.kind),changed=before.get(layer.id)!==canonicalJson(layer);
        return <li key={layer.id} className={styles.row} data-row={layer.id}>
          <button type="button" className={styles.pick} aria-pressed={layer.id===selectedId} aria-label={`${label} ${layer.content||"(문구 없음)"} ${shortTime(layer.timing.startFrame)}부터 ${shortTime(layer.timing.endFrame)}까지${hasWarning(warning)?" · 확인할 것 있음":""}${changed?" · 저장 안 된 변경":""}`} onClick={()=>setSelectedId(layer.id)}>
            <Badge>{label}</Badge><span className={styles.words}>{layer.content.slice(0,20)||"문구 없음"}</span><span className={styles.time}>{shortTime(layer.timing.startFrame)}–{shortTime(layer.timing.endFrame)}</span>
            <span className={styles.icons} aria-hidden="true">{layer.locked&&<Icon name="lock"/>}{hasWarning(warning)&&<Icon name="warning" className={styles.warn}/>}{warning&&warning.font!=="ok"&&<span>확인 전</span>}{changed&&<span className={styles.changed}/>}</span>
            {placeCheck.has(layer.id)&&<Badge variant="dashed">위치 확인 필요</Badge>}
          </button>
          <span className={`${styles.moves} ${styles.pcOnly}`}>
            <Button variant="ghost" size="sm" data-move="1" aria-label={`${label} ${layer.content.slice(0,20)} 앞으로`} disabled={index===draft.text.length-1} onClick={()=>move(layer.id,1)}>앞으로</Button>
            <Button variant="ghost" size="sm" data-move="-1" aria-label={`${label} ${layer.content.slice(0,20)} 뒤로`} disabled={index===0} onClick={()=>move(layer.id,-1)}>뒤로</Button>
          </span>
        </li>;})}
    </ul>}
    <p className={styles.note}>목록 아래쪽 글자가 위에 그려져요. 글자 목록: Tab으로 고르고 Enter로 편집해요.</p>
    <details ref={addRef} className={`${styles.add} ${styles.pcOnly}`}><summary><Icon name="plus"/>글자 추가</summary>
      {draft.text.length>=100?<p className={styles.note}>글자는 100개까지 넣을 수 있어요.</p>:<ul className={styles.addList}>
        {QUICK_LOOK_KINDS.map(kind=><li key={kind}><button type="button" onClick={()=>add(kind)}>{PRESETS[kind].label}<small>{PRESETS[kind].description}</small></button></li>)}
        {missing.map(content=><li key={content}><button type="button" onClick={()=>add("disclosure",content)}>표기 · {content}<small>필요한 표기예요. 영상 처음부터 끝까지 보여요.</small></button></li>)}
      </ul>}
    </details>
    {selected&&<TextInspector key={selected.id} {...props} layer={selected} index={draft.text.indexOf(selected)} onRemoved={(nextId)=>{setSelectedId(nextId);focusLater(nextId?`[data-row="${CSS.escape(nextId)}"] button`:`.${styles.add} summary`);}}/>}
  </div>;
}

function TextInspector({layer,index,draft,initial,setDraft,fonts,aspect,warnings,measure,setPlaceCheck,times,setTimes,controlRef,p1Times,limitFrames,onRemoved}:Props&{layer:TimelineText;index:number;onRemoved:(nextId:string|null)=>void}){
  const notify=useToast(),headingId=useId(),[withBox,setWithBox]=useState(false),[moveNote,setMoveNote]=useState("");
  const label=kindLabel(layer.kind),preset=presetFor(layer.kind),saved=initial.text.find(item=>item.id===layer.id);
  const update=(next:(old:TimelineText)=>TimelineText)=>setDraft(old=>replaceText(old,layer.id,next));
  const warning=warnings[layer.id],lines=warningLines(warning,aspect),measured=measure?.texts[layer.id];
  const font=fonts.find(item=>item.family===layer.style.fontFamily);
  const fromP1Look=!!p1Times&&!!saved&&canonicalJson(saved.style)===canonicalJson(layer.style);
  function quickLook(kind:TextKind){const old=layer;update(current=>applyPreset(current,kind,withBox));
    notify({tone:"success",message:`'${PRESETS[kind].label}' 모양을 적용했어요. ${withBox?"문구·시간은":"위치·문구·시간은"} 그대로예요.`,undo:()=>setDraft(current=>current.text.some(item=>item.id===old.id)?replaceText(current,old.id,()=>old):current)});}
  function moveInside(){
    if(!measured||!measure)return;const box=moveInsideSafeArea(layer.box,measured.rect,aspect,measure.width,measure.height);
    if(!box){setMoveNote("옮겨도 다 들어가지 않아요. 크기나 폭을 줄여 주세요.");return;}
    setMoveNote("");update(current=>({...current,box}));setPlaceCheck(old=>new Set([...old,layer.id]));
    requestAnimationFrame(()=>document.getElementById(headingId)?.focus());
  }
  function setTime(edge:"start"|"end",raw:string){
    const key=`${layer.id}:${edge}`,parsed=parseFrameTime(raw);
    const error="error" in parsed?(parsed.error==="format"?"시간은 00:02.15처럼 적어 주세요.":"프레임은 00~29까지예요."):null;
    const start=edge==="start"&&"frame" in parsed?parsed.frame:layer.timing.startFrame,end=edge==="end"&&"frame" in parsed?parsed.frame:layer.timing.endFrame;
    const problem=error??(end<=start?"끝은 시작보다 1프레임 이상 뒤여야 해요.":end>limitFrames&&end!==saved?.timing.endFrame?`글자 끝 시간은 ${shortTime(limitFrames)} 안이어야 해요.`:null);
    // A wrong value stays in its field with its message; the draft (and the preview) keep the last good time.
    setTimes(old=>{const next={...old};if(problem)next[key]={raw,error:problem};else{delete next[`${layer.id}:start`];delete next[`${layer.id}:end`];}return next;});
    if(!problem)update(current=>({...current,timing:{startFrame:start,endFrame:end}}));
  }
  const timeField=(edge:"start"|"end")=>{const key=`${layer.id}:${edge}`,state=times[key],frame=edge==="start"?layer.timing.startFrame:layer.timing.endFrame;
    return <div><Field label={edge==="start"?"시작":"끝"} help="1/30초 단위 · 예 00:02.15 = 2.5초" error={state?.error}><input type="text" inputMode="decimal" autoComplete="off" value={state?.raw??shortTime(frame)} onChange={event=>setTime(edge,event.target.value)}/></Field>
      <Button variant="ghost" size="sm" onClick={()=>{const now=controlRef.current?.frame();if(now!==undefined)setTime(edge,shortTime(now));}}>지금 재생 위치로</Button></div>;};
  const p1=p1Times?.[layer.id],sameTiming=!!saved&&canonicalJson(saved.timing)===canonicalJson(layer.timing);
  const p1Note=(edge:"start"|"end")=>{if(!p1||!sameTiming)return null;const seconds=edge==="start"?p1.startSec:p1.endSec,frame=edge==="start"?layer.timing.startFrame:layer.timing.endFrame,shown=framesToSeconds(frame);
    return seconds===shown?null:<p className={styles.note} key={edge}>P1에서 {seconds}초로 적은 시간이에요. 1/30초 단위로 맞춰 {shortTime(frame)}({shown}초)로 보여요. 지금 묶음 자막은 {seconds}초 그대로이고, 저장하면 {shown}초로 맞춰져요.</p>;};
  const toggleStyle=(name:"stroke"|"shadow"|"background",on:boolean)=>update(current=>({...current,style:{...current.style,[name]:on?structuredClone(presetFor(current.kind).style[name]??(name==="stroke"?{color:"#111111",width:7}:name==="shadow"?PRESETS.lyric.style.shadow:PRESETS.emphasis.style.background)):null}}));
  const percent=(value:number)=>Math.round(value*1000)/10;
  const setBox=(name:"x"|"y"|"widthRatio",value:number)=>{if(!Number.isFinite(value))return;const min=name==="widthRatio"?0.05:0;update(current=>({...current,box:{...current.box,[name]:Math.min(1,Math.max(min,Math.round(value*10)/1000))}}));setPlaceCheck(old=>{if(!old.has(layer.id))return old;const next=new Set(old);next.delete(layer.id);return next;});};
  const setMotion=(name:"in"|"out"|"emphasis",value:string)=>update(current=>({...current,animation:{...current.animation,[name]:value,durationFrames:current.animation.durationFrames||presetFor(current.kind).animation.durationFrames||8}}));
  return <section className={styles.inspector} aria-labelledby={headingId}>
    <h3 id={headingId} tabIndex={-1} data-text-heading>{label} · {layer.content.slice(0,20)||"문구 없음"} {layer.locked&&<Badge>필수 표기 · 위치만 변경</Badge>}</h3>
    <p className={styles.time}>{shortTime(layer.timing.startFrame)}–{shortTime(layer.timing.endFrame)}</p>
    {lines.length>0&&<Callout tone="warning" title={lines.length===1?lines[0][0]:`확인할 것이 ${lines.length}개 있어요.`}>
      {lines.length===1?lines[0][1]:<ul>{lines.map(([title,text])=><li key={title}>{title} {text}</li>)}</ul>}
      {warning?.font==="ok"&&warning.sides.length>0&&<><span className={styles.pcOnly}> <Button variant="secondary" size="sm" onClick={moveInside}>안전 영역 안으로 옮기기</Button></span><span className={styles.mobileOnly}> PC에서 옮길 수 있어요.</span></>}
    </Callout>}
    {moveNote&&<p role="status" className={styles.note}>{moveNote}</p>}
    {warning?.font==="checking"&&<p className={styles.note}>크기를 확인하고 있어요.</p>}
    <div className={styles.pcOnly}><Field label="종류"><select value={layer.kind} disabled={layer.locked} onChange={event=>update(current=>changeKind(current,event.target.value as TextKind))}>{TEXT_KINDS.filter(kind=>kind!=="disclosure"||layer.kind==="disclosure").map(kind=><option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></Field>
      {saved&&saved.kind!==layer.kind&&canonicalJson({...saved.style,maxLines:0})===canonicalJson({...layer.style,maxLines:0})&&<p className={styles.note}>종류만 바꿨어요. 모양은 빠른 모양에서 골라요.</p>}</div>
    {layer.locked?<div><p className={styles.note}>문구</p><p>{layer.content}</p></div>:
    <Field label="문구" required help={`최대 ${layer.style.maxLines}줄 · ${measured&&warning?.font==="ok"?`지금 ${measured.lines}줄`:"줄 수 확인 중"} · 한 줄에 ${preset.recommendedCharsPerLine}자 안팎이 읽기 좋아요.`} error={layer.content.trim()?undefined:"문구를 적어 주세요."}>
      <textarea id={`text-content-${layer.id}`} value={layer.content} maxLength={500} placeholder={`${label} 문구를 적어 주세요`} onChange={event=>update(current=>({...current,content:event.target.value}))}/></Field>}
    {!layer.locked&&<fieldset className={`${styles.group} ${styles.pcOnly}`}><legend>빠른 모양</legend>
      {fromP1Look&&<p className={styles.note}>P1에서 옮긴 모양 그대로예요. 누르기 전까지 바뀌지 않아요.</p>}
      <div className={styles.chips}>{QUICK_LOOK_KINDS.map(kind=><Button key={kind} variant="secondary" size="sm" onClick={()=>quickLook(kind)}>{PRESETS[kind].label}</Button>)}</div>
      <label className={styles.check}><input type="checkbox" checked={withBox} onChange={event=>setWithBox(event.target.checked)}/>기본 위치도 함께</label></fieldset>}
    {!layer.locked&&<fieldset className={`${styles.group} ${styles.pcOnly}`}><legend>글꼴·굵기</legend>
      <div className={styles.fields}>
        <Field label="글꼴" help={fonts.length<8?`지금 쓸 수 있는 글꼴 ${fonts.length}개예요.`:undefined}><select value={layer.style.fontFamily} style={{fontFamily:fontStack(layer.style.fontFamily)}} onChange={event=>{const next=fonts.find(item=>item.family===event.target.value);if(!next)return;update(current=>({...current,style:{...current.style,fontFamily:next.family,fontWeight:next.weights.includes(current.style.fontWeight)?current.style.fontWeight:next.weights.reduce((best,weight)=>Math.abs(weight-current.style.fontWeight)<Math.abs(best-current.style.fontWeight)?weight:best,next.weights[0])}}));}}>
          {!font&&<option value={layer.style.fontFamily} disabled>{layer.style.fontFamily} · 지금 없음</option>}
          {fonts.map(item=><option key={item.family} value={item.family} style={{fontFamily:fontStack(item.family)}}>{item.family} — {item.role}</option>)}</select></Field>
        {font&&font.weights.length>1?<Field label="굵기"><select value={layer.style.fontWeight} onChange={event=>update(current=>({...current,style:{...current.style,fontWeight:Number(event.target.value)}}))}>{!font.weights.includes(layer.style.fontWeight)&&<option value={layer.style.fontWeight} disabled>{layer.style.fontWeight} · 지금 없음</option>}{font.weights.map(weight=><option key={weight} value={weight}>{weight}</option>)}</select></Field>:<p className={styles.note}>굵기 {font?.weights[0]??layer.style.fontWeight} 하나만 있어요.</p>}
      </div>
      <p className={styles.sample} style={{fontFamily:fontStack(layer.style.fontFamily),fontWeight:layer.style.fontWeight}} aria-hidden="true">가나다 ABC 123</p>
      {!font&&<p className={styles.note}>이 글꼴은 지금 쓸 수 없어 미리보기는 다른 글꼴로 보여요. 저장한 값은 그대로 둬요.</p>}</fieldset>}
    {!layer.locked&&<fieldset className={`${styles.group} ${styles.pcOnly}`}><legend>크기·색</legend>
      <Field label="크기" help={fromP1Look?`1080 기준 크기 · P1에서 옮긴 크기예요. 새 ${label} 기본은 ${preset.style.fontSize}이에요.`:"1080 기준 크기"}><input type="number" min={18} max={120} step={1} value={layer.style.fontSize} onChange={event=>{const value=Math.round(Number(event.target.value));if(value>=18&&value<=120)update(current=>({...current,style:{...current.style,fontSize:value}}));}}/></Field>
      <div className={styles.swatches} role="group" aria-label="글자 색">{SWATCHES.map(([color,name])=><button key={color} type="button" className={styles.swatch} style={{background:color}} aria-label={name} aria-pressed={layer.style.color.toUpperCase()===color} onClick={()=>update(current=>({...current,style:{...current.style,color}}))}/>)}
        <Field label="색 고르기"><input type="color" value={layer.style.color} onChange={event=>update(current=>({...current,style:{...current.style,color:event.target.value.toUpperCase()}}))}/></Field></div>
      <label className={styles.check}><input type="checkbox" checked={!!layer.style.stroke} onChange={event=>toggleStyle("stroke",event.target.checked)}/>외곽선</label>
      {layer.style.stroke&&<div className={styles.fields}><Field label="외곽선 색"><input type="color" value={layer.style.stroke.color} onChange={event=>update(current=>({...current,style:{...current.style,stroke:{...current.style.stroke!,color:event.target.value.toUpperCase()}}}))}/></Field>
        <Field label="외곽선 바깥 두께"><input type="number" min={0} max={40} step={1} value={layer.style.stroke.width} onChange={event=>{const value=Number(event.target.value);if(value>=0&&value<=40)update(current=>({...current,style:{...current.style,stroke:{...current.style.stroke!,width:value}}}));}}/></Field></div>}
      <label className={styles.check}><input type="checkbox" checked={!!layer.style.background} onChange={event=>toggleStyle("background",event.target.checked)}/>띠</label>
      <label className={styles.check}><input type="checkbox" checked={!!layer.style.shadow} onChange={event=>toggleStyle("shadow",event.target.checked)}/>그림자</label></fieldset>}
    <fieldset className={`${styles.group} ${styles.pcOnly}`}><legend>위치</legend><div className={styles.fields}>
      <Field label="가로 위치 %"><input type="number" min={0} max={100} step={0.5} value={percent(layer.box.x)} onChange={event=>setBox("x",Number(event.target.value))}/></Field>
      <Field label="세로 위치 %"><input type="number" min={0} max={100} step={0.5} value={percent(layer.box.y)} onChange={event=>setBox("y",Number(event.target.value))}/></Field>
      {!layer.locked&&<Field label="폭 %"><input type="number" min={5} max={100} step={0.5} value={percent(layer.box.widthRatio)} onChange={event=>setBox("widthRatio",Number(event.target.value))}/></Field>}
    </div></fieldset>
    {!layer.locked&&<fieldset className={`${styles.group} ${styles.pcOnly}`}><legend>움직임</legend><div className={styles.fields}>
      <Field label="나타날 때"><select value={layer.animation.in} onChange={event=>setMotion("in",event.target.value)}>{IN.map(value=><option key={value} value={value}>{ANIMATION_LABELS[value]}</option>)}</select></Field>
      <Field label="강조" help={layer.animation.emphasis!=="none"?"강조는 글자가 보이는 동안 계속 움직여요.":undefined}><select value={layer.animation.emphasis} onChange={event=>setMotion("emphasis",event.target.value)}>{EMPHASIS.map(value=><option key={value} value={value}>{ANIMATION_LABELS[value]}</option>)}</select></Field>
      <Field label="사라질 때"><select value={layer.animation.out} onChange={event=>setMotion("out",event.target.value)}>{OUT.map(value=><option key={value} value={value}>{ANIMATION_LABELS[value]}</option>)}</select></Field>
    </div></fieldset>}
    <fieldset className={`${styles.group} ${styles.pcOnly}`}><legend>시간</legend>
      {layer.locked?<p className={styles.note}>{shortTime(layer.timing.startFrame)}–{shortTime(layer.timing.endFrame)} · 표기는 영상 처음부터 끝까지 보여요.</p>:<div className={styles.timeRow}>{timeField("start")}{timeField("end")}</div>}
      {p1Note("start")}{p1Note("end")}</fieldset>
    <div className={styles.pcOnly}>{layer.locked?<p className={styles.note}>필수 표기라 지울 수 없어요. {DISCLOSURE_REASON[layer.content]??"등록값이 요구하는 표기예요."}</p>:
      <Button variant="ghost" onClick={()=>{const removed=layer,at=index,next=draft.text[index+1]?.id??draft.text[index-1]?.id??null;setDraft(old=>removeText(old,removed.id));onRemoved(next);
        notify({tone:"success",message:"글자를 뺐어요.",undo:()=>setDraft(old=>old.text.some(item=>item.id===removed.id)?old:insertText(old,removed,at))});}}>이 글자 빼기</Button>}</div>
  </section>;
}
