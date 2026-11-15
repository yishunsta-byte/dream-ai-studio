"use client";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MenuSnapshot, ProjectInputErrors } from "@/lib/menus/inputs";
import { Button, Card, Callout } from "./ui/primitives";
import { Field, FormErrorSummary, useToast } from "./ui/interactive";

type Choices={assets:{id:string;title:string;kind:string}[];characters:{id:string;name:string;status:string}[]};
export function ProjectForm({ snapshot, choices }: {snapshot:MenuSnapshot;choices:Choices}) {
 const fields=useMemo(()=>[...snapshot.commonInputs,...snapshot.menu.inputs],[snapshot]);
 const [values,setValues]=useState<Record<string,unknown>>(()=>Object.fromEntries(fields.map((field)=>[field.id,field.type==="checkbox"?false:["assets","characters","multiselect"].includes(field.type)?[]:field.id==="aspect"?snapshot.menu.defaultAspect:field.id==="lengthSec"?snapshot.menu.defaultLengthSec:""])));
 const [errors,setErrors]=useState<ProjectInputErrors>({});
 const [pending,setPending]=useState(false);
 const router=useRouter();const notify=useToast();
 const summary=useMemo(()=>Object.entries(errors).map(([id,message])=>({id:id==="_form"?"project-form-error":`input-${id}`,label:fields.find((field)=>field.id===id)?.label??"입력 내용",message})),[errors,fields]);
 const change=(id:string,value:unknown)=>setValues((old)=>({...old,[id]:value}));
 async function submit(event:FormEvent) {
  event.preventDefault();if(pending)return;setPending(true);setErrors({});
  try {
   const response=await fetch("/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({menuId:snapshot.menu.id,inputs:values})});
   const result=await response.json();
   if(!response.ok){setErrors(result.errors??{_form:"저장하지 못했어요. 다시 시도해 주세요."});return;}
   notify({tone:"success",message:"프로젝트를 등록했어요."});router.push(`/projects/${result.id}/brief`);router.refresh();
  } catch {setErrors({_form:"저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."});}
  finally{setPending(false);}
 }
 return <form className="stack form-width" noValidate onSubmit={submit}><div id="project-form-error" tabIndex={-1}><FormErrorSummary errors={summary} /></div>
  <Callout title="확인한 내용만 등록해 주세요.">광고·협찬, 실사형 AI, 음악 항목을 선택하면 검수 항목이 추가돼요.</Callout>
  <Card><div className="stack">{fields.map((field)=>{
   const id=`input-${field.id}`;
   const props={id,name:field.id};
   const selected=Array.isArray(values[field.id]) ? values[field.id] as string[]:[];
   let control;
   if(field.type==="checkbox")control=<input {...props} type="checkbox" checked={values[field.id]===true} onChange={(event)=>change(field.id,event.target.checked)} />;
   else if(["assets","characters","multiselect"].includes(field.type)){
    const options=field.type==="assets"?choices.assets.filter((asset)=>!field.accept||field.accept.includes(asset.kind as "image"|"video"|"audio"|"doc")).map((asset)=>({id:asset.id,label:asset.title})):field.type==="characters"?choices.characters.map((character)=>({id:character.id,label:`${character.name}${character.status!=="confirmed"?" · 확인 필요":""}`})):field.options?.map((value)=>({id:value,label:value}))??[];
    control=<select {...props} multiple value={selected} onChange={(event)=>change(field.id,Array.from(event.target.selectedOptions).map((option)=>option.value))}>{options.length?options.map((option)=><option key={option.id} value={option.id}>{option.label}</option>):<option disabled value="">선택할 자료가 없어요</option>}</select>;
   } else if(field.type==="select")control=<select {...props} value={String(values[field.id]??"")} onChange={(event)=>change(field.id,event.target.value)}><option value="">선택해 주세요</option>{field.options?.map((option)=><option key={option}>{option}</option>)}</select>;
   else if(field.type==="textarea")control=<textarea {...props} value={String(values[field.id]??"")} maxLength={field.maxLength} onChange={(event)=>change(field.id,event.target.value)} />;
   else control=<input {...props} type={field.type==="datetime"?"datetime-local":field.type==="number"?"number":field.type==="url"?"url":field.type==="date"?"date":"text"} min={field.min} max={field.max} maxLength={field.maxLength} value={String(values[field.id]??"")} onChange={(event)=>change(field.id,event.target.value)} />;
   return <div key={field.id} className="stack"><Field label={field.label} required={field.required} help={field.help} error={errors[field.id]}>{control}</Field>{field.type==="assets"&&<p className="muted"><Link href="/library">자료·캐릭터 보관함</Link>에 등록한 자료를 선택해 주세요. 여러 개를 고를 수 있어요.</p>}</div>;
  })}</div></Card><Button type="submit" loading={pending} loadingLabel="저장 중">저장하고 시작</Button>
 </form>;
}
