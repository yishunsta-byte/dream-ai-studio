const operating = "https://dream-ai-studio-orpin.vercel.app/admin";
const views = {
  overview: { label: "개요", icon: "⌂" },
  projects: {
    label: "내 프로젝트", icon: "▱", hash: "admin-project-list", tag: "PROJECTS",
    description: "로그인한 계정의 프로젝트를 찾고 상세 작업 화면으로 이동합니다.",
    actions: ["클라우드 프로젝트 목록 확인", "프로젝트 이름과 현재 단계 확인", "프로젝트 상세 화면 열기"],
  },
  review: {
    label: "완성본 검수·게시", icon: "✓", hash: "admin-review", tag: "REVIEW",
    description: "완성본의 검수 화면과 게시 연결 상태를 확인합니다.",
    actions: ["완성본 검수 목록 열기", "게시 연결 상태 확인", "공개된 분석 결과는 콘텐츠 분석 메뉴에서 관리"],
  },
  analysis: {
    label: "콘텐츠 분석·공개", icon: "✦", hash: "admin-reference-analysis", tag: "SPECTRUM LAB",
    description: "이미지·음악·영상을 분석하고 관찰 근거, 생성 프롬프트, 공개 초안을 확인합니다.",
    actions: ["URL 주소 또는 파일 업로드 선택", "권리 확인하고 분석", "관찰 근거와 생성 프롬프트 검토", "별도 공개 동의 후 결과 공개 및 철회"],
  },
  api: {
    label: "API 연동", icon: "⌁", hash: "admin-api-integrations", tag: "API INTEGRATIONS",
    description: "분석 엔드포인트와 공개 목록 조회 응답을 확인합니다.",
    actions: ["미디어 분석 POST 경로 확인", "공개 목록 GET 읽기 확인", "오류가 발생한 연결 구분"],
  },
  queue: {
    label: "렌더 대기열", icon: "≋", hash: "admin-render-queue", tag: "RENDER QUEUE",
    description: "본인 렌더 작업의 목록을 조회하고 연결 오류가 있으면 화면에서 다시 확인합니다.",
    actions: ["렌더 작업 대기열 열기", "렌더 대기열 다시 조회", "조회 가능 여부와 오류 문구 확인"],
  },
  account: {
    label: "계정 설정", icon: "◎", hash: "admin-account", tag: "ACCOUNT",
    description: "현재 로그인 계정과 비밀번호 변경 메뉴를 확인합니다.",
    actions: ["로그인한 관리자 계정 확인", "비밀번호 바꾸기"],
  },
};

const variants = {
  production: {
    name: "1안 / 라이브 프로덕션", headline: "제작 운영실", description: "프로젝트부터 분석, 검수와 렌더 조회까지 필요한 작업을 한 곳에서 시작하세요.",
    figure: "제작 콘솔 이미지 예시", workspace: "미디어 분석 작업대", feature: "스펙트럼 랩",
    featureDescription: "이미지·음악·영상의 관찰 근거를 확인하고 생성 프롬프트를 검토합니다.", workCaption: "영상·이미지 예시",
    order: ["analysis", "projects", "queue"],
  },
  signal: {
    name: "2안 / 시그널 컨트롤", headline: "신호와 작업을 확인하는 운영실", description: "분석 입력과 연결 상태를 살펴보고 진행 중인 운영 작업으로 이동하세요.",
    figure: "오디오 파형 예시", workspace: "분석·검수 작업대", feature: "근거와 생성 프롬프트",
    featureDescription: "시간 구간, 이미지 영역, 프레임 근거를 기준으로 분석 결과를 읽습니다.", workCaption: "측정 화면 예시",
    order: ["analysis", "api", "queue"],
  },
  gallery: {
    name: "3안 / 크리에이터 갤러리", headline: "크리에이터 운영 데스크", description: "작품을 살피고 분석 결과를 검토해 공개까지 이어가세요.",
    figure: "콘텐츠 포스터 예시", workspace: "콘텐츠 작업대", feature: "분석한 결과를 공개로",
    featureDescription: "분석한 소스의 근거와 초안을 확인한 뒤 공유할 내용을 정리합니다.", workCaption: "공개 작업 예시",
    order: ["projects", "analysis", "review"],
  },
};

const toolDescription = {
  analysis: "이미지·음악·영상 분석과 공개",
  projects: "계정 프로젝트 목록과 상세",
  queue: "내 렌더 작업 목록 다시 조회",
  review: "완성본 검수와 게시 연결",
  api: "분석 경로와 공개 목록 응답",
};
const operations = [
  { label: "콘텐츠 분석", status: "분석 기능", target: "analysis", tone: "active" },
  { label: "공개 분석 결과", status: "공개 목록", target: "review", tone: "active" },
  { label: "렌더 대기열", status: "연결 확인", target: "queue", tone: "check" },
];
const element = id => document.getElementById(id);
const key = new URLSearchParams(location.search).get("view");
const variantKey = Object.hasOwn(variants, key) ? key : "production";
const variant = variants[variantKey];

document.body.dataset.view = variantKey;
document.title = `${variant.name} · DREAM SCREEN`;
for (const [id, value] of Object.entries({
  "variant-title": variant.name, "dashboard-title": variant.headline, "variant-description": variant.description,
  "figure-caption": variant.figure, "workbench-heading": variant.workspace, "work-title": variant.feature,
  "work-description": variant.featureDescription, "work-caption": variant.workCaption,
})) element(id).textContent = value;

function anchor(target, label, className) {
  const link = document.createElement("a");
  link.href = `#${target}`;
  link.textContent = label;
  if (className) link.className = className;
  return link;
}

for (const [id, view] of Object.entries(views)) {
  const link = anchor(id, view.label);
  const icon = document.createElement("span");
  icon.textContent = view.icon;
  icon.setAttribute("aria-hidden", "true");
  link.prepend(icon);
  element("navigation").append(link);
}

for (const id of variant.order) {
  const link = anchor(id, "", "tool-card");
  const icon = document.createElement("span");
  const heading = document.createElement("strong");
  const description = document.createElement("span");
  link.dataset.tool = id;
  icon.className = "tool-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = views[id].icon;
  heading.textContent = views[id].label;
  description.className = "tool-description";
  description.textContent = toolDescription[id];
  link.append(icon, heading, description);
  element("tool-grid").append(link);
}

for (const item of operations) {
  const row = document.createElement("li");
  const label = item.label === "공개 분석 결과" ? document.createElement("a") : anchor(item.target, item.label);
  if (!label.hasAttribute("href")) {
    label.href = "https://dream-ai-studio-orpin.vercel.app/analysis-results";
    label.textContent = item.label;
    label.target = "_blank";
    label.rel = "noopener";
  }
  const status = document.createElement("span");
  status.className = "health-label";
  status.dataset.tone = item.tone;
  status.textContent = item.status;
  row.append(label, status);
  element("health-list").append(row);
}

for (let index = 0; index < 54; index++) {
  const bar = document.createElement("i");
  const amplitude = 13 + Math.abs(Math.sin(index * .63) * Math.cos(index * .42)) * 78;
  bar.style.setProperty("--height", `${Math.round(amplitude)}%`);
  element("signal-bars").append(bar);
}

function route(focus) {
  const hash = location.hash.slice(1);
  const panel = Object.hasOwn(views, hash) ? hash : "overview";
  const overview = panel === "overview";
  element("overview").hidden = !overview;
  element("detail").hidden = overview;
  for (const link of element("navigation").querySelectorAll("a")) {
    if (link.hash === `#${panel}`) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  if (!overview) {
    const view = views[panel];
    element("detail-kicker").textContent = view.tag;
    element("detail-title").textContent = view.label;
    element("detail-description").textContent = view.description;
    element("detail-actions").replaceChildren(...view.actions.map(text => {
      const row = document.createElement("li");
      row.textContent = text;
      return row;
    }));
    element("live-link").href = `${operating}#${view.hash}`;
  }
  if (focus) {
    element(overview ? "dashboard-title" : "detail-title").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

window.addEventListener("hashchange", () => route(true));
route(false);
