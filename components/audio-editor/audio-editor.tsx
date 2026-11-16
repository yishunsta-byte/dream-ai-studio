"use client";
// P2-5 U2/U3 (T-146 4·6장, T-149): the sound card of the editing screen. It edits the same draft Timeline as the text
// editor (same dirty / save / recovery life, no auto save, no second save button). PC edits (add, role, times, size,
// fades, ducking, song join, rights); a phone reads the settings and can listen to an original file. Listening is
// one original file at a time, as it is: the edit preview stays silent, the final mix is heard on the render result.
import { useEffect, useId, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Badge, Button, Callout } from "../ui/primitives";
import { useToast } from "../ui/interactive";
import type { PreviewControl } from "../player/player-panel";
import { addClip, AUDIO_FIELD_LABEL, audioTime, canAddSound, changeRole, fileNote, joinCandidates, parseAudioTime, parseGain, planJoin, removeClip, removeJoin, ROLE_LABEL, sourceFrames, updateClip, updateRights, type AudioField, type AudioProblems, type AudioRawState, type AudioRole, type AudioSource, type JoinPlan } from "@/lib/edit/audio-ops";
import { outputFrames, type Timeline, type TimelineAudioClip, type TimelineV2 } from "@/lib/edit/timeline";
import styles from "./audio-editor.module.css";

type Props={projectId:string;draft:Timeline;saved:Timeline;setDraft:Dispatch<SetStateAction<Timeline>>;sources:readonly AudioSource[];
  raw:AudioRawState;setRaw:Dispatch<SetStateAction<AudioRawState>>;selectedId:string|null;setSelectedId:(id:string|null)=>void;
  problems:AudioProblems;busy:boolean;onUploaded:()=>void;controlRef:MutableRefObject<PreviewControl|null>};
const ROLES:AudioRole[]=["voice","music","effect"];
const lengthLabel=(source:AudioSource|undefined)=>{const frames=sourceFrames(source?.durationMs??null);return frames===null?"길이 모름":audioTime(frames);};
const sourceTitle=(sources:readonly AudioSource[],id:string)=>sources.find(source=>source.id===id)?.title??"보관함에 없는 파일";

export function AudioEditor(props:Props){
  const {draft,sources,selectedId,problems}=props;const [said,setSaid]=useState(""),[audition,setAudition]=useState<string|null>(null),headingRef=useRef<HTMLHeadingElement>(null);
  const v2=draft.schemaVersion===2?draft:null,legacy=draft.schemaVersion===1&&draft.audio.length>0;
  const clips=v2?.audio??[],selected=clips.find(clip=>clip.id===selectedId)??null;
  const announce=(text:string)=>setSaid(text);
  return <section className={styles.section} aria-labelledby="audio-heading">
    <h2 id="audio-heading" ref={headingRef} tabIndex={-1}>소리</h2>
    <p className={styles.note}>편집 미리보기는 지금도 소리 없이 보여요. 여기서 고른 소리·크기·서서히·곡 연결은 저장한 뒤 <strong>영상 만들기 결과</strong>에서 들을 수 있어요.</p>
    {legacy&&<Callout tone="warning" title="예전 형식의 소리 기록이 있어요.">이 타임라인의 소리 기록에는 원본에서 가져올 구간이 없어요. 자동으로 바꾸지 않고 그대로 둬요. 이 상태로는 소리를 넣거나 렌더할 수 없어요.</Callout>}
    {!v2&&!legacy&&<p className={styles.note}>아직 소리를 넣지 않았어요. 소리를 넣으면 이 타임라인이 소리 설정을 담는 형식으로 저장돼요(저장 전까지는 바뀌지 않아요).</p>}
    {clips.length>0&&<ClipList {...props} clips={clips} onListen={id=>{setAudition(id);announce(`'${sourceTitle(sources,id)}' 원본을 아래에서 들을 수 있어요.`);}}/>}
    {problems.general.length>0&&<ul className={styles.problem}>{problems.general.map(message=><li key={message}>{message}</li>)}</ul>}
    <div className={styles.mobileOnly}><Callout title="소리 넣기·시간·곡 연결은 PC에서 바꿔요.">휴대폰에서는 소리 설정과 권리 기록을 보고, 원본 파일을 들어 볼 수 있어요. 글자 문구는 위에서 그대로 고칠 수 있어요.</Callout>
      {v2&&v2.audioRights.length>0&&<RightsView timeline={v2} sources={sources}/>}</div>
    <div className={styles.pcOnly}><div className={styles.section}>
      {canAddSound(draft)&&<AddSound {...props} announce={announce} onListen={setAudition}/>}
      {v2&&selected&&<ClipInspector key={selected.id} {...props} timeline={v2} clip={selected} announce={announce} focusList={()=>headingRef.current?.focus()}/>}
      {v2&&v2.audioRights.length>0&&<RightsEditor {...props} timeline={v2}/>}
      <Upload busy={props.busy} onUploaded={props.onUploaded} announce={announce}/>
    </div></div>
    <Audition sources={sources} id={audition} onClose={()=>setAudition(null)}/>
    <p role="status" aria-live="polite" className={styles.note}>{said}</p>
  </section>;
}

function ClipList({clips,sources,selectedId,setSelectedId,problems,raw,onListen}:Props&{clips:TimelineAudioClip[];onListen:(assetId:string)=>void}){
  return <ul className={styles.list} aria-label="넣은 소리">{clips.map(clip=>{const source=sources.find(item=>item.id===clip.assetId),issues=[...(problems.clips[clip.id]??[]),...(problems.joins[clip.id]??[])],typed=Object.keys(raw).some(key=>key.startsWith(`${clip.id}:`));
    const text=<><strong>{ROLE_LABEL[clip.role]}</strong> · {source?.title??"보관함에 없는 파일"}{source?.isMock&&<> <Badge>샘플</Badge></>}
      <span className={styles.meta}>영상 안 {audioTime(clip.startFrame)}–{audioTime(clip.startFrame+clip.durationFrames)} · 원본 {audioTime(clip.sourceInFrame)}부터 · 크기 {clip.gainDb>0?"+":""}{clip.gainDb}dB{clip.duckUnderVoice&&" · 목소리 때 낮춤"}</span>
      {(issues.length>0||typed)&&<span className={`${styles.meta} ${styles.problem}`}>확인할 것 {issues.length+(typed?1:0)}개</span>}</>;
    return <li key={clip.id} className={styles.row} data-selected={clip.id===selectedId}>
      <span className={styles.pcOnly} style={{flex:"1 1 220px",minWidth:0}}><button type="button" className={styles.rowMain} aria-pressed={clip.id===selectedId} onClick={()=>setSelectedId(clip.id)}>{text}</button></span>
      <span className={`${styles.mobileOnly} ${styles.rowText}`}>{text}</span>
      <Button variant="ghost" size="sm" disabledReason={source&&source.available?undefined:"파일이 없어 들을 수 없어요."} aria-label={`${source?.title??"파일"} 원본 듣기`} onClick={()=>onListen(clip.assetId)}>원본 듣기</Button>
    </li>;})}</ul>;
}

function AddSound({draft,setDraft,sources,setSelectedId,busy,announce,onListen}:Props&{announce:(text:string)=>void;onListen:(id:string)=>void}){
  const choices=sources.filter(source=>!source.archived&&source.available),[sourceId,setSourceId]=useState(""),[role,setRole]=useState<AudioRole|"">(""),[error,setError]=useState(""),id=useId();
  // a file that left the list (archived elsewhere, list read again) is no longer chosen
  const chosen=choices.find(source=>source.id===sourceId);
  function add(){if(!chosen||!role)return;const result=addClip(draft,chosen,role);if("error" in result){setError(result.error);return;}
    setError("");setDraft(result.timeline);setSelectedId(result.clipId);
    announce(`${ROLE_LABEL[role]} '${chosen.title}'를 ${audioTime(result.startFrame)}–${audioTime(result.startFrame+result.durationFrames)}에 넣었어요. 저장해야 남아요.`);
    requestAnimationFrame(()=>document.getElementById(`audio-clip-${result.clipId}`)?.focus());}
  return <div className={styles.box}><h3>소리 넣기</h3>
    {choices.length===0?<p className={styles.note}>넣을 수 있는 소리 파일이 없어요. 아래에서 MP3·WAV·M4A를 올리거나 자료 보관함에서 보관을 풀어 주세요.</p>:<>
    <div className={styles.grid}>
      <div><label htmlFor={`${id}-source`}>소리 파일</label><br/><select id={`${id}-source`} className={styles.select} value={chosen?sourceId:""} onChange={event=>{setSourceId(event.target.value);setError("");}}>
        <option value="">파일을 골라 주세요</option>{choices.map(source=><option key={source.id} value={source.id}>{source.title} · {lengthLabel(source)}{source.isMock?" · 샘플":""}</option>)}</select></div>
      <div><label htmlFor={`${id}-role`}>역할</label><br/><select id={`${id}-role`} className={styles.select} value={role} onChange={event=>{setRole(event.target.value as AudioRole|"");setError("");}}>
        <option value="">역할을 골라 주세요</option>{ROLES.map(item=><option key={item} value={item}>{ROLE_LABEL[item]}</option>)}</select></div>
    </div>
    <p className={styles.note}>파일 이름으로 역할을 정하지 않아요. 처음엔 영상 처음(두 번째 곡은 앞 곡 끝)부터, 파일 길이와 남은 영상 시간 중 짧은 만큼 넣어요. 소리로 영상을 늘리지 않아요.</p>
    <div className={styles.inline}><Button variant="secondary" disabledReason={busy?"저장이 끝난 뒤 넣을 수 있어요.":!chosen?"소리 파일을 골라 주세요.":!role?"역할을 골라 주세요.":undefined} onClick={add}>이 소리 넣기</Button>
      {chosen&&<Button variant="ghost" size="sm" onClick={()=>onListen(chosen.id)}>원본 듣기</Button>}</div>
    {error&&<p role="alert" className={styles.problem}>{error}</p>}</>}
  </div>;
}

// A time / length field (MM:SS.FF) or the size field: a value that is not valid yet stays in the field with its message
// (kept in `raw`, handed over and put in the recovery file); the draft keeps the last good value.
function RawField({clip,field,value,raw,setRaw,onValue,help,problem}:{clip:TimelineAudioClip;field:AudioField;value:string;raw:AudioRawState;setRaw:Dispatch<SetStateAction<AudioRawState>>;onValue:(text:string)=>string|null;help:string;problem?:string}){
  const key=`${clip.id}:${field}`,state=raw[key],id=`audio-${field}-${clip.id}`,error=state?.error??problem;
  return <div><label htmlFor={id}>{AUDIO_FIELD_LABEL[field]}</label><br/>
    <input id={id} className={styles.input} type="text" inputMode="decimal" autoComplete="off" value={state?.raw??value} aria-invalid={!!error} aria-describedby={`${id}-help${error?` ${id}-error`:""}`}
      onChange={event=>{const text=event.target.value,message=onValue(text);setRaw(old=>{const next={...old};if(message)next[key]={raw:text,error:message};else delete next[key];return next;});}}/>
    <p id={`${id}-help`} className={styles.meta}>{help}</p>{error&&<p id={`${id}-error`} className={styles.problem}>{error}</p>}</div>;
}

function ClipInspector({timeline,clip,saved,setDraft,sources,raw,setRaw,setSelectedId,problems,controlRef,announce,focusList}:Props&{timeline:TimelineV2;clip:TimelineAudioClip;announce:(text:string)=>void;focusList:()=>void}){
  const notify=useToast(),source=sources.find(item=>item.id===clip.assetId),whole=sourceFrames(source?.durationMs??null),end=outputFrames(timeline);
  const set=(patch:Parameters<typeof updateClip>[2])=>setDraft(old=>old.schemaVersion===2?updateClip(old,clip.id,patch):old);
  const time=(field:"startFrame"|"sourceInFrame"|"durationFrames"|"fadeInFrames"|"fadeOutFrames",min:number)=>(text:string)=>{const parsed=parseAudioTime(text);if("error" in parsed)return parsed.error;
    if(parsed.frame<min)return min===1?"1/30초 이상이어야 해요.":"0 이상이어야 해요.";set({[field]:parsed.frame});return null;};
  const note=fileNote(clip,saved,source),issues=problems.clips[clip.id]??[];
  function remove(){const before=timeline;setDraft(old=>old.schemaVersion===2?removeClip(old,clip.id):old);setRaw(old=>Object.fromEntries(Object.entries(old).filter(([key])=>!key.startsWith(`${clip.id}:`))));setSelectedId(null);
    notify({tone:"success",message:`${ROLE_LABEL[clip.role]} '${source?.title??"파일"}'를 뺐어요. 원본 파일과 저장한 버전은 그대로예요.`,undo:()=>setDraft(current=>current.schemaVersion===2&&!current.audio.some(item=>item.id===clip.id)?before:current)});
    requestAnimationFrame(focusList);}
  function role(next:AudioRole){const result=changeRole(timeline,clip.id,next);setDraft(result.timeline);
    announce(`역할을 ${ROLE_LABEL[next]}(으)로 바꿨어요.${result.duckOff?" 목소리에 맞춰 낮추기를 껐어요.":""}${result.droppedJoins?` 곡 연결 ${result.droppedJoins}개를 풀었어요(겹치는 시간만큼 앞당긴 시작은 그대로예요).`:""}`);}
  return <div className={styles.box} aria-labelledby={`audio-clip-${clip.id}`}>
    <h3 id={`audio-clip-${clip.id}`} tabIndex={-1}>{ROLE_LABEL[clip.role]} · {source?.title??"보관함에 없는 파일"}</h3>
    <p className={styles.meta}>원본 길이 {whole===null?"모름":audioTime(whole)} · 영상 길이 {audioTime(end)} · 원본 파일을 자르거나 복사하지 않아요.</p>
    {note&&<Callout tone="warning" title="이 소리의 파일을 확인해 주세요.">{note}</Callout>}
    {issues.length>0&&<ul className={styles.problem}>{issues.map(message=><li key={message}>{message}</li>)}</ul>}
    <div className={styles.grid}>
      <div><label htmlFor={`audio-role-${clip.id}`}>역할</label><br/><select id={`audio-role-${clip.id}`} className={styles.select} value={clip.role} onChange={event=>role(event.target.value as AudioRole)}>{ROLES.map(item=><option key={item} value={item}>{ROLE_LABEL[item]}</option>)}</select></div>
      <RawField clip={clip} field="startFrame" value={audioTime(clip.startFrame)} raw={raw} setRaw={setRaw} onValue={time("startFrame",0)} help="영상에서 이 소리가 시작하는 때 · 예 00:02.15"/>
      <RawField clip={clip} field="durationFrames" value={audioTime(clip.durationFrames)} raw={raw} setRaw={setRaw} onValue={time("durationFrames",1)} help="쓸 길이 · 1/30초 단위"/>
      <RawField clip={clip} field="sourceInFrame" value={audioTime(clip.sourceInFrame)} raw={raw} setRaw={setRaw} onValue={time("sourceInFrame",0)} help="원본 파일의 이 지점부터 가져와요"/>
      <RawField clip={clip} field="gainDb" value={String(clip.gainDb)} raw={raw} setRaw={setRaw} onValue={text=>{const parsed=parseGain(text);if("error" in parsed)return parsed.error;set({gainDb:parsed.gainDb});return null;}} help="dB · 0은 원본과 같은 크기, -60~12"/>
      <RawField clip={clip} field="fadeInFrames" value={audioTime(clip.fadeInFrames)} raw={raw} setRaw={setRaw} onValue={time("fadeInFrames",0)} help="처음에 서서히 커지는 시간"/>
      <RawField clip={clip} field="fadeOutFrames" value={audioTime(clip.fadeOutFrames)} raw={raw} setRaw={setRaw} onValue={time("fadeOutFrames",0)} help="끝에 서서히 작아지는 시간"/>
    </div>
    <div className={styles.inline}><Button variant="ghost" size="sm" onClick={()=>{const now=controlRef.current?.frame();if(now===undefined)return;setRaw(old=>{const next={...old};delete next[`${clip.id}:startFrame`];return next;});set({startFrame:now});announce(`영상 안 시작을 ${audioTime(now)}로 했어요.`);}}>시작을 지금 재생 위치로</Button>
      <Button variant="ghost" size="sm" onClick={()=>controlRef.current?.seek(clip.startFrame)}>이 소리 시작으로 이동</Button></div>
    {clip.role==="music"?<label className={styles.check}><input type="checkbox" checked={clip.duckUnderVoice} onChange={event=>set({duckUnderVoice:event.target.checked})}/>목소리가 나올 때 이 음악을 낮춰요</label>
      :<p className={styles.meta}>목소리에 맞춰 낮추기는 배경 음악에만 써요.</p>}
    {clip.role==="music"&&<JoinBox timeline={timeline} clip={clip} sources={sources} setDraft={setDraft} raw={raw} setRaw={setRaw} problems={problems} announce={announce}/>}
    <div className={styles.inline}><Button variant="danger" size="sm" onClick={remove}>이 소리 빼기</Button></div>
  </div>;
}

// Song join (crossfade) from this song to another: the changed values are listed before the person confirms.
function JoinBox({timeline,clip,sources,setDraft,raw,setRaw,problems,announce}:{timeline:TimelineV2;clip:TimelineAudioClip;sources:readonly AudioSource[];setDraft:Dispatch<SetStateAction<Timeline>>;raw:AudioRawState;setRaw:Dispatch<SetStateAction<AudioRawState>>;problems:AudioProblems;announce:(text:string)=>void}){
  const outgoing=timeline.audioJoins.find(join=>join.fromClipId===clip.id),incoming=timeline.audioJoins.find(join=>join.toClipId===clip.id),candidates=joinCandidates(timeline,clip.id);
  const [toId,setToId]=useState(""),[text,setText]=useState("00:01.00"),[plan,setPlan]=useState<JoinPlan|null>(null),key=`${clip.id}:join`;
  const name=(id:string)=>sourceTitle(sources,timeline.audio.find(item=>item.id===id)?.assetId??"");
  const fieldName:Record<string,string>={fadeOutFrames:"끝 서서히",fadeInFrames:"처음 서서히",startFrame:"영상 안 시작"};
  function preview(fromText:string,target:string){const parsed=parseAudioTime(fromText);
    if("error" in parsed){setRaw(old=>({...old,[key]:{raw:fromText,error:parsed.error}}));setPlan(null);return;}
    setRaw(old=>{const next={...old};delete next[key];return next;});setPlan(target?planJoin(timeline,clip.id,target,parsed.frame):null);}
  const issues=problems.joins[clip.id]??[];
  return <div className={styles.box}><h4>곡 연결(부드럽게 겹치기)</h4>
    {incoming&&<p className={styles.meta}>앞 곡 '{name(incoming.fromClipId)}'에서 {audioTime(incoming.durationFrames)} 겹쳐 이어져요.</p>}
    {outgoing?<>
      <p>다음 곡 '{name(outgoing.toClipId)}'로 {audioTime(outgoing.durationFrames)} 겹쳐 이어요.</p>
      <div className={styles.inline}><label htmlFor={`join-${clip.id}`}>{AUDIO_FIELD_LABEL.join}</label><input id={`join-${clip.id}`} className={styles.input} type="text" inputMode="decimal" autoComplete="off" value={raw[key]?.raw??audioTime(outgoing.durationFrames)} aria-invalid={!!raw[key]}
        onChange={event=>{const value=event.target.value,parsed=parseAudioTime(value);
          if("error" in parsed){setRaw(old=>({...old,[key]:{raw:value,error:parsed.error}}));return;}
          const next=planJoin(timeline,clip.id,outgoing.toClipId,parsed.frame);if("error" in next){setRaw(old=>({...old,[key]:{raw:value,error:next.error}}));return;}
          setRaw(old=>{const copy={...old};delete copy[key];return copy;});setDraft(next.timeline);}}/></div>
      <p className={styles.meta}>겹침을 바꾸면 다음 곡 시작이 함께 움직여요(앞 곡 끝 − 겹침).</p>
      {raw[key]&&<p className={styles.problem}>{raw[key].error}</p>}
      <div className={styles.inline}><Button variant="ghost" size="sm" onClick={()=>{setDraft(old=>old.schemaVersion===2?removeJoin(old,clip.id):old);setRaw(old=>{const next={...old};delete next[key];return next;});announce("곡 연결을 풀었어요. 다음 곡 시작은 그대로예요. 두 곡이 겹치면 시작을 옮겨 주세요.");}}>연결 풀기</Button></div>
    </>:candidates.length===0?<p className={styles.meta}>이어 붙일 다른 배경 음악이 없어요.</p>:<>
      <div className={styles.grid}>
        <div><label htmlFor={`join-to-${clip.id}`}>이어질 곡</label><br/><select id={`join-to-${clip.id}`} className={styles.select} value={toId} onChange={event=>{setToId(event.target.value);preview(text,event.target.value);}}>
          <option value="">곡을 골라 주세요</option>{candidates.map(item=><option key={item.id} value={item.id}>{name(item.id)} · {audioTime(item.startFrame)}부터</option>)}</select></div>
        <div><label htmlFor={`join-new-${clip.id}`}>{AUDIO_FIELD_LABEL.join}</label><br/><input id={`join-new-${clip.id}`} className={styles.input} type="text" inputMode="decimal" autoComplete="off" value={raw[key]?.raw??text} aria-invalid={!!raw[key]} onChange={event=>{setText(event.target.value);preview(event.target.value,toId);}}/></div>
      </div>
      {raw[key]&&<p className={styles.problem}>{raw[key].error}</p>}
      {plan&&("error" in plan?<p className={styles.problem}>{plan.error}</p>:<div>
        <p>이렇게 바꿔요{plan.changes.length===0&&" (바뀌는 값 없음)"}:</p>
        {plan.changes.length>0&&<ul className={styles.changes}>{plan.changes.map(change=><li key={change.clipId+change.field}>'{name(change.clipId)}' {fieldName[change.field]}: {audioTime(change.from)} → {audioTime(change.to)}</li>)}</ul>}
        <p className={styles.meta}>다른 소리·장면·글자 시간은 움직이지 않아요.</p>
        {plan.problems.length>0&&<ul className={styles.problem}>{plan.problems.map(message=><li key={message}>{message}</li>)}</ul>}
        <Button variant="secondary" size="sm" disabledReason={plan.problems.length?"위 문제를 먼저 풀어 주세요.":undefined} onClick={()=>{setDraft(plan.timeline);setPlan(null);setToId("");announce(`'${name(clip.id)}' 다음에 '${name(plan.timeline.audioJoins.at(-1)!.toClipId)}'를 이어 붙였어요.`);}}>이대로 연결</Button>
      </div>)}
    </>}
    {issues.length>0&&<ul className={styles.problem}>{issues.map(message=><li key={message}>{message}</li>)}</ul>}
  </div>;
}

const RIGHTS_FIELDS=[["sourceUrl","출처 주소","https://…"],["planName","요금제·이용 조건 이름",""],["createdOn","만든 날(파일·곡을 만든 날)",""],["licenseNote","라이선스 메모",""]] as const;
function RightsEditor({timeline,sources,setDraft,problems}:Props&{timeline:TimelineV2}){
  const value=(text:string)=>text.trim()===""?null:text;
  return <div className={styles.box}><h3>소리 권리 기록</h3>
    <p className={styles.note}>쓰는 소리 파일마다 한 줄이에요. 모르면 비워 두세요(직접 확인 필요로 남아요). 적어도 검수나 사용권이 자동으로 통과되지 않아요. 날짜를 업로드한 날로 채우지 않아요.</p>
    {timeline.audioRights.map(row=>{const source=sources.find(item=>item.id===row.assetId),issues=problems.rights[row.assetId]??[];
      return <fieldset key={row.assetId} className={styles.box}><legend>{source?.title??"보관함에 없는 파일"}</legend>
        <div className={styles.grid}>{RIGHTS_FIELDS.map(([field,label,placeholder])=>{const id=`rights-${field}-${row.assetId}`;
          return <div key={field}><label htmlFor={id}>{label}</label><br/><input id={id} className={styles.input} type={field==="createdOn"?"date":field==="sourceUrl"?"url":"text"} placeholder={placeholder} autoComplete="off" value={row[field]??""}
            onChange={event=>{const next=value(event.target.value);setDraft(old=>old.schemaVersion===2?updateRights(old,row.assetId,{[field]:next}):old);}}
            onBlur={event=>{const next=event.target.value.trim()||null;if(next!==row[field])setDraft(old=>old.schemaVersion===2?updateRights(old,row.assetId,{[field]:next}):old);}}/></div>;})}</div>
        {source?.rightsNote&&<div className={styles.inline}><span className={styles.meta}>보관함 메모: {source.rightsNote}</span>
          <Button variant="ghost" size="sm" disabledReason={row.licenseNote?"라이선스 메모가 이미 있어요.":undefined} onClick={()=>setDraft(old=>old.schemaVersion===2?updateRights(old,row.assetId,{licenseNote:source.rightsNote!.trim().slice(0,1000)||null}):old)}>라이선스 메모로 옮기기</Button></div>}
        {issues.length>0&&<ul className={styles.problem}>{issues.map(message=><li key={message}>{message}</li>)}</ul>}
      </fieldset>;})}
  </div>;
}
function RightsView({timeline,sources}:{timeline:TimelineV2;sources:readonly AudioSource[]}){
  return <div className={styles.box}><h3>소리 권리 기록</h3><ul className={styles.list}>{timeline.audioRights.map(row=><li key={row.assetId} className={styles.rowText}>
    <strong>{sourceTitle(sources,row.assetId)}</strong><span className={styles.meta}>출처 {row.sourceUrl??"비어 있음"} · 조건 {row.planName??"비어 있음"} · 만든 날 {row.createdOn??"비어 있음"} · 메모 {row.licenseNote??"비어 있음"}</span></li>)}</ul></div>;
}

// Upload through the existing library route. Done = the original is kept in the library; nothing is put on the timeline.
function Upload({busy,onUploaded,announce}:{busy:boolean;onUploaded:()=>void;announce:(text:string)=>void}){
  const [progress,setProgress]=useState(""),[error,setError]=useState(""),request=useRef<XMLHttpRequest|null>(null),input=useRef<HTMLInputElement>(null),id=useId();
  useEffect(()=>()=>request.current?.abort(),[]);
  function upload(file:File){setError("");const xhr=new XMLHttpRequest();request.current=xhr;
    xhr.open("POST",`/api/assets/upload?filename=${encodeURIComponent(file.name)}&rightsNote=`);
    xhr.upload.onprogress=event=>setProgress(`${file.name} · 올리는 중${event.lengthComputable?` ${Math.round(event.loaded/event.total*100)}%`:""}`);
    xhr.upload.onload=()=>setProgress(`${file.name} · 실제 형식 확인 중`);
    xhr.onload=()=>{request.current=null;setProgress("");if(input.current)input.current.value="";
      if(xhr.status===201){announce(`'${file.name}'를 자료 보관함에 올렸어요. 타임라인에는 아직 넣지 않았어요. 위 목록에서 골라 넣어 주세요.`);onUploaded();return;}
      let message="올리지 못했어요.";try{message=JSON.parse(xhr.responseText).error??message;}catch{/* keep the plain message */}setError(message);};
    xhr.onerror=()=>{request.current=null;setProgress("");setError("올리지 못했어요. 연결을 확인해 주세요.");};
    xhr.onabort=()=>{request.current=null;setProgress("");if(input.current)input.current.value="";announce("올리기를 취소했어요. 편집 중인 내용은 그대로예요.");};
    xhr.send(file);}
  return <div className={styles.box}><h3>소리 파일 올리기</h3>
    <label htmlFor={`${id}-file`}>MP3·WAV·M4A 파일</label>
    <input ref={input} id={`${id}-file`} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,.mp3,.wav,.m4a" disabled={busy||!!progress} onChange={event=>{const file=event.target.files?.[0];if(file)upload(file);}}/>
    <p className={styles.meta}>올리면 자료 보관함에 원본이 남아요. 편집 중인 내용은 그대로 두고 목록만 새로 읽어요.</p>
    {progress&&<div className={styles.inline}><span role="status" className={styles.progress}>{progress}</span><Button variant="ghost" size="sm" onClick={()=>request.current?.abort()}>올리기 취소</Button></div>}
    {error&&<p role="alert" className={styles.problem}>{error}</p>}
  </div>;
}

// U3: one original file at a time, as it is (no position, size, fade or loudness applied). Stops when the file changes,
// the box closes, the tab is hidden or the editor goes away. Never plays without the person's action.
function Audition({sources,id,onClose}:{sources:readonly AudioSource[];id:string|null;onClose:()=>void}){
  const ref=useRef<HTMLAudioElement>(null),[failedKey,setFailedKey]=useState(""),[reload,setReload]=useState(0),source=sources.find(item=>item.id===id),key=`${id}:${reload}`,failed=failedKey===key;
  // the owned element stops when the file changes, it is loaded again or the box goes away
  useEffect(()=>{const element=ref.current;return ()=>{element?.pause();};},[key]);
  useEffect(()=>{const hide=()=>{if(document.visibilityState==="hidden")ref.current?.pause();};document.addEventListener("visibilitychange",hide);return ()=>document.removeEventListener("visibilitychange",hide);},[]);
  if(!id)return null;
  return <div className={styles.box} role="region" aria-label="원본 파일 미리듣기"><h3>원본 파일 미리듣기 · {source?.title??"파일"}</h3>
    <p className={styles.note}>영상 안 위치·소리 크기·서서히·음량 맞추기를 적용하지 않은 원본이에요. 편집 미리보기와 함께 재생되지 않아요.</p>
    <audio key={key} ref={ref} className={styles.audio} controls preload="none" src={`/api/assets/${id}`} onError={()=>setFailedKey(key)}/>
    {failed&&<div role="alert"><p className={styles.problem}>원본 미리듣기를 열지 못했어요. 파일과 편집 중인 내용은 그대로예요.</p><div className={styles.inline}><Button variant="ghost" size="sm" onClick={()=>setReload(count=>count+1)}>다시 불러오기</Button></div></div>}
    <div className={styles.inline}><Button variant="ghost" size="sm" onClick={()=>{ref.current?.pause();onClose();}}>미리듣기 닫기</Button></div>
  </div>;
}

