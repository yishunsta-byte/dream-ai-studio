import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { editInputSchema } from "@/lib/edit/schema";
import { saveEditing, completeEditing } from "@/lib/services/editing";
import { updateReview, approveReview, reviewInputSchema } from "@/lib/services/review";
import { requestExport } from "@/lib/services/exports";
export const runtime="nodejs";
const revision=z.number().int().positive();
const schema=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("save-edit"),revision,input:editInputSchema}),z.strictObject({action:z.literal("complete-edit"),revision}),
 z.strictObject({action:z.literal("review-item"),revision,input:reviewInputSchema}),z.strictObject({action:z.literal("approve-review"),revision}),z.strictObject({action:z.literal("export"),revision}),
]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"프로젝트를 찾을 수 없어요."},{status:404});const body=schema.parse(await request.json());const result=body.action==="save-edit"?saveEditing(id,body.revision,body.input):body.action==="complete-edit"?completeEditing(id,body.revision):body.action==="review-item"?updateReview(id,body.revision,body.input):body.action==="approve-review"?approveReview(id,body.revision):requestExport(id,body.revision);return Response.json({result},{status:body.action==="export"?202:200});}catch(error){if(error instanceof WorkflowError)return Response.json({error:error.message},{status:error.status});if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"문구와 시간, 보류 사유를 확인해 주세요."},{status:400});return Response.json({error:"저장하지 못했어요. 시작 점검을 확인해 주세요."},{status:503});}}
