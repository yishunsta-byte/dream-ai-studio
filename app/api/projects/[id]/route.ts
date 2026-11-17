import { createProjectReadRequest } from "@/lib/services/postgres/project-read-request";

export const runtime="nodejs";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
 const reads=createProjectReadRequest();
 const reply=await reads.get(async()=>(await context.params).id);
 return Response.json(reply.body,{status:reply.status,headers:reply.headers});
}
