import { z } from "zod";
import { configureBackupDirectory } from "@/lib/services/backups";
import { WorkflowError } from "@/lib/domain/stages";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
const schema=z.strictObject({directory:z.string().trim().min(1).max(4096)});
export async function PATCH(request:Request){try{const body=schema.parse(await request.json());return Response.json(await configureBackupDirectory(body.directory),{headers:{"cache-control":"no-store"}});}catch(error){if(error instanceof WorkflowError)return Response.json({error:error.message,code:error.code},{status:error.status});return mediaErrorResponse(error);}}
