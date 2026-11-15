import { z } from "zod";
import { finishRestore } from "@/lib/services/restore";
import { WorkflowError } from "@/lib/domain/stages";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
const schema=z.strictObject({ticketId:z.uuidv7()});
export async function POST(request:Request){try{const body=schema.parse(await request.json());return Response.json(await finishRestore(body.ticketId),{headers:{"cache-control":"no-store"}});}catch(error){if(error instanceof WorkflowError)return Response.json({error:error.message,code:error.code},{status:error.status});return mediaErrorResponse(error);}}
