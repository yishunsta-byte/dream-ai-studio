import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { readTimeline, restoreTimeline, saveTimeline } from "@/lib/services/timeline";
export const runtime="nodejs";
// P2-1 timeline API (T-060 4장). GET reads only; POST saves or restores explicitly with the content revision and the
// timeline id the screen was showing (CAS). Errors use the finishing route's shape.
const revision=z.number().int().positive(),timelineId=z.uuid().nullable();
const schema=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("save"),revision,timelineId,timeline:z.unknown()}),
 z.strictObject({action:z.literal("restore"),revision,timelineId,fromId:z.uuid()}),
]);
function failure(error:unknown){if(error instanceof WorkflowError)return Response.json({error:error.message},{status:error.status});if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"타임라인 값을 확인해 주세요."},{status:400});return Response.json({error:"타임라인을 처리하지 못했어요. 시작 점검을 확인해 주세요."},{status:503});}
async function project(params:Promise<{id:string}>){const {id}=await params;return z.uuidv7().safeParse(id).success?id:null;}
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireApiAuth();if(denied)return denied;
try{const id=await project(params);if(!id)return Response.json({error:"프로젝트를 찾을 수 없어요."},{status:404});const data=readTimeline(id);return Response.json({result:{current:data.current,timeline:data.timeline,clips:data.clips,stale:data.stale,warnings:data.warnings,history:data.history}});}catch(error){return failure(error);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireApiAuth();if(denied)return denied;
try{const id=await project(params);if(!id)return Response.json({error:"프로젝트를 찾을 수 없어요."},{status:404});const body=schema.parse(await request.json());const result=body.action==="save"?saveTimeline(id,body.revision,body.timelineId,body.timeline):restoreTimeline(id,body.revision,body.timelineId,body.fromId);return Response.json({result});}catch(error){return failure(error);}}
