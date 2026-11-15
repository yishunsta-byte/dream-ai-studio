import "server-only";
import { z } from "zod";
import { v7 } from "uuid";
import { withDatabase } from "@/lib/db/server";
import type { DatabaseHandle } from "@/lib/db/connection";
import { decodeJson, encodeJson, jsonObject } from "@/lib/db/json";
import { libraryRepository } from "@/lib/repo/library";
import { receiveUpload, uploadLimit } from "@/lib/storage/upload";
import { storedFileExists } from "@/lib/storage/paths";
import { MediaError } from "@/lib/media/inspect";
import { checkStartup } from "./startup";

const note=z.string().trim().max(500);
const url=z.string().trim().url().refine((value)=>{const parsed=new URL(value);return ["https:","http:"].includes(parsed.protocol)&&!parsed.username&&!parsed.password;});
const linkSchema=z.strictObject({title:z.string().trim().min(1).max(255),sourceUrl:url,rightsNote:note.optional()});
const lock=z.strictObject({locked:z.boolean(),note:z.string().trim().max(500)});
export const characterLocks=z.strictObject({face:lock,outfit:lock,hair:lock,accessories:lock,body:lock,voice:lock});
const references=z.array(z.uuidv7()).max(20).refine((ids)=>new Set(ids).size===ids.length);
const characterSchema=z.strictObject({name:z.string().trim().min(1).max(80),description:z.string().trim().min(1).max(1000),locked:characterLocks,refAssetIds:references,voiceNote:note.optional(),confirmed:z.boolean()}).refine((value)=>!value.confirmed||value.refAssetIds.length>0);
function assertReady(){if(!checkStartup().canStart)throw new MediaError("STARTUP_FAILED","시작 점검의 실패 항목을 해결한 뒤 다시 시도해 주세요.",503);}
export function libraryService(handle:DatabaseHandle) {
 const repo=libraryRepository(handle);
 const atomic=<T>(action:()=>T)=>handle.sqlite.transaction(action).immediate();
 return {
  list:()=>({maxUploadBytes:uploadLimit(),assets:repo.assets(true).map((asset)=>({id:asset.id,title:asset.title,kind:asset.kind,mime:asset.mime,sizeBytes:asset.sizeBytes,width:asset.width,height:asset.height,durationMs:asset.durationMs,isMock:asset.isMock,role:asset.role,sourceUrl:asset.sourceUrl&&url.safeParse(asset.sourceUrl).success?asset.sourceUrl:null,rightsNote:asset.rightsNote,archived:!!asset.archivedAt,usageCount:repo.assetUsage(asset.id)})),characters:repo.characters(true).map((character)=>({id:character.id,name:character.name,description:character.description,status:character.status,locked:decodeJson(characterLocks,character.lockedJson),refAssetIds:decodeJson(references,character.refAssetIdsJson),archived:!!character.archivedAt,usageCount:repo.characterUsage(character.id)}))}),
  asset:(id:string)=>{if(!z.uuidv7().safeParse(id).success)throw new MediaError("NOT_FOUND","자료를 찾을 수 없어요.",404);const asset=repo.asset(id);if(!asset)throw new MediaError("NOT_FOUND","자료를 찾을 수 없어요.",404);return asset;},
  link:(input:unknown)=>atomic(()=>{
    const values=linkSchema.parse(input);const id=v7();repo.insertAsset({id,kind:"link",role:"original",origin:"link",...values});repo.log("asset.link",encodeJson(jsonObject,{assetId:id}));return id;
  }),
  character:(input:unknown)=>atomic(()=>{
    const values=characterSchema.parse(input);
    for(const id of values.refAssetIds){const asset=repo.asset(id);if(!asset||asset.archivedAt||!["image","video"].includes(asset.kind)||!storedFileExists(asset.filePath))throw new MediaError("INVALID_REFERENCE","사용할 참조 이미지나 영상을 다시 선택해 주세요.");}
    const id=v7();repo.insertCharacter({id,name:values.name,description:values.description,lockedJson:encodeJson(characterLocks,values.locked),refAssetIdsJson:encodeJson(references,values.refAssetIds),voiceProfileJson:encodeJson(jsonObject,{note:values.voiceNote??""}),status:values.confirmed?"confirmed":"unconfirmed"});repo.log("character.create",encodeJson(jsonObject,{characterId:id,status:values.confirmed?"confirmed":"unconfirmed"}));return id;
  }),
  archive:(kind:"asset"|"character",id:string,archived=true)=>atomic(()=>{
    if(!z.uuidv7().safeParse(id).success)throw new MediaError("NOT_FOUND","자료를 찾을 수 없어요.",404);
    if(kind==="asset"){if(!repo.asset(id))throw new MediaError("NOT_FOUND","자료를 찾을 수 없어요.",404);repo.archiveAsset(id,archived);}else{if(!repo.character(id))throw new MediaError("NOT_FOUND","캐릭터를 찾을 수 없어요.",404);repo.archiveCharacter(id,archived);}
    repo.log(`${kind}.${archived?"archive":"restore"}`,encodeJson(jsonObject,{id}));
  }),
 };
}
export function readLibrary(){return withDatabase((handle)=>libraryService(handle).list());}
export function readAsset(id:string){return withDatabase((handle)=>libraryService(handle).asset(id));}
export async function uploadAsset(body:ReadableStream<Uint8Array>,filename:string,rightsNote:unknown,signal?:AbortSignal){
 assertReady();const rights=note.parse(rightsNote??"");
 return receiveUpload(body,filename,(data)=>withDatabase((handle)=>handle.sqlite.transaction(()=>{
  const repo=libraryRepository(handle);
  repo.insertAsset({id:data.id,title:data.title,filePath:data.filePath,sizeBytes:data.sizeBytes,sha256:data.sha256,kind:data.kind,mime:data.mime,width:data.width,height:data.height,durationMs:data.durationMs,role:"original",origin:"upload",rightsNote:rights||null,isMock:false});
  repo.log("asset.upload",encodeJson(jsonObject,{assetId:data.id,kind:data.kind,sizeBytes:data.sizeBytes,sha256:data.sha256}));
 }).immediate()),signal);
}
export function registerLink(input:unknown){assertReady();return withDatabase((handle)=>libraryService(handle).link(input));}
export function registerCharacter(input:unknown){assertReady();return withDatabase((handle)=>libraryService(handle).character(input));}
export function archiveLibraryItem(kind:"asset"|"character",id:string,archived=true){assertReady();return withDatabase((handle)=>libraryService(handle).archive(kind,id,archived));}
export type LibraryData=ReturnType<typeof readLibrary>;
