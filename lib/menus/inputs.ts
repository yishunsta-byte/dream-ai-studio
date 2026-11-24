import { z } from "zod";
import type { z as Zod } from "zod";
import type { menuSnapshotSchema } from "./snapshot";

export type MenuSnapshot=Zod.infer<typeof menuSnapshotSchema>;
export type ProjectInputErrors=Record<string,string>;
export function validateProjectInputs(snapshot:MenuSnapshot,input:unknown) {
  const record=z.record(z.string(),z.unknown()).safeParse(input);
  if(!record.success)return {ok:false as const,errors:{_form:"입력 내용을 확인해 주세요."}};
  const fields=[...snapshot.commonInputs,...snapshot.menu.inputs];
  const errors:ProjectInputErrors={};
  const values:Record<string,unknown>={};
  if(Object.keys(record.data).some((key)=>!fields.some((field)=>field.id===key)))errors._form="이 분야에서 사용하지 않는 항목이 포함되어 있어요.";
  for(const field of fields) {
    let raw=record.data[field.id];
    if(raw===undefined || raw===null || raw==="") {
      if(field.type==="checkbox")raw=false;
      else if(["assets","characters","multiselect"].includes(field.type))raw=[];
      else if(field.type==="select" && field.default!==undefined)raw=field.default;
      else if(!field.required)continue;
    }
    let rule:z.ZodType;
    if(field.type==="number") {
      if(typeof raw==="string" && /^-?\d+(\.\d+)?$/.test(raw.trim()))raw=Number(raw);
      let number=z.number().finite().int();
      if(field.min!==undefined)number=number.min(field.min);
      if(field.max!==undefined)number=number.max(field.max);
      const options=field.id==="lengthSec"?snapshot.menu.lengthOptions:undefined;
      rule=options?number.refine((sec)=>options.includes(sec)):number;
    } else if(field.type==="checkbox")rule=field.required ? z.literal(true):z.boolean();
    else if(["assets","characters","multiselect"].includes(field.type)) {
      let array=z.array(field.type==="multiselect" ? z.string().refine((item)=>!!field.options?.includes(item)):z.uuidv7());
      if(field.required)array=array.min(Math.max(1,field.min??1));
      if(field.max!==undefined)array=array.max(field.max);
      rule=array.max(100).refine((items)=>new Set(items).size===items.length);
    } else {
      let string=z.string().trim();
      if(field.required)string=string.min(1);
      if(field.maxLength)string=string.max(field.maxLength);
      rule=string;
      if(field.type==="select")rule=string.refine((item)=>!!field.options?.includes(item));
      if(field.type==="url")rule=string.refine((item)=>{try{const url=new URL(item);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}});
      if(field.type==="date")rule=z.iso.date();
      if(field.type==="datetime")rule=z.iso.datetime({local:true,precision:-1});
    }
    const result=rule.safeParse(raw);
    if(!result.success)errors[field.id]=`${field.label} 항목의 ${field.type==="number" ? "숫자와 허용 범위를" : field.type==="url" ? "웹 주소를" : "필수 값과 형식을"} 확인해 주세요.`;
    else values[field.id]=result.data;
  }
  // 핵심 메시지 글자 수 선택(주제별 쇼츠): 고른 상한까지 허용하고 넘으면 거부한다. 길이 계산은 위 maxLength와 같은 방식(앞뒤 공백 제거 뒤 길이)이다.
  const messageLimit=values.keyMessageLength, message=values.keyMessage;
  if(typeof messageLimit==="string" && typeof message==="string" && message.length>Number(messageLimit)) {
    errors.keyMessage=`${fields.find((field)=>field.id==="keyMessage")?.label ?? "핵심 메시지"} 항목의 필수 값과 형식을 확인해 주세요.`;
  }
  return Object.keys(errors).length ? {ok:false as const,errors}:{ok:true as const,values};
}
