import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { approveProjectPlan, confirmProjectBrief, saveProjectPlan, planningInputSchema } from "@/lib/services/planning";
export const runtime="nodejs";
const revision=z.number().int().positive();
const bodySchema=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("confirm-brief"),revision,acknowledged:z.boolean()}),
 z.strictObject({action:z.literal("save-plan"),revision,input:planningInputSchema}),
 z.strictObject({action:z.literal("approve-plan"),revision,planId:z.uuidv7()}),
]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"프로젝트를 찾을 수 없어요."},{status:404});
  const body=bodySchema.parse(await request.json());
  const result=body.action==="confirm-brief"?confirmProjectBrief(id,body.revision,body.acknowledged):body.action==="save-plan"?saveProjectPlan(id,body.revision,body.input):approveProjectPlan(id,body.planId,body.revision);
  return Response.json({result});
 }catch(error){
  if(error instanceof WorkflowError)return Response.json({error:error.message},{status:error.status});
  if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"대본과 각 장면의 제목·설명·길이를 확인해 주세요. 길이는 1~600초예요."},{status:400});
  return Response.json({error:"저장하지 못했어요. 시작 점검을 확인하고 다시 시도해 주세요."},{status:503});
 }
}
