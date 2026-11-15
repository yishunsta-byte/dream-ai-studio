import { checkStartup } from "@/lib/services/startup";
import { SetupReport } from "@/components/setup-report";

export default function SetupPage() { return <SetupReport {...checkStartup()} />; }
