const art = "../../../public/showcase/t240/";
const projects = [
  { name: "와일드 코스트 에디션", type: "쇼핑숏츠", image: "wild-coast.png", status: "검수 필요", tone: "warn", version: "r7", outputs: "—", meta: "09:42" },
  { name: "선플라워", type: "쇼핑숏츠", image: "sunflower.png", status: "출력 완료", tone: "ok", version: "r12", outputs: "4개", meta: "09:18" },
  { name: "오키드", type: "쇼핑숏츠", image: "orchid.png", status: "편집 중", tone: "dim", version: "r3", outputs: "—", meta: "어제" },
  { name: "데저트 모션 에디션", type: "쇼핑숏츠", image: "desert-motion.png", status: "검수 필요", tone: "warn", version: "r5", outputs: "—", meta: "어제" },
];
const stages = [
  { name: "장면 제작", status: "완료", copy: "등록한 이미지와 선택한 장면 결과를 확인합니다.", actions: ["장면 결과 보기"] },
  { name: "편집", status: "저장됨", copy: "현재 타임라인의 자막과 연결된 음원을 확인합니다.", actions: ["자막 편집", "편집 음원 선택"] },
  { name: "검수", status: "확인 필요", copy: "현재 리비전의 필수 항목과 권리 기록을 확인한 뒤 승인합니다.", actions: ["검수표 보기"] },
  { name: "출력", status: "승인 후", copy: "승인된 현재 버전에서 MP4, 자막 파일, 재편집 ZIP을 만들고 받을 수 있습니다.", actions: ["영상 만들기", "재편집 ZIP"] },
];
const menu = { overview: "개요", projects: "프로젝트", publication: "검수·게시", account: "계정 설정" };
const url = new URL(window.location.href);
document.documentElement.classList.toggle("embedded", url.searchParams.get("embed") === "1");
let design = ["1", "2", "3"].includes(url.searchParams.get("design")) ? url.searchParams.get("design") : "1";
function defaultSection() { return design === "1" ? "overview" : "projects"; }
let section = defaultSection();
let selected = 0;
let stage = 2;
let live = false;
let filter = "";
const root = document.querySelector("#workspace");
const chip = (label, tone = "") => `<span class="chip ${tone}">${label}</span>`;
const button = (label, attrs = "", kind = "") => `<button type="button" class="btn ${kind}" ${attrs}>${label}</button>`;
const projectImage = (project) => `<img src="${art}${project.image}" alt="">`;
const intro = (title, description, kicker = "") => `
  <div class="intro">
    <div>${kicker ? `<div class="kicker">${kicker}</div>` : ""}<h1 tabindex="-1">${title}</h1><p>${description}</p></div>
    <span class="env">${live ? "운영 화면 · 연결 대기" : "로컬 기능 · 예시 데이터"}</span>
  </div>`;
const connection = () => `
  <section class="panel panel-pad">
    <div class="head"><h2>연결 상태</h2></div>
    <ul class="rows">
      <li><div><strong>프로젝트 조회</strong><p>내 계정의 프로젝트 목록</p></div>${chip(live ? "미연결" : "로컬 예시", live ? "warn" : "dim")}</li>
      <li><div><strong>게시 서버</strong><p>공개 홈 게시·철회</p></div>${chip("미연결", "warn")}</li>
    </ul>
    <details class="tip"><summary>기타 미연결 기능 6개</summary>
      <p>작업 대기열 · 자료 관리 · 백업·복원 · 운영 로그 · 회원 관리 · 서비스 상태</p>
    </details>
  </section>`;
const unavailable = () => `<div class="off"><strong>운영 프로젝트 조회가 연결을 기다리고 있어요.</strong><p>연결이 확인되면 로그인 계정의 프로젝트와 현재 버전이 표시됩니다.</p></div>`;
const sectionButton = (label, target, kind) => button(label, `data-section="${target}"`, kind);

function briefing() {
  if (live) return intro("운영 브리핑", "프로젝트와 게시 연결 상태를 확인하세요.", "ADMIN OVERVIEW") + unavailable() + connection();
  return intro("운영 브리핑", "내 프로젝트에서 다음으로 처리할 일을 확인하세요.", "ADMIN OVERVIEW") + `
    <div class="two">
      <section class="hero panel">
        ${projectImage(projects[0])}
        <div>${chip("검수 필요", "warn")}<h2>${projects[0].name}</h2><p>내용 r7 · 현재 버전 검수 대기</p>
          <div class="actions">${button("검수표 보기 ↗", 'data-project="0" data-open-stage="2"', "primary")}</div>
        </div>
      </section>
      ${connection()}
    </div>
    <div class="tile-grid">
      ${[["내 프로젝트", "4개", "내 계정의 프로젝트", ""], ["검수 필요", "2건", "현재 버전 기준", "검수 필요"], ["출력 완료", "1건", "MP4 및 파일 확인", "출력 완료"], ["편집 중", "1건", "자막·음원 작업", "편집 중"]].map(([title, count, hint, value]) => `
        <button type="button" class="panel tile" data-filter-go="${value}"><span>${title}</span><strong>${count}</strong><small>${hint}</small></button>`).join("")}
    </div>
    <section class="panel panel-pad">
      <div class="head"><h2>이어서 작업</h2>${sectionButton("프로젝트 전체 →", "projects", "")}</div>
      <ul class="rows">
        <li><div><strong>${projects[3].name}</strong><p>필수 검수 항목 확인</p></div>${button("검수 보기", 'data-project="3" data-open-stage="2"')}</li>
        <li><div><strong>선플라워</strong><p>승인한 버전의 MP4와 재편집 ZIP</p></div>${button("출력 보기", 'data-project="1" data-open-stage="3"')}</li>
      </ul>
    </section>`;
}

function consoleView() {
  if (live) return intro("프로젝트 콘솔", "연결이 확인되면 아래에 내 프로젝트가 표시됩니다.", "PROJECT QUEUE") + unavailable() + connection();
  return intro(design === "2" ? "프로젝트 콘솔" : "내 프로젝트", "작업 상태와 리비전을 확인하고 다음 단계로 이동하세요.", "PROJECT QUEUE") + `
    <section class="panel">
      <div class="filters">
        <input type="search" id="project-search" aria-label="프로젝트 이름 검색" placeholder="프로젝트 이름 검색">
        <select id="status-filter" aria-label="프로젝트 상태 필터">
          ${["", "검수 필요", "출력 완료", "편집 중"].map(value => `<option value="${value}" ${filter === value ? "selected" : ""}>${value || "전체 상태"}</option>`).join("")}
        </select>
        <span class="muted" id="count" role="status">4개 프로젝트</span>
      </div>
      <div class="records">
        <div class="record labels" aria-hidden="true"><span>프로젝트</span><span>현재 상태</span><span class="version">내용 버전</span><span>출력 파일</span><span>작업 이동</span></div>
        ${projects.map((project, i) => `
          <article class="record project-record" data-name="${project.name}" data-status="${project.status}">
            <div class="project-title">${projectImage(project)}<div><strong>${project.name}</strong><small>${project.type} · ${project.meta}</small></div></div>
            <div class="record-status">${chip(project.status, project.tone)}</div>
            <span class="version"><span class="record-key">내용 버전</span>${project.version}</span>
            <span class="record-file muted"><span class="record-key">출력 파일</span>${project.outputs === "—" ? "없음" : project.outputs}</span>
            ${button(`${["검수표 보기", "MP4·ZIP 보기", "자막·음원 보기", "검수표 보기"][i]} →`, `data-project="${i}" data-open-stage="${[2, 3, 1, 2][i]}"`, i === 0 ? "primary" : "")}
          </article>`).join("")}
        <p class="blank" id="empty-search" hidden>검색 조건에 맞는 프로젝트가 없어요.</p>
      </div>
    </section>
    <div class="quick" aria-label="작업 상태 바로 보기">
      ${["검수 필요", "출력 완료", "편집 중"].map(value => `<button type="button" data-filter-set="${value}" aria-pressed="${filter === value}">${value}</button>`).join("")}
    </div>
    <section class="panel panel-pad inline"><div class="head"><h2>검수·게시</h2>${chip("게시 서버 미연결", "warn")}</div>
      <p class="muted">프로젝트 검수 결과와 공개 홈 게시 상태를 확인하는 곳입니다.</p>${sectionButton("검수·게시 열기 →", "publication", "")}
    </section>`;
}

function studioView() {
  if (live) return intro("프로젝트 스튜디오", "내 프로젝트의 장면부터 출력까지 확인합니다.", "PROJECT WORKSPACE") + unavailable() + connection();
  const project = projects[selected];
  const info = stages[stage];
  return intro("프로젝트 스튜디오", "프로젝트 하나를 선택하고 장면부터 출력까지 관리하세요.", "PROJECT WORKSPACE") + `
    <div class="project-picker" aria-label="프로젝트 선택">${projects.map((item, i) => `
      <button type="button" class="select-project" aria-pressed="${selected === i}" data-project="${i}">${projectImage(item)}${item.name}</button>`).join("")}</div>
    <div class="studio">
      <section class="panel studio-media">${projectImage(project)}
        <div class="overlay">${chip(project.status, project.tone)}<h2>${project.name}</h2><p>${project.type} · 내용 ${project.version}</p></div>
      </section>
      <section class="panel panel-pad"><div class="head"><h2>제작 진행</h2><span class="muted">${project.version}</span></div>
        <div class="steps" role="group" aria-label="제작 단계">${stages.map((item, i) => `<button type="button" class="step" aria-pressed="${stage === i}" data-stage="${i}"><strong>${item.name}</strong><small>${project.tone === "ok" ? "완료" : item.status}</small></button>`).join("")}</div>
        <div class="stage-detail"><h3>${info.name}</h3><p>${info.copy}</p>
          <div class="actions">${info.actions.map(action => button(action + " →", `data-demo="${action}"`, "primary")).join("")}</div>
          <div id="demo-action" aria-live="polite"></div>
        </div>
      </section>
    </div>
    <section class="panel panel-pad artifacts">
      <div class="head"><h2>현재 버전의 파일</h2><span class="muted">${project.version}</span></div>
      <ul class="rows">
        <li><div><strong>MP4 영상</strong><p>현재 승인 버전의 출력</p></div>${chip(project.tone === "ok" ? "다운로드 가능" : "검수 후 만들기", project.tone === "ok" ? "ok" : "dim")}</li>
        <li><div><strong>SRT · VTT / 재편집 ZIP</strong><p>승인 자막과 편집 자료</p></div>${chip(project.tone === "ok" ? "다운로드 가능" : "승인 필요", project.tone === "ok" ? "ok" : "dim")}</li>
      </ul>
    </section>`;
}

function publication() {
  return intro("검수·게시", "프로젝트의 제작 검수와 공개 홈의 게시 상태를 확인하세요.") + `
    <div class="two">
      <section class="panel panel-pad"><div class="head"><h2>프로젝트 검수</h2></div>
        ${live ? "<p class='muted'>프로젝트 조회 연결이 필요해요.</p>" : `<ul class="rows">${projects.filter(item => item.status === "검수 필요").map(item => `
          <li><div><strong>${item.name}</strong><p>내용 ${item.version} · 검수 필요</p></div>${button("검수표 보기", `data-project="${projects.indexOf(item)}" data-open-stage="2"`)}</li>`).join("")}</ul>`}
      </section>
      <section class="panel panel-pad"><div class="head"><h2>공개 홈 게시</h2>${chip("미연결", "warn")}</div>
        <p class="muted">운영 게시 서버가 연결되면 승인된 완성본을 게시하거나 철회할 수 있어요.</p>
        <details class="tip"><summary>게시 전 확인 항목</summary><p class="muted">현재 승인 버전, 권리 증빙, 표지와 공개 파일을 확인합니다.</p></details>
      </section>
    </div>`;
}

function account() {
  return intro("계정 설정", "로그인 계정과 운영 연결 상태를 확인하세요.") + `
    <div class="two">
      <section class="panel panel-pad"><div class="head"><h2>로그인 계정</h2>${chip("예시 관리자", "dim")}</div>
        <p class="muted">내 계정이 소유한 프로젝트를 관리합니다.</p>
        <div class="actions">${button("비밀번호 바꾸기", 'data-demo="비밀번호 바꾸기"')}<div id="demo-action" aria-live="polite"></div></div>
      </section>
      ${connection()}
    </div>`;
}

function filterRecords() {
  const search = document.querySelector("#project-search");
  if (!search) return;
  const query = search.value.trim().toLocaleLowerCase("ko-KR");
  let count = 0;
  document.querySelectorAll(".project-record").forEach(row => {
    row.hidden = !row.dataset.name.toLocaleLowerCase("ko-KR").includes(query) || !!filter && row.dataset.status !== filter;
    if (!row.hidden) count += 1;
  });
  document.querySelector("#count").textContent = `${count}개 프로젝트`;
  document.querySelector("#empty-search").hidden = count > 0;
  document.querySelectorAll("[data-filter-set]").forEach(btn => btn.setAttribute("aria-pressed", String(btn.dataset.filterSet === filter)));
}

function draw(focusSelector) {
  document.documentElement.dataset.theme = design;
  document.querySelectorAll("[data-design]").forEach(link => {
    if (link.dataset.design === design) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll("nav [data-section]").forEach(btn => {
    const active = (section === "record" ? "projects" : section) === btn.dataset.section;
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  root.innerHTML = section === "account" ? account() : section === "publication" ? publication()
    : section === "record" || (section === "projects" && design === "3") ? studioView()
    : section === "projects" ? consoleView() : briefing();
  filterRecords();
  const focusTarget = focusSelector && root.querySelector(focusSelector);
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus({ preventScroll: true });
    focusTarget.scrollIntoView({ block: focusTarget.tagName === "H1" ? "start" : "nearest", inline: "nearest" });
  }
}

document.addEventListener("click", event => {
  const control = event.target.closest("a[data-design],button");
  if (!control) return;
  const { design: next, section: target, project, openStage, stage: nextStage, filterGo, filterSet, demo } = control.dataset;
  if (next) {
    event.preventDefault();
    design = next; section = defaultSection(); filter = ""; selected = 0; stage = 2;
    url.searchParams.set("design", design);
    history.replaceState(null, "", url);
    draw();
  } else if (target && menu[target]) {
    section = target; filter = ""; draw("h1");
  } else if (project !== undefined) {
    const detail = openStage !== undefined;
    selected = Number(project); stage = detail ? Number(openStage) : 2;
    section = "record";
    draw(detail ? "h1" : `[data-project="${selected}"]`);
  } else if (nextStage !== undefined) {
    stage = Number(nextStage);
    draw(`[data-stage="${stage}"]`);
  } else if (filterGo !== undefined) {
    filter = filterGo; section = "projects"; draw("h1");
  } else if (filterSet !== undefined) {
    filter = filter === filterSet ? "" : filterSet;
    document.querySelector("#status-filter").value = filter;
    filterRecords();
  } else if (demo) {
    document.querySelector("#demo-action").textContent = `시안에서 선택한 작업 · ${demo}`;
  }
});
document.addEventListener("input", event => { if (event.target.id === "project-search") filterRecords(); });
document.addEventListener("change", event => {
  if (event.target.id === "live-mode") { live = event.target.checked; draw(); }
  if (event.target.id === "status-filter") { filter = event.target.value; filterRecords(); }
});
draw();
