import { redirect } from "next/navigation";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
export default async function QueueAlias() {
 const blocked=await legacyPageGate();if(blocked)return blocked; redirect("/jobs"); }
