import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { changeProduction } from "@/lib/services/production";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { localProduction } from "@/lib/cloud/local-project-production";
export { localProduction as GET };
export const runtime="nodejs";
const revision=z.number().int().positive(),sceneId=z.uuidv7(),expectedVersionId=z.uuidv7().nullable();
const schema=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("select"),revision,sceneId,versionId:z.uuidv7(),expectedVersionId}),
 z.strictObject({action:z.literal("keep"),revision,sceneId,expectedVersionId}),
 z.strictObject({action:z.literal("complete"),revision}),z.strictObject({action:z.literal("missing"),revision}),
]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(localProjectFormEnabled())return localProduction(request,{params});
 const denied=await requireApiAuth();if(denied)return denied;
try{const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"프로젝트를 찾을 수 없어요."},{status:404});return Response.json({result:changeProduction({...schema.parse(await request.json()),projectId:id})});}catch(error){if(error instanceof WorkflowError)return Response.json({error:error.message},{status:error.status});if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"선택한 장면과 내용 버전을 확인해 주세요."},{status:400});return Response.json({error:"변경하지 못했어요. 시작 점검을 확인해 주세요."},{status:503});}}
