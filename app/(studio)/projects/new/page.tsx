import { redirect } from "next/navigation";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
export default async function NewProjectAlias(){
 const blocked=await legacyPageGate();if(blocked)return blocked;redirect("/menus/shopping-shorts/new");}
