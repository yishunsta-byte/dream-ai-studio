import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { enqueueGeneration, listJobs, updateJob } from "@/lib/services/jobs";
export const runtime="nodejs";
export function GET(){return Response.json(listJobs(),{headers:{"cache-control":"no-store"}});}
const actionSchema=z.strictObject({id:z.uuidv7(),action:z.enum(["cancel","retry"])});
export async function POST(request:Request){try{return Response.json(enqueueGeneration(await request.json()),{status:202});}catch(error){return failure(error);}}
export async function PATCH(request:Request){try{const body=actionSchema.parse(await request.json());updateJob(body.id,body.action);return Response.json({ok:true});}catch(error){return failure(error);}}
function failure(error:unknown){if(error instanceof WorkflowError)return Response.json({error:error.message},{status:error.status});if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"작업 입력을 확인해 주세요."},{status:400});return Response.json({error:"작업을 저장하지 못했어요. 시작 점검을 확인해 주세요."},{status:503});}
