import { checkStartup } from "@/lib/services/startup";
import { SetupReport } from "@/components/setup-report";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";

export default async function SetupPage() {
 const blocked=await legacyPageGate();if(blocked)return blocked; return <SetupReport {...checkStartup()} />; }
