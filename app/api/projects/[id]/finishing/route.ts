import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { completeEditing } from "@/lib/services/editing";
import { updateReview, approveReview, reviewInputSchema } from "@/lib/services/review";
import { requestExport } from "@/lib/services/exports";
export const runtime="nodejs";
const revision=z.number().int().positive();
const schema=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("complete-edit"),revision}),
 z.strictObject({action:z.literal("review-item"),revision,input:reviewInputSchema}),z.strictObject({action:z.literal("approve-review"),revision}),z.strictObject({action:z.literal("export"),revision}),
]);
// T-061 D3: the edit screen saves through /api/projects/[id]/timeline. The old P1 save is gone (410) so an old open
// tab cannot write a P1 snapshot the timeline would not see.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireApiAuth();if(denied)return denied;
try{const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"프로젝트를 찾을 수 없어요."},{status:404});const raw:unknown=await request.json();if(raw&&typeof raw==="object"&&(raw as {action?:unknown}).action==="save-edit")return Response.json({error:"글자 저장 방식이 바뀌었어요. 화면을 새로고침한 뒤 다시 저장해 주세요."},{status:410});const body=schema.parse(raw);const result=body.action==="complete-edit"?completeEditing(id,body.revision):body.action==="review-item"?updateReview(id,body.revision,body.input):body.action==="approve-review"?approveReview(id,body.revision):requestExport(id,body.revision);return Response.json({result},{status:body.action==="export"?202:200});}catch(error){if(error instanceof WorkflowError)return Response.json({error:error.message},{status:error.status});if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"문구와 시간, 보류 사유를 확인해 주세요."},{status:400});return Response.json({error:"저장하지 못했어요. 시작 점검을 확인해 주세요."},{status:503});}}
