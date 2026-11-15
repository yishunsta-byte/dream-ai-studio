import { z } from "zod";
import { archiveLibraryItem } from "@/lib/services/library";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
const input=z.strictObject({kind:z.enum(["asset","character"]),id:z.uuidv7(),archived:z.boolean().default(true)});
export async function POST(request:Request){try{const values=input.parse(await request.json());archiveLibraryItem(values.kind,values.id,values.archived);return Response.json({ok:true});}catch(error){return mediaErrorResponse(error);}}
