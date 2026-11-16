import { z } from "zod";
import { readRenders, renderErrorBody, requestRender } from "@/lib/services/renders";
export const runtime="nodejs";
// P2-4b render API (T-101 2.9). GET: the project's renders and the pre-check (blockers[]); POST {revision,timelineId}:
// pre-check + CAS → 202 {renderId, jobId, existing}. Errors: {error, code[, blockers]}.
const project=async(params:Promise<{id:string}>)=>{const {id}=await params;return z.uuidv7().safeParse(id).success?id:null;};
const failure=(error:unknown)=>{const {status,body}=renderErrorBody(error);return Response.json(body,{status});};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const id=await project(params);if(!id)return Response.json({error:"프로젝트를 찾을 수 없어요.",code:"NOT_FOUND"},{status:404});return Response.json({result:await readRenders(id)},{headers:{"cache-control":"private, no-store"}});}catch(error){return failure(error);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const id=await project(params);if(!id)return Response.json({error:"프로젝트를 찾을 수 없어요.",code:"NOT_FOUND"},{status:404});const result=await requestRender(id,await request.json());return Response.json({result},{status:202});}catch(error){return failure(error);}}
