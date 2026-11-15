import { PageHeader } from "@/components/ui/primitives";
import { JobsPanel } from "@/components/jobs-panel";
import { listJobs } from "@/lib/services/jobs";
export default function JobsPage() { return <><PageHeader title="작업 대기열" description="만들고 있는 작업과 결과를 여기서 살펴봐요." /><JobsPanel initial={listJobs()}/></>; }
