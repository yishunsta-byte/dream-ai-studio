const image = {
  label: "이미지", title: "네온이 남은 밤", time: "JPG",
  url: "https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg",
  visual: "rooftop",
  observations: [["전체 화면", "자홍색과 보라색 조명이 어두운 배경과 대비돼요."], ["화면 중앙", "피사체가 중심에 모여 시선이 한곳으로 향해요."]],
  prompt: "보라와 자홍 조명이 번지는 밤의 루프탑. 인물의 실루엣을 화면 중심에 두고, 낮은 채도의 배경 위에 가장자리 조명을 더한다.",
};
const music = {
  label: "음악", title: "살라맨더 피아노 A4", time: "00:13",
  url: "https://tonejs.github.io/audio/salamander/A4.mp3",
  visual: "waveform",
  observations: [["00:00–00:02", "건반을 누른 직후 소리가 가장 뚜렷해요."], ["00:02–00:13", "잔향 길이가 이어지며 음량이 줄어들어요."]],
  prompt: "한 음이 선명하게 울린 뒤 긴 잔향으로 잦아드는 피아노. 잔잔한 배경 위에 여백을 두고, 다음 장면으로 넘어갈 때 꼬리가 자연스럽게 사라지도록 한다.",
};
const video = {
  label: "영상", title: "빛이 머무는 순간", time: "00:05",
  url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  visual: "orchid",
  observations: [["00:00", "피사체를 가까이 담아 형태와 질감이 먼저 보여요."], ["00:03", "배경을 흐리게 두어 피사체와 화면 깊이가 구분돼요."]],
  prompt: "부드러운 자연광 아래 꽃잎 클로즈업. 배경을 흐리고 초점은 꽃잎 끝에 둔다. 카메라 움직임은 최소화하고 촬영 중 초점을 천천히 이동한다.",
};
const variants = {
  premiere: { title: "1안 · 프리미어 콘솔", description: "미디어 주소부터 장면 분석과 공개까지 한 화면에서.", example: image },
  spectrum: { title: "2안 · 스펙트럼 랩", description: "파형과 구간을 살피고, 관찰 근거로 생성 프롬프트를 검토합니다.", example: music },
  curation: { title: "3안 · 큐레이션 데스크", description: "좋은 근거를 골라 공개 초안으로 이어가고 공개 상태를 관리합니다.", example: video },
};

const view = new URLSearchParams(location.search).get("view");
const selected = Object.hasOwn(variants, view) ? view : "premiere";
const variant = variants[selected];
const element = id => document.getElementById(id);
const source = element("source-url");
const run = element("run");
const cancel = element("cancel");
const publish = element("publish");
const publicationForm = element("publication-form");
const supported = new Set(["interactive-examples.mdn.mozilla.net", "mdn.github.io", "tonejs.github.io"]);
const mediaByExtension = new Map([
  ["png", image], ["jpg", image], ["jpeg", image], ["webp", image],
  ["mp3", music], ["wav", music], ["m4a", music],
  ["mp4", video], ["mov", video], ["webm", video],
]);
let result = variant.example;
let timer;

document.body.dataset.view = selected;
document.title = `${variant.title} · DREAM SCREEN`;
element("variant-name").textContent = variant.title;
element("variant-description").textContent = variant.description;

function selectMenu() {
  const current = location.hash || "#source";
  for (const link of document.querySelectorAll(".topbar nav a")) {
    if (link.hash === current) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", selectMenu);
selectMenu();

for (let index = 0; index < 76; index++) {
  const bar = document.createElement("i");
  const envelope = 1 - index / 90;
  const signal = Math.abs(Math.sin(index * 0.82) * Math.cos(index * 0.37));
  bar.style.setProperty("--amplitude", `${Math.round(6 + 90 * signal * envelope)}%`);
  element("wave").append(bar);
}

function selectResultPart(part) {
  const evidence = part === "evidence";
  element("evidence-button").setAttribute("aria-pressed", String(evidence));
  element("prompt-button").setAttribute("aria-pressed", String(!evidence));
  element("evidence").hidden = !evidence;
  element("prompt").hidden = evidence;
}

function renderSample(sample) {
  result = sample;
  element("result-state").textContent = "예시 결과";
  element("result-body").hidden = false;
  element("result-empty").hidden = true;
  element("media-preview").dataset.visual = sample.visual;
  element("media-kind").textContent = `${sample.label} 예시`;
  element("media-title").textContent = sample.title;
  element("media-time").textContent = sample.time;
  element("evidence").replaceChildren(...sample.observations.map(([segment, evidence]) => {
    const item = document.createElement("li");
    const key = document.createElement("b");
    const description = document.createElement("span");
    key.textContent = segment;
    description.textContent = evidence;
    item.append(key, description);
    return item;
  }));
  element("prompt-text").textContent = sample.prompt;
  element("publish-name").value = sample.title;
  element("publish-summary").value = sample.observations[0][1];
  element("publish-prompt").value = sample.prompt;
  element("public-consent").checked = false;
  element("publication-state").textContent = "초안";
  element("publication-message").textContent = "";
  selectResultPart("evidence");
  publish.disabled = false;
}

function clearResult(state = "분석 대기") {
  result = null;
  element("result-state").textContent = state;
  element("result-body").hidden = true;
  const empty = element("result-empty");
  empty.hidden = false;
  for (const id of ["publish-name", "publish-summary", "publish-prompt"]) element(id).value = "";
  element("public-consent").checked = false;
  element("publication-message").textContent = "";
  element("publication-state").textContent = "분석 대기";
  publish.disabled = true;
}

function showMessage(message, invalid = false) {
  const output = element("source-message");
  output.textContent = message;
  output.hidden = !message;
  output.dataset.tone = invalid ? "error" : "progress";
  source.setAttribute("aria-invalid", String(invalid));
}

function checkUrl(value) {
  if (!value) return { error: "미디어 파일 URL을 입력하세요." };
  let url;
  try { url = new URL(value); }
  catch { return { error: "https://로 시작하는 파일 주소를 입력하세요." }; }
  const threadsPost = ["threads.com", "threads.net"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (threadsPost) {
    return { error: "Threads 게시물 링크는 분석할 수 없어요. 미디어 파일의 직접 HTTPS 주소를 입력하세요." };
  }
  const extension = url.pathname.split(".").at(-1).toLowerCase();
  const sample = mediaByExtension.get(extension);
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password || url.port || !sample) {
    return { error: "쿼리나 로그인 정보가 없는 직접 HTTPS 파일 주소를 입력하세요." };
  }
  if (!supported.has(url.hostname)) return { error: "지원하는 원본이 아니에요. 아래 ‘지원 원본·형식 보기’에서 확인하세요." };
  return { sample };
}

function setRunning(running) {
  run.disabled = source.disabled = running;
  element("example").disabled = running;
  cancel.hidden = !running;
}

source.addEventListener("input", () => {
  clearResult();
  const input = source.value.trim();
  const error = input.includes("://") ? checkUrl(input).error : "";
  showMessage(error ?? "", Boolean(error));
});

element("example").addEventListener("click", () => {
  source.value = variant.example.url;
  source.dispatchEvent(new Event("input"));
  source.focus({ preventScroll: true });
});

element("source-form").addEventListener("submit", event => {
  event.preventDefault();
  const { sample, error } = checkUrl(source.value.trim());
  if (error) {
    clearResult();
    showMessage(error, true);
    source.focus();
    return;
  }
  clearResult("분석 중");
  showMessage("예시 분석 결과를 준비하고 있어요.");
  setRunning(true);
  cancel.focus();
  timer = setTimeout(() => {
    const sourceFocused = document.activeElement === cancel;
    setRunning(false);
    showMessage("");
    renderSample(sample);
    if (sourceFocused) {
      const resultsTitle = element("results-title");
      resultsTitle.focus({ preventScroll: true });
      if (resultsTitle.getBoundingClientRect().bottom > window.innerHeight) element("results").scrollIntoView({ block: "start" });
    }
  }, 650);
});

cancel.addEventListener("click", () => {
  clearTimeout(timer);
  setRunning(false);
  clearResult();
  showMessage("분석을 취소했어요.");
  run.focus();
});

element("evidence-button").addEventListener("click", () => selectResultPart("evidence"));
element("prompt-button").addEventListener("click", () => selectResultPart("prompt"));
element("use-prompt").addEventListener("click", () => {
  element("publish-prompt").value = result.prompt;
  element("publish-prompt").focus();
});

publicationForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!result || !element("public-consent").checked) return;
  const item = document.createElement("li");
  const title = document.createElement("strong");
  const summary = document.createElement("p");
  const prompt = document.createElement("details");
  const promptLabel = document.createElement("summary");
  const promptText = document.createElement("p");
  const controls = document.createElement("div");
  const withdraw = document.createElement("button");
  const stop = document.createElement("button");
  title.textContent = element("publish-name").value.trim();
  summary.textContent = element("publish-summary").value.trim();
  promptLabel.textContent = "생성 프롬프트 보기";
  promptText.textContent = element("publish-prompt").value.trim();
  prompt.append(promptLabel, promptText);
  withdraw.type = stop.type = "button";
  withdraw.className = stop.className = "quiet-button";
  withdraw.textContent = "공개 철회";
  stop.textContent = "취소";
  stop.hidden = true;
  controls.append(withdraw, stop);
  item.append(title, summary, prompt, controls);
  withdraw.addEventListener("click", () => {
    if (stop.hidden) {
      stop.hidden = false;
      withdraw.textContent = "철회 확인";
      return;
    }
    item.remove();
    element("published-empty").hidden = element("publications").children.length > 0;
    element("list-message").textContent = "예시 결과를 철회했어요.";
    element("refresh").focus();
  });
  stop.addEventListener("click", () => {
    stop.hidden = true;
    withdraw.textContent = "공개 철회";
    withdraw.focus();
  });
  element("publications").prepend(item);
  element("published-empty").hidden = true;
  element("public-consent").checked = false;
  element("publication-state").textContent = "예시 공개됨";
  element("publication-message").textContent = "이 시안의 공개 목록에 추가했어요.";
});

element("refresh").addEventListener("click", () => {
  element("list-message").textContent = `이 시안의 공개 결과 ${element("publications").children.length}건`;
});

renderSample(variant.example);
