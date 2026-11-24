import { createAppProjectReadRequest } from "@/lib/cloud/project-read-request";

export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
 const reads=createAppProjectReadRequest({cookieMode:"route",signal:request.signal}).open();
 const reply=await reads.get(async()=>(await context.params).id);
 return Response.json(reply.body,{status:reply.status,headers:reply.headers});
}
