import { z } from "zod";
import { readBackups, requestBackup } from "@/lib/services/backups";
import { listJobs } from "@/lib/services/jobs";
import { checkStartup } from "@/lib/services/startup";
import { WorkflowError } from "@/lib/domain/stages";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function failure(error:unknown){if(error instanceof WorkflowError)return Response.json({error:error.message,code:error.code},{status:error.status});return mediaErrorResponse(error);}
export function GET(){try{if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을확인해 주세요.",503);return Response.json({...readBackups(),workerOnline:listJobs().workerOnline},{headers:{"cache-control":"no-store"}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{z.strictObject({}).parse(await request.json());return Response.json(requestBackup(),{status:202,headers:{"cache-control":"no-store"}});}catch(error){return failure(error);}}
