import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { finishRestore, restoreTicketStatus } from "@/lib/services/restore";
import { canRetrySameTicket } from "@/lib/backup/restore-retry";
import { WorkflowError } from "@/lib/domain/stages";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
const schema=z.strictObject({ticketId:z.uuidv7()});
// A failed finish also reports the ticket's real state so the screen knows whether the same ticket can be confirmed again.
export async function POST(request:Request){
 const denied=await requireApiAuth();if(denied)return denied;
let ticketId:string|undefined;try{const body=schema.parse(await request.json());ticketId=body.ticketId;return Response.json(await finishRestore(body.ticketId),{headers:{"cache-control":"no-store"}});}catch(error){const response=error instanceof WorkflowError?Response.json({error:error.message,code:error.code},{status:error.status}):mediaErrorResponse(error);if(!ticketId)return response;const ticketStatus=await restoreTicketStatus(ticketId);return Response.json({...await response.json(),ticketStatus,retryable:canRetrySameTicket(ticketStatus)},{status:response.status,headers:{"cache-control":"no-store"}});}}
