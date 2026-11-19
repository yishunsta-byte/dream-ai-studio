import Link from "next/link";
import { Card, PageHeader, StatusPill } from "@/components/ui/primitives";
import { STAGE_STATUS, type CloudProjectDetail } from "@/lib/cloud/project-read-page";
import { AdminProjectHeadingFocus } from "./admin-project-heading-focus";
import { CloudReadOnlyNote } from "./project-list-readonly";

// 클라우드 읽기 전용 단건 개요(T-207). 단계 화면·편집·영상 만들기로 가는 링크는 두지 않는다.
const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));

export function ProjectDetailReadonly({ project }: { project: CloudProjectDetail }) {
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <div id="admin-project-heading">
      <PageHeader title={project.title} description={<CloudReadOnlyNote />} />
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
    </Card>
  </>;
}

export function ProjectNotFoundReadonly() {
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="프로젝트를 찾을 수 없어요" description="주소가 맞는지 확인하거나 내 프로젝트 목록에서 다시 골라 주세요." />
  </>;
}
