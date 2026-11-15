import { EmptyState, Card, PageHeader } from "@/components/ui/primitives";
export default function JobsPage() { return <><PageHeader title="작업 대기열" description="만들고 있는 작업과 결과를 여기서 살펴봐요." /><Card><EmptyState icon="clock" title="아직 등록된 작업이 없어요" description="작업 처리 기능을 연결하면 대기·진행·실패 내역이 표시돼요." /></Card></>; }
