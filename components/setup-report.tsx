import type { StartupCheck } from "@/lib/domain/startup";
import { Badge, Card, Callout, PageHeader, StatusPill } from "@/components/ui/primitives";

export function SetupReport({ checks, canStart }: { checks: StartupCheck[]; canStart: boolean }) {
  return <div className="stack"><PageHeader title="시작 점검" description="작업을 안전하게 저장할 수 있는지 살펴봐요." chips={<Badge>내 PC</Badge>} />
    <Callout tone={canStart ? "info" : "danger"} title={canStart ? "작업을 시작할 수 있어요." : "작업을 시작하기 전에 아래 항목을 확인해 주세요."}>{canStart ? "폴더와 저장 공간을 확인했어요." : "저장할 수 없는 폴더가 있어 작업실을 잠시 멈췄어요. 원인을 해결한 뒤 새로고침해 주세요."}</Callout>
    <div className="stack">{checks.map((check) => <Card key={check.id}><div className="cluster"><StatusPill status={check.status === "pass" ? "done" : check.status === "fail" ? "failed" : "warning"}>{check.status === "pass" ? "통과" : check.status === "fail" ? "실패" : "확인 필요"}</StatusPill><h2>{check.label}</h2></div><p>{check.message}</p></Card>)}</div>
    <p className="muted">실패한 항목의 원인을 해결한 뒤 화면을 새로고침해 주세요.</p>
  </div>;
}
