// Screen wording for the render page (T-102 3장·5장·6장). Pure: server values in, sentences out. No guessing:
// a value the server did not send is not shown.
import type { RenderBlocker } from "@/lib/render/input";
import type { RenderView } from "@/lib/services/renders";

export type RenderLinkKey="edit"|"produce";
export type BlockerLine={key:string;text:string;code?:string;link?:RenderLinkKey};
export const linkLabel:Record<RenderLinkKey,string>={edit:"편집으로 가기",produce:"장면 제작으로 가기"};
export const linkHref=(key:RenderLinkKey,projectId:string)=>key==="edit"?`/projects/${projectId}/edit`:`/projects/${projectId}/produce`;

export const gb=(bytes:number)=>`${(bytes/1024**3).toFixed(1)}GB`;
export const mb=(bytes:number)=>`${(bytes/1024**2).toFixed(1)}MB`;
export function duration(seconds:number){const total=Math.max(0,Math.round(seconds)),minutes=Math.floor(total/60),rest=total%60;return minutes?`${minutes}분${rest?` ${rest}초`:""}`:`${rest}초`;}
export const aspectLabel=(width:number,height:number)=>width===height?"1:1":width>height?"16:9":"9:16";
const sceneList=(numbers:number[])=>numbers.map(n=>`장면 ${n}`).join(", ");

// Every reason at once (one fix should not reveal another). Scene reasons of the same kind are grouped.
// RENDER_ACTIVE is shown by the caller with the active render's timeline revision.
export function blockerLines(blockers:RenderBlocker[]):BlockerLine[]{
  const lines:BlockerLine[]=[],group=new Map<string,{numbers:number[];titles:string[]}>();
  for(const blocker of blockers){
    if(blocker.code==="RENDER_INPUT_MISSING"&&"sceneNumber" in blocker.params){const entry=group.get(blocker.params.reason)??{numbers:[],titles:[]};entry.numbers.push(blocker.params.sceneNumber);entry.titles.push(blocker.params.sceneTitle);group.set(blocker.params.reason,entry);continue;}
    if(blocker.code==="RENDER_INPUT_MISSING")lines.push(blocker.params.reason==="no_timeline"?{key:"no_timeline",text:"아직 저장한 타임라인이 없어요. 편집에서 한 번 저장해 주세요.",link:"edit"}:{key:"no_scenes",text:"영상에 넣을 장면이 없어요. 장면 제작에서 장면 결과를 골라 주세요.",link:"produce"});
    else if(blocker.code==="FONT_MISSING"){const [first,...rest]=blocker.params.texts;lines.push({key:`font-${blocker.params.family}`,text:`${blocker.params.family} 글꼴 파일을 찾지 못했어요.${first?` 이 글꼴을 쓰는 글자: "${first.preview}"${rest.length?` 외 ${rest.length}개`:""}.`:""}`,code:"FONT_MISSING",link:"edit"});}
    else if(blocker.code==="TIMELINE_STALE")lines.push({key:"stale",text:`장면 결과를 바꾼 뒤 타임라인을 다시 저장하지 않았어요${blocker.params.scenes.length?`: ${blocker.params.scenes.map(scene=>scene.sceneTitle).join(", ")}`:""}. 편집에서 다시 저장해 주세요.`,code:"TIMELINE_STALE",link:"edit"});
    else if(blocker.code==="RENDER_BROWSER_MISSING")lines.push(blocker.params.reason==="mismatch"?{key:"browser",text:`영상 만들기 도구의 설치본이 정해진 버전(${blocker.params.version})과 달라요. 이 PC에서 PowerShell로 scripts/install-browser.ps1을 다시 실행해 주세요.`,code:"RENDER_BROWSER_MISSING"}:{key:"browser",text:"영상 만들기 도구가 아직 설치되지 않았어요. 설치는 한 번만 하면 돼요: 이 PC에서 PowerShell로 scripts/install-browser.ps1을 실행해 주세요.",code:"RENDER_BROWSER_MISSING"});
    else if(blocker.code==="DISK_FULL")lines.push({key:"disk",text:`디스크 공간이 모자라요. 필요 약 ${gb(blocker.params.needBytes)} · 남은 ${gb(blocker.params.freeBytes)}.`,code:"DISK_FULL"});
  }
  const scene=(reason:string,text:(numbers:number[])=>string,code?:string)=>{const entry=group.get(reason);if(entry)lines.unshift({key:reason,text:text(entry.numbers),code,link:"produce"});};
  scene("unsupported_media",n=>`${sceneList(n)}의 결과 파일은 영상에 쓸 수 없는 형식이에요. 장면 제작에서 다른 결과를 골라 주세요.`,"RENDER_INPUT_MISSING");
  scene("file_changed",n=>`${sceneList(n)}의 결과 파일이 고를 때와 달라졌어요. 장면 제작에서 다시 고르거나 다시 만들어 주세요.`,"RENDER_INPUT_MISSING");
  scene("file_missing",n=>`${sceneList(n)}의 결과 파일을 찾지 못했어요. 장면 제작에서 다시 고르거나 다시 만들어 주세요.`,"RENDER_INPUT_MISSING");
  scene("empty_slot",n=>`결과를 고르지 않은 장면이 ${n.length}개 있어요: ${sceneList(n)}.`);
  return lines;
}

const kindName:Record<string,string>={image:"장면 이미지 만들기",video:"장면 영상 만들기",audio:"소리 만들기",bundle:"묶음 만들기",backup:"백업",restore:"복원",render:"다른 영상 만들기"};
export const STAGES=[{key:"prepare",label:"준비"},{key:"compose",label:"장면과 글자 합치기"},{key:"verify",label:"파일 확인"}] as const;
export const stageAnnounce:Record<string,string>={prepare:"1단계 준비를 시작했어요.",compose:"2단계 장면과 글자 합치기를 시작했어요.",verify:"파일을 확인하고 있어요."};

// Progress card: pill and body (T-102 5장). attempt is the number of starts so far (0 before the first).
export function progressCopy(render:RenderView):{pill:string;body:string}{
  if(render.cancelRequested)return {pill:"취소하는 중",body:"지금 단계가 끝나는 대로 멈춰요."};
  if(render.status==="queued"){
    if(render.attempt>0)return {pill:`다시 시작해요 · ${render.attempt+1}/${render.maxAttempts}번째`,body:render.waiting?.reason==="worker_off"?"영상 만들기 도구가 멈춰서 처음부터 다시 만들어요. 작업 처리기가 켜지면 시작해요. 이미 만든 영상은 그대로예요.":"영상 만들기 도구가 멈춰서 처음부터 다시 만들어요. 이미 만든 영상은 그대로예요."};
    if(render.waiting?.reason==="worker_off")return {pill:"차례를 기다려요",body:"작업 처리기가 켜지면 시작해요. 창을 닫아도 작업은 남아 있어요."};
    if(render.waiting?.reason==="behind_job")return {pill:"차례를 기다려요",body:`다른 작업(${kindName[render.waiting.kind]??"다른 작업"})이 끝나면 시작해요.`};
    return {pill:"차례를 기다려요",body:"곧 시작해요."};
  }
  if(render.stage==="verify")return {pill:"파일 확인 중",body:"만든 파일의 길이·해상도·코덱을 확인하고 있어요. 확인을 통과해야 완성으로 쳐요."};
  if(render.stage==="compose"&&render.progress!==null)return {pill:`${Math.floor(render.progress*100)}%${render.elapsedSec!==null?` · ${duration(render.elapsedSec)} 지남`:""}`,body:`프레임 ${render.renderedFrames}/${render.totalFrames}`};
  return {pill:"준비 중",body:"장면 파일과 글꼴을 다시 확인하고 있어요."};
}

// Verify failure: which items did not match, in plain words.
export function verifyReasons(items:{item:string;expected:string|number;actual:string|number|null;pass:boolean}[]){
  const failed=items.filter(item=>!item.pass),get=(name:string)=>items.find(item=>item.item===name),out:string[]=[];
  for(const item of failed){
    if(item.item==="durationSec")out.push(`길이가 ${item.expected}초가 아니라 ${item.actual??"알 수 없음"}${item.actual!==null?"초":""}예요`);
    else if(item.item==="width"||item.item==="height"){if(!out.some(text=>text.startsWith("해상도")))out.push(`해상도가 ${get("width")?.expected}×${get("height")?.expected}이 아니라 ${get("width")?.actual??"?"}×${get("height")?.actual??"?"}예요`);}
    else if(item.item==="videoStreams")out.push(item.actual===0?"영상 트랙이 없어요":`영상 트랙이 ${item.actual}개예요`);
    else if(item.item==="audioStreams")out.push("소리 트랙이 들어 있어요(소리 없는 영상이어야 해요)");
    else if(item.item==="colorRange"||item.item==="colorSpace"){if(!out.some(text=>text.startsWith("색 정보")))out.push("색 정보 표시가 기준(bt709·tv)과 달라요");}
    else if(item.item==="frames")out.push(`프레임 수가 ${item.expected}개가 아니라 ${item.actual??"알 수 없음"}${item.actual!==null?"개":""}예요`);
    else if(item.item==="frameRate"||item.item==="averageFrameRate"){if(!out.some(text=>text.startsWith("초당")))out.push(`초당 프레임이 30이 아니에요(${item.actual??"알 수 없음"})`);}
    else if(item.item==="codec")out.push(`영상 코덱이 H.264가 아니라 ${item.actual??"알 수 없음"}예요`);
    else if(item.item==="pixelFormat")out.push(`화소 형식이 yuv420p가 아니라 ${item.actual??"알 수 없음"}예요`);
    else if(item.item==="container")out.push("MP4 파일이 아니에요");
    else if(item.item==="otherStreams")out.push("영상 말고 다른 트랙이 들어 있어요");
    else if(item.item==="sizeBytes")out.push("파일이 비어 있어요");
  }
  return out;
}

// Failure row body (T-102 6장). The server's attempts decide the "n번" wording.
export function failureCopy(render:RenderView):{text:string;autoRetried:boolean}{
  const code=render.errorCode??"RENDER_FAILED",attempts=render.error?.attempts??render.attempt,retried=render.error?.retryable===true&&attempts>1;
  switch(code){
    case "RENDER_VERIFY_FAILED":{const reasons=render.verify?verifyReasons(render.verify.items):[];return {text:reasons.length?`파일은 만들었지만 ${reasons.join(", ")}. 그래서 완성으로 치지 않았어요.`:"파일 확인을 통과하지 못했어요. 그래서 완성으로 치지 않았어요.",autoRetried:false};}
    case "RENDER_INPUT_MISSING":return {text:"영상에 쓸 장면 파일을 찾지 못해 멈췄어요. 위의 시작 전 확인을 보고 고친 뒤 다시 만들어 주세요.",autoRetried:false};
    case "FONT_MISSING":return {text:"글자에 쓴 글꼴 파일을 불러오지 못해 멈췄어요. 편집에서 글꼴을 확인한 뒤 다시 만들어 주세요.",autoRetried:false};
    case "RENDER_INPUT_CHANGED":return {text:"만드는 동안 장면 파일이 바뀌어 멈췄어요. 다시 만들어 주세요.",autoRetried:false};
    case "RENDER_BROWSER_MISSING":return {text:"영상 만들기 도구가 없거나 설치본이 달라 멈췄어요. 설치 안내를 확인한 뒤 다시 만들어 주세요.",autoRetried:false};
    case "RENDER_BROWSER_CRASHED":return {text:retried?`영상 만들기 도구가 ${attempts}번 멈춰서 그만뒀어요. PC를 다시 켠 뒤 다시 만들어 주세요.`:"영상 만들기 도구가 도중에 멈췄어요. 다시 만들어 주세요.",autoRetried:retried};
    case "RENDER_INTERRUPTED":return {text:`작업 처리기가 ${attempts}번 중단돼 그만뒀어요. 이미 만든 영상은 그대로예요. 다시 만들어 주세요.`,autoRetried:true};
    case "TIMEOUT":return {text:"30분 안에 끝나지 않아 멈췄어요. 이미 만든 영상은 그대로예요.",autoRetried:false};
    case "DISK_FULL":return {text:"디스크 공간이 모자라 멈췄어요. 공간을 비운 뒤 다시 만들기를 눌러 주세요. 이미 만든 영상은 그대로예요.",autoRetried:false};
    case "STORAGE_FAILED":return {text:retried?`영상 파일을 저장하지 못했어요(${attempts}번 시도). 잠시 뒤 다시 만들어 주세요.`:`영상 파일을 저장하지 못했어요${render.errorMessage?`: ${render.errorMessage}`:"."} 원인을 고친 뒤 다시 만들어 주세요.`,autoRetried:retried};
    case "RESTORE_INTERRUPTED":return {text:"백업을 복원하느라 멈췄어요. 다시 만들어 주세요.",autoRetried:false};
    // The stored fallback sentence ("영상을 만들지 못했어요.") repeats the first one, so only a different reason is added.
    default:return {text:`영상을 만드는 중에 멈췄어요.${render.errorMessage&&render.errorMessage!=="영상을 만들지 못했어요."?` ${render.errorMessage}`:" 다시 만들어 주세요."}`,autoRetried:false};
  }
}
export function canceledCopy(render:RenderView){
  return render.cleanupLeft.length?`취소했어요. 임시 파일을 정리하지 못했어요: ${render.cleanupLeft.join(", ")} (그대로 둬도 다른 영상에는 영향이 없어요)`:"취소했어요. 만들던 임시 파일은 정리했어요. 이미 만든 영상은 그대로예요.";
}
