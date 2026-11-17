import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { createProject, ProjectInputError } from "@/lib/services/projects";
import { WorkflowError } from "@/lib/domain/stages";
export const runtime="nodejs";
const requestSchema=z.strictObject({menuId:z.string().min(1).max(80),inputs:z.record(z.string(),z.unknown())});
export async function POST(request:Request){
 const denied=await requireApiAuth();if(denied)return denied;

 let input:unknown;try{input=await request.json();}catch{return Response.json({errors:{_form:"입력 내용을 읽을 수 없어요."}},{status:400});}
 const result=requestSchema.safeParse(input);
 if(!result.success)return Response.json({errors:{_form:"입력 항목을 확인해 주세요."}},{status:400});
 try {return Response.json({id:createProject(result.data.menuId,result.data.inputs)},{status:201});}
 catch(error){
  if(error instanceof ProjectInputError)return Response.json({errors:error.errors},{status:400});
  if(error instanceof WorkflowError)return Response.json({errors:{_form:error.message}},{status:error.status});
  return Response.json({errors:{_form:"저장하지 못했어요. 시작 점검을 확인한 뒤 다시 시도해 주세요."}},{status:503});
 }
}
