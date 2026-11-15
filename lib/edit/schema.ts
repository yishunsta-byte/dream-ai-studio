import { z } from "zod";
export const textLayerSchema=z.strictObject({id:z.uuidv7(),kind:z.enum(["subtitle","hook","emphasis","title","ending","disclosure"]),content:z.string().trim().min(1).max(500),fontFamily:z.literal("Pretendard"),fontSize:z.number().int().min(18).max(120),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),position:z.enum(["top","middle","bottom"]),startSec:z.number().min(0).max(7200),endSec:z.number().positive().max(7200),locked:z.boolean()}).refine(layer=>layer.endSec>layer.startSec&&Number.isInteger(layer.startSec*1000)&&Number.isInteger(layer.endSec*1000),{message:"시작·끝 시간을 밀리초 단위로 확인해 주세요."});
export const editInputSchema=z.strictObject({sceneOrder:z.array(z.uuidv7()).min(1).max(100),layers:z.array(textLayerSchema).max(100)});
export const editSnapshotSchema=editInputSchema.extend({schema_version:z.literal(1),content_revision:z.number().int().positive(),created_at:z.iso.datetime()});
export type EditSnapshot=z.infer<typeof editSnapshotSchema>;
export type TextLayer=z.infer<typeof textLayerSchema>;
export type EditInput=z.infer<typeof editInputSchema>;
export const defaultTextColor="#FFFFFF";
export function requiredDisclosures(inputs:Record<string,unknown>){return [inputs.isAd===true?"광고":null,inputs.realisticAi===true?"AI 생성":null,inputs.virtualHumanEndorsement===true?"가상인물":null].filter((value):value is string=>!!value);}
export function srtText(layers:TextLayer[]){const time=(seconds:number)=>{const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,"0")}:${String(Math.floor(ms/60000)%60).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")},${String(ms%1000).padStart(3,"0")}`;};return layers.filter(layer=>layer.kind==="subtitle").sort((a,b)=>a.startSec-b.startSec).map((layer,index)=>`${index+1}\n${time(layer.startSec)} --> ${time(layer.endSec)}\n${layer.content}\n`).join("\n");}
