"use client";
import Image from "next/image";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { LibraryData } from "@/lib/services/library";
import { Badge, Button, Card, Callout, EmptyState, SampleBadge, StatusPill } from "./ui/primitives";
import { ConfirmPanel, Field, useToast } from "./ui/interactive";
import { Icon } from "./ui/Icon";
import styles from "./library.module.css";

const tabs=[{id:"all",label:"전체"},{id:"image",label:"이미지"},{id:"video",label:"영상"},{id:"audio",label:"오디오"},{id:"doc",label:"문서"},{id:"link",label:"링크"},{id:"character",label:"캐릭터"}] as const;
const lockFields=[{id:"face",label:"얼굴"},{id:"outfit",label:"의상"},{id:"hair",label:"머리"},{id:"accessories",label:"액세서리"},{id:"body",label:"체형"},{id:"voice",label:"목소리"}] as const;
const sizeLabel=(bytes:number|null)=>bytes===null?"":bytes>=1024**3?`${(bytes/1024**3).toFixed(1)}GB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)}MB`:`${Math.max(1,Math.ceil(bytes/1024))}KB`;
type ArchiveChoice={id:string;title:string;kind:"asset"|"character";usageCount:number;archived:boolean};
type UploadResult={name:string;ok:boolean;message:string};
async function postJson(path:string,input:unknown) {
 const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw new Error(data.error??"작업을 완료하지 못했어요.");return data;
}
function Preview({asset}:{asset:LibraryData["assets"][number]}) {
 const [failed,setFailed]=useState(false);
 if(failed)return <div className={styles.placeholder}><StatusPill status="warning">미리보기 확인 필요</StatusPill></div>;
 const src=`/api/assets/${asset.id}`;
 if(asset.kind==="image")return <Image unoptimized src={src} width={320} height={200} alt={asset.title} className={styles.image} onError={()=>setFailed(true)} />;
 if(asset.kind==="video")return <video controls preload="metadata" src={src} aria-label={asset.title} className={styles.video} onError={()=>setFailed(true)} />;
 if(asset.kind==="audio")return <div className={styles.audio}><Icon name="folder" /><audio controls preload="metadata" src={src} aria-label={asset.title} onError={()=>setFailed(true)} /></div>;
 return <div className={styles.placeholder}><Icon name={asset.kind==="link"?"arrow":"folder"} /><Badge>{asset.kind==="link"?"링크 정보":asset.mime?.split("/").at(-1)?.toUpperCase()??"문서"}</Badge></div>;
}
export function LibraryBrowser({data}:{data:LibraryData}) {
 const router=useRouter();const notify=useToast();const input=useRef<HTMLInputElement>(null);const activeUpload=useRef<XMLHttpRequest|null>(null);const canceled=useRef(false);
 const [filter,setFilter]=useState<string>("all"),[query,setQuery]=useState(""),[rights,setRights]=useState("");
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[results,setResults]=useState<UploadResult[]>([]);
 const [linkOpen,setLinkOpen]=useState(false),[characterOpen,setCharacterOpen]=useState(false),[formError,setFormError]=useState(""),[saving,setSaving]=useState(false);
 const [selection,setSelection]=useState<ArchiveChoice|null>(null);
 const assets=useMemo(()=>data.assets.filter((asset)=>!asset.archived&&(filter==="all"||(filter==="doc"?["doc","text"].includes(asset.kind):asset.kind===filter))&&asset.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[data.assets,filter,query]);
 const visibleCharacters=data.characters.filter((character)=>!character.archived&&character.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 async function upload(files:File[]) {
  if(busy||!files.length)return;canceled.current=false;setBusy(true);setResults([]);
  for(const file of files) {
   if(canceled.current)break;
   if(file.size>data.maxUploadBytes){setResults((old)=>[...old,{name:file.name,ok:false,message:`파일이 너무 커요. ${sizeLabel(data.maxUploadBytes)}까지 올릴 수 있어요.`}]);continue;}
   try{
    setProgress(`${file.name} · 올리는 중`);
    await new Promise<void>((resolve,reject)=>{
     const xhr=new XMLHttpRequest();activeUpload.current=xhr;
     xhr.open("POST",`/api/assets/upload?filename=${encodeURIComponent(file.name)}&rightsNote=${encodeURIComponent(rights)}`);
     xhr.upload.onprogress=(event)=>setProgress(`${file.name} · 올리는 중${event.lengthComputable?` ${Math.round(event.loaded/event.total*100)}%`:""}`);
     xhr.upload.onload=()=>setProgress(`${file.name} · 실제 형식 확인 중`);
     xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status===201)resolve();else reject(new Error(result.error??"파일을 올리지 못했어요."));}catch{reject(new Error("응답을 확인하지 못했어요."));}};
     xhr.onerror=()=>reject(new Error("연결을 확인하고 다시 시도해 주세요."));xhr.onabort=()=>reject(new Error("파일 올리기를 취소했어요."));xhr.send(file);
    });
    setResults((old)=>[...old,{name:file.name,ok:true,message:"실제 형식을 확인하고 저장했어요."}]);
   }catch(error){setResults((old)=>[...old,{name:file.name,ok:false,message:error instanceof Error?error.message:"파일을 올리지 못했어요."}]);}
  }
  activeUpload.current=null;setBusy(false);setProgress("");if(input.current)input.current.value="";router.refresh();
 }
 async function saveLink(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(saving)return;setSaving(true);setFormError("");const fields=new FormData(event.currentTarget);
  try{await postJson("/api/assets/link",{title:fields.get("title"),sourceUrl:fields.get("sourceUrl"),rightsNote:fields.get("rightsNote")});setLinkOpen(false);notify({tone:"success",message:"링크 정보만 저장했어요."});router.refresh();}catch(error){setFormError((error as Error).message);}finally{setSaving(false);}
 }
 async function saveCharacter(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(saving)return;setSaving(true);setFormError("");const fields=new FormData(event.currentTarget);
  const locked=Object.fromEntries(lockFields.map((field)=>[field.id,{locked:fields.has(`lock-${field.id}`),note:String(fields.get(`note-${field.id}`)??"")}])) as Record<string,{locked:boolean;note:string}>;
  try{await postJson("/api/characters",{name:fields.get("name"),description:fields.get("description"),refAssetIds:fields.getAll("references"),locked,confirmed:fields.has("confirmed"),voiceNote:fields.get("voiceNote")});setCharacterOpen(false);notify({tone:"success",message:"캐릭터 설정을 새로 저장했어요."});router.refresh();}catch(error){setFormError((error as Error).message);}finally{setSaving(false);}
 }
 async function archive() {
  if(!selection||saving)return;setSaving(true);
  try{await postJson("/api/library/archive",{kind:selection.kind,id:selection.id,archived:!selection.archived});notify({tone:"success",message:selection.archived?"목록에 다시 보여요.":"보관했어요. 보관한 자료에서 되살릴 수 있어요."});setSelection(null);router.refresh();}catch(error){notify({tone:"error",message:(error as Error).message});}finally{setSaving(false);}
 }
 const assetCard=(asset:LibraryData["assets"][number])=><Card padding="none" key={asset.id}>
  <div className={styles.preview}><Preview asset={asset} />{asset.isMock&&<div className={styles.sample}><SampleBadge /></div>}</div>
  <div className={styles.details}><h2>{asset.title}</h2><div className="cluster">
   {asset.role==="original"&&<Badge>원본</Badge>}<Badge>{asset.mime?.split("/").at(-1)?.toUpperCase()??"LINK"}</Badge>
   {asset.sizeBytes!==null&&<Badge>{sizeLabel(asset.sizeBytes)}{asset.width&&asset.height?` · ${asset.width}×${asset.height}`:""}{asset.durationMs?` · ${(asset.durationMs/1000).toFixed(1)}초`:""}</Badge>}
  </div>{asset.rightsNote?<p>{asset.rightsNote}</p>:<StatusPill status="warning">권리 확인 필요</StatusPill>}<p className="muted">프로젝트 {asset.usageCount}개에서 사용</p><div className="cluster">
   {asset.kind==="link"&&asset.sourceUrl?<a href={asset.sourceUrl} target="_blank" rel="noreferrer noopener">원본 링크 열기</a>:asset.kind!=="link"?<a href={`/api/assets/${asset.id}?download=1`}>파일 내려받기</a>:null}
   <Button variant="ghost" onClick={()=>setSelection({id:asset.id,title:asset.title,kind:"asset",usageCount:asset.usageCount,archived:asset.archived})}>{asset.archived?"되살리기":"보관하기"}</Button>
  </div></div>
 </Card>;
 const characterCard=(character:LibraryData["characters"][number])=><Card key={character.id}><div className="stack"><h2>{character.name}</h2><StatusPill status={character.status==="confirmed"?"done":"warning"}>{character.status==="confirmed"?"설정 확인됨":"설정 확인 필요"}</StatusPill><p>{character.description}</p><div className="cluster">{lockFields.filter((field)=>character.locked[field.id].locked).map((field)=><Badge key={field.id}>{field.label} 고정</Badge>)}</div><p className="muted">참조 {character.refAssetIds.length}개 · 프로젝트 {character.usageCount}개에서 사용</p><Button variant="ghost" onClick={()=>setSelection({id:character.id,title:character.name,kind:"character",usageCount:character.usageCount,archived:character.archived})}>{character.archived?"되살리기":"보관하기"}</Button></div></Card>;
 return <div className="stack"><section className={styles.dropzone} aria-label="파일 올리기" onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();void upload(Array.from(event.dataTransfer.files));}}><Icon name="folder" /><h2>작품에 쓸 자료를 올려 주세요</h2><p>PNG·JPG·WebP / MP4·MOV·WebM / MP3·WAV·M4A / PDF·TXT·MD · 파일당 {sizeLabel(data.maxUploadBytes)}</p><div className="cluster"><Button onClick={()=>input.current?.click()} disabled={busy}>파일 올리기</Button><Button variant="secondary" onClick={()=>{setLinkOpen(!linkOpen);setCharacterOpen(false);setFormError("");}}>링크 등록</Button><Button variant="ghost" onClick={()=>{setCharacterOpen(!characterOpen);setLinkOpen(false);setFormError("");}}>캐릭터 만들기</Button></div><input type="file" multiple hidden ref={input} accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.wav,.m4a,.pdf,.txt,.md" onChange={(event)=>void upload(Array.from(event.target.files??[]))} /><div className="form-width"><Field label="올리는 자료의 출처·권리 메모" help="확인한 내용만 적어 주세요. 비워 두면 확인 필요로 표시해요."><input value={rights} maxLength={500} onChange={(event)=>setRights(event.target.value)} placeholder="예: 직접 촬영한 제품 사진" /></Field></div>{busy&&<div role="status" className="stack"><p>{progress}</p><Button variant="secondary" onClick={()=>{canceled.current=true;activeUpload.current?.abort();}}>올리기 취소</Button></div>}</section>
  {results.length>0&&<Card><h2>파일별 확인 결과</h2><ul className="clean-list">{results.map((result,index)=><li key={index}><StatusPill status={result.ok?"done":"failed"}>{result.ok?"완료":"거절"}</StatusPill> {result.name}<p>{result.message}</p></li>)}</ul></Card>}
  {linkOpen&&<Card><form className="stack form-width" noValidate onSubmit={saveLink}><h2>링크 등록</h2><Callout title="링크 정보만 저장해요.">원격 파일을 받아 오거나 사이트 내용을 읽지 않아요.</Callout><Field label="제목" required><input name="title" maxLength={255} /></Field><Field label="웹 주소" required><input name="sourceUrl" type="url" placeholder="예: https://example.com/product" /></Field><Field label="메모(출처·권리)"><textarea name="rightsNote" maxLength={500} /></Field>{formError&&<p role="alert">{formError}</p>}<Button type="submit" variant="secondary" loading={saving}>링크 정보 저장</Button></form></Card>}
  {characterOpen&&<Card><form className="stack form-width" noValidate onSubmit={saveCharacter}><h2>새 캐릭터</h2><Callout title="참조 이미지로 최대한 유지해요 · 검수 필요">설정을 확인해도 생성 결과가 항상 같지는 않아요.</Callout><Field label="이름" required><input name="name" maxLength={80} /></Field><Field label="설명" required><textarea name="description" maxLength={1000} /></Field><Field label="참조 이미지·영상" help="설정 확인됨으로 저장하려면 참조를 하나 이상 골라 주세요."><select name="references" multiple>{data.assets.filter((asset)=>!asset.archived&&["image","video"].includes(asset.kind)).map((asset)=><option value={asset.id} key={asset.id}>{asset.title}</option>)}</select></Field>{lockFields.map((field)=><div key={field.id} className="stack"><Field label={`${field.label} 고정`}><input name={`lock-${field.id}`} type="checkbox" /></Field><Field label={`${field.label} 고정 메모`}><input name={`note-${field.id}`} maxLength={500} /></Field></div>)}<Field label="목소리 메모"><input name="voiceNote" maxLength={500} /></Field><Field label="참조와 고정 설정을 직접 확인했어요"><input name="confirmed" type="checkbox" /></Field>{formError&&<p role="alert">{formError}</p>}<Button type="submit" variant="secondary" loading={saving}>캐릭터 설정 저장</Button></form></Card>}
  <div className={styles.tabs} role="tablist" aria-label="자료 종류" onKeyDown={(event)=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.click();}}>{tabs.map((tab)=><button key={tab.id} role="tab" aria-selected={filter===tab.id} aria-controls="library-results" tabIndex={filter===tab.id?0:-1} onClick={()=>setFilter(tab.id)}>{tab.label}</button>)}</div>
  <div className="form-width"><Field label="자료 찾기"><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="예: 텀블러" /></Field></div>
  <div id="library-results" role="tabpanel" aria-label={tabs.find((tab)=>tab.id===filter)?.label}><div className={styles.grid}>{filter==="character"?visibleCharacters.map(characterCard):assets.map(assetCard)}</div>{(filter==="character"?!visibleCharacters.length:!assets.length)&&<Card><EmptyState title="아직 보이는 자료가 없어요" description="파일이나 링크를 등록하거나 검색어를 바꿔 보세요." /></Card>}</div>
  <details><summary>보관한 자료·캐릭터 보기</summary><div className={styles.grid}>{data.assets.filter((asset)=>asset.archived).map(assetCard)}{data.characters.filter((character)=>character.archived).map(characterCard)}</div>{!data.assets.some((asset)=>asset.archived)&&!data.characters.some((character)=>character.archived)&&<p className="muted">보관한 항목이 없어요.</p>}</details>
  <ConfirmPanel confirming={saving} open={selection!==null} title={selection?.archived?"이 항목을 되살릴까요?":"이 항목을 보관할까요?"} description={selection?.archived?`${selection.title} 항목을 목록에 다시 보여요. 원본과 연결된 프로젝트는 그대로예요.`:`${selection?.title??""} 항목을 목록에서 숨겨요. 프로젝트 ${selection?.usageCount??0}개에서 사용 중이며 연결은 그대로 남아요. 아래 보관한 자료에서 되살릴 수 있어요.`} confirmLabel={selection?.archived?"되살리기":"보관하기"} onDismiss={()=>setSelection(null)} onConfirm={()=>void archive()} />
 </div>;
}
