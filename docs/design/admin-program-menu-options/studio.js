const looks = {
  live: {name: "라이브 콘솔"},
  signal: {name: "시그널 랩"},
  premiere: {name: "프리미어 스튜디오"}
};
const asset = "../admin-multimedia-options/assets/";
const programs = {
  image: {
    name: "Style DNA", kind: "이미지", symbol: "◈",
    description: "색과 빛, 화면 구도를 살펴보고 이미지 생성용 한영 프롬프트를 얻을 수 있습니다.",
    source: "이미지 소스", preview: "이미지 프리뷰", sample: "Neon Rooftop", mediaMeta: "PNG · 16:9",
    modes: [["url", "직접 URL"], ["file", "파일 업로드"]], url: "https://mdn.github.io/example.png",
    formats: "PNG · JPG · WebP", action: "Style DNA로 분석",
    roles: ["컬러 팔레트", "구도·조명", "한영 프롬프트"],
    resultTitle: "스타일 리포트", resultIntro: "배경의 네온광과 인물 실루엣이 대비되는 야간 장면",
    readings: [["조명", "분홍 네온과 청색 보조광"], ["구도", "오른쪽 인물과 왼쪽 도시 배경"], ["분위기", "도시적이고 차분한 야간 톤"]],
    prompt: "보라빛 네온이 내려앉은 도심 옥상. 인물의 실루엣을 오른쪽에 두고, 청색 보조광으로 배경의 깊이를 살린다.",
    promptEn: "A neon rooftop at night. Frame the silhouette to the right, with blue fill lighting and a deep city skyline to the left."
  },
  music: {
    name: "음악 분석", kind: "사운드", symbol: "≋",
    description: "장르, 악기, 추정 템포와 구간 구조를 살펴보고 Suno용 프롬프트를 얻습니다.",
    source: "음악 파일", preview: "오디오 파형", sample: "After Hours", mediaMeta: "WAV · 00:24",
    modes: [["file", "파일 업로드"]], formats: "MP3 · WAV · M4A", file: "after-hours.wav",
    consent: "음악 파일을 분석할 권리가 있으며 Gemini에 원본 파일을 보내는 데 동의합니다.", action: "음악 의미 분석 실행",
    roles: ["장르·악기", "추정 템포", "Suno 프롬프트"],
    resultTitle: "음악 리포트", resultIntro: "느슨한 비트 위에 낮은 신스 음색이 쌓이는 트랙",
    readings: [["장르", "앰비언트 일렉트로닉"], ["악기", "신스, 소프트 킥, 패드"], ["템포", "96 BPM 추정"]],
    prompt: "Ambient electronic, 96 BPM, warm synth pads, soft kick, spacious stereo field, a gentle late-night build."
  },
  shorts: {
    name: "쇼츠 분석", kind: "영상", symbol: "▷",
    description: "공개 YouTube 영상의 첫 장면, 화면 구성과 소리를 시간대별로 살펴봅니다.",
    source: "YouTube 영상 주소", preview: "세로 영상 프리뷰", sample: "Desert Motion", mediaMeta: "YouTube · 9:16",
    modes: [["url", "공개 YouTube 주소"]], url: "https://www.youtube.com/shorts/00000000000", formats: "공개 쇼츠 · YouTube 시청 주소",
    consent: "영상을 분석할 권리가 있으며 Gemini에 공개 영상 주소를 보내는 데 동의합니다.", action: "쇼츠 분석",
    roles: ["첫 장면", "시간대별 근거", "영상 프롬프트"],
    resultTitle: "쇼츠 리포트", resultIntro: "첫 장면에서 색과 속도로 시선을 모으는 구성",
    readings: [["00:00", "모래 위를 질주하는 차량"], ["00:05", "화면 전환으로 움직임 강조"], ["소리", "미확인"]],
    prompt: "사막을 질주하는 차량을 9:16 세로 화면으로 담는다. 첫 2초에 시선을 잡고, 리듬에 맞춰 가까운 장면으로 전환한다."
  }
};
const operations = {
  overview: ["개요", "분석 프로그램과 작업 메뉴로 이동할 수 있습니다."],
  projects: ["내 프로젝트", "클라우드 프로젝트를 열고 저장 상태를 확인하는 메뉴입니다."],
  publish: ["완성본 검수·게시", "완성본을 검토하고 공개하거나 철회하는 메뉴입니다."],
  api: ["API연동", "Style DNA, 음악 분석, 쇼츠 분석의 모델 설정 상태를 확인합니다."],
  queue: ["렌더 대기열", "최근 렌더 작업의 진행 상태를 확인하는 메뉴입니다."],
  account: ["계정 설정", "로그인 계정과 비밀번호를 관리하는 메뉴입니다."]
};
const params = new URLSearchParams(location.search);
const requestedLook = params.get("look");
const look = Object.hasOwn(looks, requestedLook) ? requestedLook : "live";
const workspace = document.getElementById("workspace");
document.body.dataset.look = look;
document.body.dataset.embed = params.get("embed") === "1" ? "true" : "false";

const bars = [12,22,31,18,25,52,77,48,29,61,91,74,25,43,56,68,42,79,97,79,45,32,58,84,69,51,79,95,57,32,52,75,91,65,30,42,68,82,63,30,43,62,74,50,26,20,35,37,20,14];
const sampleScenes = [
  {time: "00:00", label: "첫 장면", image: "desert.webp", alt: "모래 위를 질주하는 차량"},
  {time: "00:05", label: "장면 전환", image: "neon.webp", alt: "보라빛 조명의 도심 옥상"},
  {time: "00:10", label: "마무리", image: "celestial.webp", alt: "별빛의 샘플 장면"}
];
const palettes = ["#9C56D8","#ED7CA6","#5A7CD1","#20233E","#221524"];

function visual(kind) {
  if (kind === "music") {
    return `<div class="media-art wave-art"><div class="wave-bars" aria-hidden="true">${bars.map(height => `<i style="--amplitude:${height}%"></i>`).join("")}</div><div class="wave-line"></div><span>00:00</span><span>00:24</span></div>
    <div class="scene-row" aria-label="음악 구간"><span>도입</span><span>비트 진입</span><span>아웃트로</span></div>`;
  }
  if (kind === "shorts") {
    return `<div class="media-art shorts-art"><div class="phone"><img src="${asset}desert.webp" alt="사막 쇼츠 샘플" width="220" height="340"><span class="preview-time">00:00 · 첫 장면</span></div></div>
    <div class="scene-row" role="group" aria-label="쇼츠 구간">${sampleScenes.map((scene, i) => `<button type="button" data-scene="${i}" aria-pressed="${i === 0}">${scene.time}<small>${scene.label}</small></button>`).join("")}</div>`;
  }
  return `<div class="media-art picture-art"><img src="${asset}neon.webp" alt="보라빛 조명의 도심 옥상" width="960" height="540"><span class="picture-focus" aria-hidden="true"></span></div>
  <div class="palette" aria-label="샘플 컬러 팔레트">${palettes.map(color => `<span style="--swatch:${color}"><i aria-hidden="true"></i><code>${color}</code></span>`).join("")}</div>`;
}

function hero(kind, program) {
  return `<section class="mast" aria-labelledby="work-title">
    <div class="mast-copy"><p class="mast-label"><span class="tag-dot"></span>${program.kind} 분석 <span aria-hidden="true">/</span> ${looks[look].name}</p>
      <h1 id="work-title" tabindex="-1">${program.name}</h1><p>${program.description}</p>
      <ul class="hero-steps" aria-label="분석 순서"><li>소스 선택</li><li>분석 실행</li><li>결과 검토</li></ul>
    </div>
    <div class="mast-display" aria-hidden="true">
      <div class="display-icon">${program.symbol}</div>
      <div class="display-copy"><strong>${program.roles[0]}</strong><span>${program.roles.slice(1).join(" · ")}</span></div>
      <div class="display-wave">${bars.slice(0, 25).map(height => `<b style="--amplitude:${height}%"></b>`).join("")}</div>
    </div>
  </section>`;
}

function sourceCard(program) {
  return `<section class="panel source" aria-labelledby="source-title">
    <div class="panel-title"><span class="panel-symbol" aria-hidden="true">↳</span><h2 id="source-title">${program.source}</h2></div>
    <form id="source-form">
      <div class="source-modes" role="group" aria-label="입력 방식">${program.modes.map(([value, label], i) => program.modes.length === 1
        ? `<span class="mode single">${label}</span>`
        : `<button type="button" class="mode" data-mode="${value}" aria-pressed="${i === 0}">${label}</button>`).join("")}</div>
      <div id="source-input"></div>
      <p class="field-note">${program.formats}${program.modes.some(([value]) => value === "file") ? " · 업로드 최대 4 MiB" : ""}</p>
      ${program.consent ? `<label class="consent"><input id="consent" type="checkbox">${program.consent}</label>` : `<p class="field-note">분석할 권리를 확인한 이미지 사본이 Gemini로 전송됩니다.</p>`}
      <div class="source-actions"><button type="submit" class="primary" id="run" disabled>${program.action} <span aria-hidden="true">→</span></button>
        <button type="button" class="secondary" id="fill-sample">샘플 선택</button></div>
      <p id="source-status" class="field-status" role="status"></p>
      <a class="text-link" href="#api">API연동 보기 ↗</a>
    </form>
  </section>`;
}

function previewCard(kind, program) {
  return `<section class="panel preview" aria-labelledby="preview-title">
    <div class="panel-title"><span class="panel-symbol" aria-hidden="true">□</span><h2 id="preview-title">${program.preview}</h2><span class="flag">샘플</span></div>
    <div class="media-area">${visual(kind)}</div>
    <div class="media-caption"><strong>${program.sample}</strong><span>${program.mediaMeta}</span></div>
  </section>`;
}

function reportCard(program) {
  const promptTitle = program === programs.music ? "Suno 프롬프트" : "생성 프롬프트";
  return `<section class="panel report" aria-labelledby="report-title">
    <div class="panel-title"><span class="panel-symbol" aria-hidden="true">≡</span><h2 id="report-title">${program.resultTitle}</h2><span class="flag">예시 결과</span></div>
    <p class="report-intro">${program.resultIntro}</p>
    <dl class="readings">${program.readings.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join("")}</dl>
    <details class="prompt"><summary>${promptTitle}</summary><p>${program.prompt}</p>${program.promptEn ? `<p class="prompt-en" lang="en">${program.promptEn}</p>` : ""}</details>
  </section>`;
}

function bindForm(program) {
  const form = document.querySelector("#source-form");
  const field = document.querySelector("#source-input");
  const consent = document.querySelector("#consent");
  const status = document.querySelector("#source-status");
  const run = document.querySelector("#run");
  let mode = program.modes[0][0];
  let samplePicked = false;
  function update() {
    const value = field.querySelector("input")?.value.trim();
    run.disabled = !(samplePicked || value) || (consent && !consent.checked);
  }
  function renderInput() {
    if (mode === "file") {
      field.innerHTML = '<label class="field-label" for="asset-file">파일 선택</label><input id="asset-file" type="file" aria-describedby="file-name"><span id="file-name" class="file-name"></span>';
    } else {
      const label = program === programs.shorts ? "공개 YouTube 영상 주소" : "이미지 직접 URL";
      const hint = program === programs.shorts ? "youtube.com/shorts/…" : "https://…/image.webp";
      field.innerHTML = `<label class="field-label" for="asset-url">${label}</label><input id="asset-url" type="url" placeholder="${hint}" autocomplete="off">`;
    }
    if (mode === "file") {
      const file = field.querySelector("input");
      file.accept = program === programs.music ? ".mp3,.wav,.m4a" : ".png,.jpg,.jpeg,.webp";
    }
    field.querySelector("input").addEventListener("input", event => {
      samplePicked = false;
      if (mode === "file") {
        const name = event.target.files[0]?.name || "";
        field.querySelector("#file-name").textContent = name;
      }
      if (consent) consent.checked = false;
      status.textContent = "";
      update();
    });
    update();
  }
  for (const button of form.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => {
      if (mode === button.dataset.mode) return;
      mode = button.dataset.mode;
      samplePicked = false;
      form.querySelectorAll("[data-mode]").forEach(option => option.setAttribute("aria-pressed", String(option === button)));
      status.textContent = "";
      renderInput();
    });
  }
  form.querySelector("#fill-sample").addEventListener("click", () => {
    if (mode === "file") {
      const name = program.file || "neon-rooftop.webp";
      field.querySelector("#file-name").textContent = name + " · 샘플";
      field.querySelector("input").value = "";
    } else {
      field.querySelector("input").value = program.url;
    }
    samplePicked = true;
    if (consent) consent.checked = false;
    status.textContent = "샘플을 선택했습니다.";
    update();
  });
  consent?.addEventListener("change", update);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (run.disabled) return;
    status.textContent = "예시 결과를 표시했습니다.";
    const report = document.querySelector(".report");
    report.classList.add("show-result");
    report.querySelector(".prompt").open = true;
    report.scrollIntoView({block:"nearest", behavior:"auto"});
  });
  renderInput();
}

function bindScenes() {
  for (const button of document.querySelectorAll("[data-scene]")) {
    button.addEventListener("click", () => {
      const scene = sampleScenes[Number(button.dataset.scene)];
      document.querySelectorAll("[data-scene]").forEach(segment => segment.setAttribute("aria-pressed", String(segment === button)));
      const frame = document.querySelector(".phone img");
      frame.src = asset + scene.image;
      frame.alt = scene.alt;
      document.querySelector(".preview-time").textContent = scene.time + " · " + scene.label;
    });
  }
}

function render(moveFocus = false) {
  const hash = location.hash.slice(1);
  if (hash === "workspace") return;
  const active = Object.hasOwn(programs, hash) || Object.hasOwn(operations, hash) ? hash : "image";
  document.body.dataset.program = active;
  document.querySelectorAll("[data-section]").forEach(link => {
    if (link.dataset.section === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (Object.hasOwn(programs, active)) {
    const program = programs[active];
    workspace.innerHTML = hero(active, program) + `<div class="work-grid">${sourceCard(program)}${previewCard(active, program)}${reportCard(program)}</div>`;
    bindForm(program);
    bindScenes();
    document.title = program.name + " · " + looks[look].name + " | DREAM SCREEN";
  } else {
    const [title, description] = operations[active];
    workspace.innerHTML = `<section class="panel operation"><div class="mast-label">${looks[look].name} · 샘플 화면</div><h1 id="work-title" tabindex="-1">${title}</h1><p>${description}</p>
      <div class="operation-links"><a href="#image">Style DNA</a><a href="#music">음악 분석</a><a href="#shorts">쇼츠 분석</a></div></section>`;
    if (active === "api") {
      const operations = workspace.querySelector(".operation");
      operations.querySelector(".operation-links").remove();
      operations.insertAdjacentHTML("beforeend", `
        <button type="button" class="settings-check" id="check-settings">예시 상태 확인</button>
        <ul class="api-table">${Object.entries(programs).map(([name, program]) => `
          <li><a href="#${name}">${program.name} ↗</a><span class="api-status" role="status" aria-label="${program.name}">확인 전</span></li>
        `).join("")}</ul>`);
      operations.querySelector("#check-settings").addEventListener("click", () => {
        const sampleStates = ["서버 설정 확인", "Gemini 서버 설정 필요", "서버 설정 확인"];
        operations.querySelectorAll(".api-status").forEach((row, index) => { row.textContent = sampleStates[index]; });
      });
    }
    document.title = title + " · " + looks[look].name + " | DREAM SCREEN";
  }
  if (moveFocus && document.body.dataset.embed !== "true") {
    const heading = document.getElementById("work-title");
    heading.focus({preventScroll:true});
    window.scrollTo({top: 0, behavior: "auto"});
  }
}
window.addEventListener("hashchange", () => render(true));
render();
