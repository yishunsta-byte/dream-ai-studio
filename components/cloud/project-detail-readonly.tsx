import Link from "next/link";
import { Card, PageHeader, StatusPill } from "@/components/ui/primitives";
import { STAGE_STATUS, type CloudProjectDetail } from "@/lib/cloud/project-read-page";
import { AdminProjectHeadingFocus } from "./admin-project-heading-focus";
import { CloudReadOnlyNote, readOnlyCapability, type CloudWorkspaceCapability } from "./project-list-readonly";

// 클라우드 읽기 전용 단건 개요(T-207). 단계 화면·편집·영상 만들기로 가는 링크는 두지 않는다.
// 예외(P1-02): 관리형 저장소에서 브리프가 확인 전이면 페이지가 넘겨 준 클라우드 브리프 확인 링크 하나만 보인다.
// 예외(P1-08): 관리형 기획에서 기획 단계가 열려 있으면 페이지가 넘겨 준 클라우드 기획 링크를 보인다.
const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));

export function ProjectDetailReadonly({ project, briefHref, planHref, scenesHref, capability = readOnlyCapability }: {
  project: CloudProjectDetail; briefHref?: string; planHref?: string; scenesHref?: string; capability?: CloudWorkspaceCapability;
}) {
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <div id="admin-project-heading">
      <PageHeader title={project.title} description={<CloudReadOnlyNote capability={capability} place="detail" />} />
      <AdminProjectHeadingFocus title={project.title} />
    </div>
    <Card>
      <h2>기본 정보</h2>
      <dl className="stack">
        <div><dt>분야</dt><dd>{project.menuLabel}</dd></div>
        <div><dt>화면 비율 · 길이</dt><dd>{project.aspect} · {project.lengthSec}초</dd></div>
        <div><dt>마지막 수정</dt><dd><time dateTime={project.updatedAt}>{time(project.updatedAt)}</time></dd></div>
      </dl>
    </Card>
    <Card>
      <h2>단계 상태</h2>
      <ol className="stack" aria-label="단계 상태">{project.stages.map((row) => <li key={row.stage}>
        {row.label} <StatusPill status={STAGE_STATUS[row.status].pill}>{STAGE_STATUS[row.status].label}</StatusPill>
      </li>)}</ol>
      {briefHref && <p><Link className="action-link" href={briefHref}>브리프 확인하기</Link></p>}
      {planHref && <p><Link className="action-link" href={planHref}>기획 보기</Link></p>}
      {scenesHref && <p><Link className="action-link" href={scenesHref}>장면 결과 보기</Link></p>}
    </Card>
  </>;
}

export function ProjectNotFoundReadonly() {
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="프로젝트를 찾을 수 없어요" description="주소가 맞는지 확인하거나 내 프로젝트 목록에서 다시 골라 주세요." />
  </>;
}
