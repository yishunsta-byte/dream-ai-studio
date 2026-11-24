"use client";
import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MenuSnapshot, ProjectInputErrors } from "@/lib/menus/inputs";
import { Button, Card, Callout } from "./ui/primitives";
import { Field, FormErrorSummary, useToast } from "./ui/interactive";
import { createProjectFormRequest } from "./project-form-request";
import { createPrivatePngUpload } from "./cloud/private-png-request";

type Choices={assets:{id:string;title:string;kind:string}[];characters:{id:string;name:string;status:string}[]};
export function ProjectForm({ snapshot, choices, privatePng = false, onCreated }: {snapshot:MenuSnapshot;choices:Choices;privatePng?:boolean;onCreated?:(id:string)=>void}) {
 const fields=useMemo(()=>[...snapshot.commonInputs,...snapshot.menu.inputs],[snapshot]);
 const [values,setValues]=useState<Record<string,unknown>>(()=>Object.fromEntries(fields.map((field)=>[field.id,field.type==="checkbox"?false:["assets","characters","multiselect"].includes(field.type)?[]:field.id==="aspect"?snapshot.menu.defaultAspect:field.id==="lengthSec"?snapshot.menu.defaultLengthSec:""])));
 const [errors,setErrors]=useState<ProjectInputErrors>({});
 const [pending,setPending]=useState(false);
 const [saveProject]=useState(createProjectFormRequest);
 const [uploadPng]=useState(createPrivatePngUpload);
 const [file,setFile]=useState<File|null>(null);
 const [rightsNote,setRightsNote]=useState("");
 const [savedId,setSavedId]=useState("");
 const [retryStep,setRetryStep]=useState<"upload"|"project"|null>(null);
 const submitting=useRef(false);
 const router=useRouter();const notify=useToast();
 const summary=useMemo(()=>Object.entries(errors).map(([id,message])=>({id:id==="_form"?"project-form-error":`input-${id}`,label:fields.find((field)=>field.id===id)?.label??"입력 내용",message})),[errors,fields]);
 const change=(id:string,value:unknown)=>setValues((old)=>({...old,[id]:value}));
 async function submit(event:FormEvent) {
  event.preventDefault();if(submitting.current)return;
  submitting.current=true;setPending(true);setErrors({});setRetryStep(null);
  try {
   let inputs=values;
   if(privatePng){
    if(!file || file.size===0 || file.size>1024*1024){
     setErrors({productAssets:"1 MiB 이하의 PNG 사진 한 장을 선택해 주세요."});return;
    }
    try {inputs={...values,productAssets:[await uploadPng(file,rightsNote)]};}
    catch(error){setRetryStep("upload");setErrors({productAssets:error instanceof TypeError?"사진 업로드 결과를 확인할 수 없어요. 연결 상태를 확인해 주세요.":error instanceof Error?error.message:"사진 업로드를 확인해 주세요."});return;}
   }
   const result=await saveProject(snapshot.menu.id,inputs);
   if(!result)return;
   if(result.errors){if(privatePng)setRetryStep("project");setErrors(result.errors);return;}
   if(privatePng){setSavedId(result.id);onCreated?.(result.id);return;}
   notify({tone:"success",message:"프로젝트를 등록했어요."});router.push(`/projects/${result.id}/brief`);router.refresh();
  } catch {
   if(privatePng)setRetryStep("project");
   setErrors({_form:privatePng?"프로젝트 저장 결과를 확인할 수 없어요.":"저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."});
  }
  finally{submitting.current=false;setPending(false);}
 }
 if(savedId)return <Callout title="프로젝트를 저장했어요."><Link href={`/cloud/projects/${savedId}`}>저장한 프로젝트 열기</Link></Callout>;
 return <form className="stack form-width" noValidate onSubmit={submit}><div id="project-form-error" tabIndex={-1}><FormErrorSummary errors={summary} /></div>
  <Callout title="확인한 내용만 등록해 주세요.">광고·협찬, 실사형 AI, 음악 항목을 선택하면 검수 항목이 추가돼요.</Callout>
  <Card><div className="stack">{fields.map((field)=>{
   const id=`input-${field.id}`;
   const props={id,name:field.id};
   const selected=Array.isArray(values[field.id]) ? values[field.id] as string[]:[];
   let control;
   if(privatePng && field.id==="productAssets")control=<input {...props} type="file" accept="image/png,.png" disabled={pending} onChange={(event)=>{setFile(event.currentTarget.files?.[0]??null);setRetryStep(null);}} />;
   else if(field.type==="checkbox")control=<input {...props} type="checkbox" checked={values[field.id]===true} onChange={(event)=>change(field.id,event.target.checked)} />;
   else if(["assets","characters","multiselect"].includes(field.type)){
    const options=field.type==="assets"?choices.assets.filter((asset)=>!field.accept||field.accept.includes(asset.kind as "image"|"video"|"audio"|"doc")).map((asset)=>({id:asset.id,label:asset.title})):field.type==="characters"?choices.characters.map((character)=>({id:character.id,label:`${character.name}${character.status!=="confirmed"?" · 확인 필요":""}`})):field.options?.map((value)=>({id:value,label:value}))??[];
    control=<select {...props} multiple value={selected} onChange={(event)=>change(field.id,Array.from(event.target.selectedOptions).map((option)=>option.value))}>{options.length?options.map((option)=><option key={option.id} value={option.id}>{option.label}</option>):<option disabled value="">선택할 자료가 없어요</option>}</select>;
   } else if(field.type==="select")control=<select {...props} value={String(values[field.id]??"")} onChange={(event)=>change(field.id,event.target.value)}><option value="">선택해 주세요</option>{field.options?.map((option)=><option key={option}>{option}</option>)}</select>;
   else if(field.type==="textarea")control=<textarea {...props} value={String(values[field.id]??"")} maxLength={field.maxLength} onChange={(event)=>change(field.id,event.target.value)} />;
   else control=<input {...props} type={field.type==="datetime"?"datetime-local":field.type==="number"?"number":field.type==="url"?"url":field.type==="date"?"date":"text"} min={field.min} max={field.max} maxLength={field.maxLength} value={String(values[field.id]??"")} onChange={(event)=>change(field.id,event.target.value)} />;
   return <div key={field.id} className="stack"><Field label={field.label} required={field.required} help={privatePng && field.id==="productAssets"?"1 MiB 이하 PNG 한 장":field.help} error={errors[field.id]}>{control}</Field>
    {privatePng && field.id==="productAssets" && <Field label="사진 출처·권리 메모" help="선택 사항 · 500자 이내"><textarea name="rightsNote" value={rightsNote} maxLength={500} disabled={pending} onChange={event=>{if(event.target.value.trim()!==rightsNote.trim())setRetryStep(null);setRightsNote(event.target.value);}} /></Field>}
    {!privatePng&&field.type==="assets"&&<p className="muted"><Link href="/library">자료·캐릭터 보관함</Link>에 등록한 자료를 선택해 주세요. 여러 개를 고를 수 있어요.</p>}</div>;
  })}</div></Card>
  {retryStep && <p id="project-retry-help" role="status">{retryStep==="upload"
   ?"선택한 사진이 그대로 있어요. 업로드를 다시 시도하면 사진을 확인한 뒤 프로젝트를 저장합니다."
   :"사진 업로드는 완료됐어요. 사진과 권리 메모를 유지하면 프로젝트 저장만 다시 시도합니다."}</p>}
  <Button type="submit" loading={pending} loadingLabel="저장 중" aria-describedby={retryStep?"project-retry-help":undefined}>
   {retryStep==="upload"?"사진 업로드 다시 시도":retryStep==="project"?"프로젝트 저장 다시 시도":"저장하고 시작"}
  </Button>
 </form>;
}
