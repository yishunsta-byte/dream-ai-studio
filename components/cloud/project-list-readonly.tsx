import Link from "next/link";
import { Callout, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui/primitives";
import type { CloudProjectCard } from "@/lib/cloud/project-read-page";

// 클라우드 읽기 전용 목록(T-207). 서버 컴포넌트, 기존 primitives만 쓴다. 쓰기·단계·파일 화면 링크는 두지 않는다.
const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));

export function CloudReadOnlyNote() {
  return <p className="muted">클라우드에서는 지금 <strong>보기만</strong> 할 수 있어요. 만들기·수정은 아직 내 PC 작업실에서 해 주세요.</p>;
}

export function ProjectListReadonly({ projects }: { projects: readonly CloudProjectCard[] }) {
  return <>
    <PageHeader title="내 프로젝트" description={<CloudReadOnlyNote />} actions={<Link href="/cloud/projects/new">새 프로젝트 만들기 안내 →</Link>} />
    {!projects.length
      ? <Card><EmptyState title="아직 클라우드에 옮긴 프로젝트가 없어요" description="지금까지 만든 작품은 내 PC 작업실에 있어요. 클라우드로 옮기는 작업이 끝나면 여기에 보여요." /></Card>
      : <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="프로젝트 목록">{projects.map((project) => <li key={project.id}>
          <Card>
            <h2><Link href={`/cloud/projects/${project.id}`}>{project.title}</Link></h2>
            <p className="muted">{project.menuLabel} · {project.aspect} · {project.lengthSec}초</p>
            <p><StatusPill status={project.status} /> 다음 단계: {project.nextStageLabel}</p>
            <p className="muted">마지막 수정 <time dateTime={project.updatedAt}>{time(project.updatedAt)}</time></p>
          </Card>
        </li>)}</ul>}
  </>;
}

// 불러오기 실패 화면도 정상 화면과 같은 페이지 제목(h1) 하나를 둔다(T-214). 안내 문구·다시 시도 링크는 그대로다.
export function CloudReadUnavailable({ retryHref, title, back = false }: { retryHref: string; title: string; back?: boolean }) {
  return <>
    {back && <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>}
    <PageHeader title={title} description={<CloudReadOnlyNote />} />
    <Callout tone="warning" title="프로젝트를 불러오지 못했어요">잠시 뒤 다시 시도해 주세요. <Link href={retryHref}>다시 시도</Link></Callout>
  </>;
}

// 이 PC(로그인 꺼짐) 안내도 화면 맥락에 맞는 페이지 제목(h1) 하나를 둔다(T-217). 안내 문구·작업실 링크는 그대로다.
export function CloudReadLocal({ title }: { title: string }) {
  return <>
    <PageHeader title={title} />
    <Callout tone="info" title="이 PC에서는 기존 작업실을 써요">클라우드 보기 화면은 로그인한 클라우드 주소에서만 열려요. <Link href="/studio">작업실로 가기 →</Link></Callout>
  </>;
}
