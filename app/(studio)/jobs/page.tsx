import Link from "next/link";
import { checkStartup } from "@/lib/services/startup";
import { Callout, PageHeader } from "@/components/ui/primitives";
import { JobsPanel } from "@/components/jobs-panel";
import { listJobs } from "@/lib/services/jobs";
export default function JobsPage() { if(!checkStartup().canStart)return <><PageHeader title="작업 대기열"/><Callout title="시작 점검이 필요해요." tone="warning"><Link href="/setup">시작 점검 확인</Link></Callout></>;return <><PageHeader title="작업 대기열" description="만들고 있는 작업과 결과를 여기서 살펴봐요." /><JobsPanel initial={listJobs()}/></>; }
