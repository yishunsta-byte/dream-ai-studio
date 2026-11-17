import { redirect } from "next/navigation";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
export default async function ProjectPage({params}:{params:Promise<{id:string}>}){
 const blocked=await legacyPageGate();if(blocked)return blocked;const {id}=await params;redirect(`/projects/${id}/brief`);}
