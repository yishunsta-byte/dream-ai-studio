import Link from "next/link";
import { Callout, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui/primitives";
import type { CloudProjectCard } from "@/lib/cloud/project-read-page";
import menusJson from "@/docs/spec/menus.json";
import { parseMenuConfig } from "@/lib/menus/parse";
import { activeManagedMenus, managedMenuName } from "./managed-project-requests";

// 클라우드 읽기 전용 목록(T-207). 서버 컴포넌트, 기존 primitives만 쓴다. 쓰기·단계·파일 화면 링크는 두지 않는다.
const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));

/**
 * P2-MANAGED-WORKSPACE-CAPABILITY-COPY: 안내 문구가 실제로 열리는 화면과 맞도록, 화면이 열리는 조건만 본다.
 * - create: /cloud/projects/new가 생성 폼을 여는 조건과 같다(DREAM_PROJECT_CORE_BACKEND 지정 + 정적 메뉴 설정의 관리형 분야 하나 이상 active).
 * - plan: 기획 화면·상세 기획 링크가 여는 조건과 같다(DREAM_PROJECT_PLAN_BACKEND 지정).
 * - scenes: 장면 결과 화면(/cloud/projects/:id/scenes)이 패널을 여는 조건과 같다(DREAM_SCENE_READ_BACKEND 지정). 꺼져 있으면 없음.
 *   register·select는 그 화면이 등록·선택 단추를 주는 조건과 하나씩 같다(등록 = DREAM_SCENE_RESULT_BACKEND + DREAM_PROJECT_CORE_BACKEND,
 *   선택 = DREAM_SCENE_SELECT_BACKEND). 둘 중 하나만 열리면 그 하나만 말한다(P2-MANAGED-UI-SCENE-CAPABILITY-COPY).
 * 환경값과 묶인 정적 메뉴 설정만 읽는다(DB·네트워크 요청 없음). 그래서 '연결됨'이 아니라 '이 화면을 쓸 수 있음'만 뜻한다.
 * 장면 새로 만들기·편집·렌더는 클라우드에서 아직 열리지 않는다(기획 승인 응답 hostedProductionAvailable=false).
 */
export type CloudSceneCapability = { register: boolean; select: boolean };
export type CloudWorkspaceCapability = { create: boolean; plan: boolean; scenes?: CloudSceneCapability };
export const readOnlyCapability: CloudWorkspaceCapability = { create: false, plan: false };
export function cloudWorkspaceCapability(env: Readonly<Record<string, string | undefined>> = process.env): CloudWorkspaceCapability {
  const config = env.DREAM_PROJECT_CORE_BACKEND !== undefined ? parseMenuConfig(JSON.stringify(menusJson)) : undefined;
  const create = !!config?.ok && activeManagedMenus(config.config.menus).length > 0;
  const scenes = env.DREAM_SCENE_READ_BACKEND === undefined ? undefined : {
    register: env.DREAM_SCENE_RESULT_BACKEND !== undefined && env.DREAM_PROJECT_CORE_BACKEND !== undefined,
    select: env.DREAM_SCENE_SELECT_BACKEND !== undefined,
  };
  return { create, plan: env.DREAM_PROJECT_PLAN_BACKEND !== undefined, ...(scenes ? { scenes } : {}) };
}
/** 새 프로젝트로 만들 수 있는 분야 이름(정적 설정만 읽음). 예: "쇼핑숏츠", "쇼핑숏츠·주제별 쇼츠". */
function createKinds() {
  const config = parseMenuConfig(JSON.stringify(menusJson));
  const names = config.ok ? activeManagedMenus(config.config.menus).map(item => managedMenuName(item.id)) : [];
  return names.length ? names.join("·") : "쇼핑숏츠";
}
const managed = (capability: CloudWorkspaceCapability) => capability.create || capability.plan || capability.scenes !== undefined;
/** 장면 결과 화면에서 할 수 있는 일. 열린 단추만 말하고, 실제 등록·선택은 프로젝트 상태·권한·확인된 자료 조건을 따르므로 장면 화면에서 확인하게 한다. */
function sceneSentence({ register, select }: CloudSceneCapability) {
  const work = register && select ? "결과를 보고, 확인된 내 자료를 결과로 등록하거나 쓸 결과를 고를 수 있어요"
    : register ? "결과를 보고, 확인된 내 자료를 결과로 등록할 수 있어요"
    : select ? "결과를 보고 쓸 결과를 고를 수 있어요"
    : "이미 있는 결과를 볼 수 있어요";
  const action = register && select ? "등록·선택" : register ? "등록" : select ? "선택" : "";
  return `기획이 승인된 프로젝트는 장면 결과 화면에서 ${work}.${action ? ` ${action} 가능 여부는 장면 화면에서 확인해 주세요.` : ""}`;
}

/** 목록(list)·상세(detail) 머리 안내. 관리형 화면이 하나도 열리지 않으면 예전 '보기만' 안내 그대로다. */
export function CloudReadOnlyNote({ capability = readOnlyCapability, place = "list" }: { capability?: CloudWorkspaceCapability; place?: "list" | "detail" }) {
  if (!managed(capability))
    return <p className="muted">클라우드에서는 지금 <strong>보기만</strong> 할 수 있어요. 만들기·수정은 아직 내 PC 작업실에서 해 주세요.</p>;
  // 배정 2: 기획 승인은 별도 승인 구성·권한·저장 초안 조건을 따르므로(plan API approvalSelected·canApprove) 여기서 약속하지 않는다.
  const approval = capability.plan ? " 기획 승인 가능 여부는 기획 화면에서 확인해 주세요." : "";
  // 장면 결과 화면이 열리면 그 화면의 일을 말하고, 클라우드에 없는 일은 '장면 새로 만들기·편집·렌더'로 좁힌다. 꺼져 있으면 예전 문구 그대로다.
  const scenes = capability.scenes ? ` ${sceneSentence(capability.scenes)}` : "";
  const making = capability.scenes ? "장면 새로 만들기·편집·렌더는" : "장면 제작·렌더는";
  if (!capability.create && !capability.plan)
    return <p className="muted">클라우드에서 {sceneSentence(capability.scenes!)} 만들기·기획과 {making} 아직 내 PC 작업실에서 해 주세요.</p>;
  if (!capability.create)
    return <p className="muted">클라우드에서는 브리프가 승인된 프로젝트의 기획 초안을 확인·작성할 수 있어요.{approval}{scenes} 만들기와 {making} 아직 내 PC 작업실에서 해 주세요.</p>;
  const reach = capability.plan ? "브리프 확인과 기획 초안 작성까지" : "브리프 확인까지";
  const later = capability.plan ? making : `기획·${making}`;
  return <p className="muted">{place === "list" ? `클라우드에서 새 ${createKinds()} 프로젝트를 만들고 ${reach} 할 수 있어요.` : `클라우드에서는 ${reach} 할 수 있어요.`}
    {approval}{scenes}{" "}{later} 아직 내 PC 작업실에서 해 주세요.</p>;
}

export function ProjectListReadonly({ projects, capability = readOnlyCapability }: { projects: readonly CloudProjectCard[]; capability?: CloudWorkspaceCapability }) {
  return <>
    <PageHeader title="내 프로젝트" description={<CloudReadOnlyNote capability={capability} />}
      actions={<Link href="/cloud/projects/new">{capability.create ? "새 프로젝트 만들기 →" : "새 프로젝트 만들기 안내 →"}</Link>} />
    {!projects.length
      ? <Card>{capability.create
        ? <EmptyState title="아직 클라우드 프로젝트가 없어요" description={`‘새 프로젝트 만들기’로 ${createKinds()} 프로젝트를 시작할 수 있어요. 내 PC 작업실의 작품은 클라우드로 옮기는 작업이 끝나면 여기에 보여요.`} />
        : <EmptyState title="아직 클라우드에 옮긴 프로젝트가 없어요" description="지금까지 만든 작품은 내 PC 작업실에 있어요. 클라우드로 옮기는 작업이 끝나면 여기에 보여요." />}</Card>
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
// 관리형 화면이 열린 설정에서는 불러오기 실패 중에 '할 수 있어요'를 말하지 않도록 머리 안내를 비운다(실패 안내·다시 시도는 그대로).
export function CloudReadUnavailable({ retryHref, title, back = false, capability = readOnlyCapability }: { retryHref: string; title: string; back?: boolean; capability?: CloudWorkspaceCapability }) {
  return <>
    {back && <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>}
    <PageHeader title={title} description={managed(capability) ? undefined : <CloudReadOnlyNote />} />
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
