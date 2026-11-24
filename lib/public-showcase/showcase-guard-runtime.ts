// T-255-F2/F3 공개 홈 철회 가드(서버·브라우저 공용, 비밀값 없음).
// 승인 작품 영역은 서버 HTML에서 HTML `hidden` 속성으로 시작한다. CSS·인라인 스타일·스크립트가 모두 막혀도 숨김이 유지된다(F2-R).
// bfcache 복원 가드(pagehide 숨김, pageshow persisted → 숨긴 채 다시 읽기)가 설치된 문서에서만 영역을 드러낸다.
// 설치 경로는 둘이고 동작은 같다.
//   1) 문서 인라인 스크립트(SHOWCASE_GUARD_JS → 표시는 영역 바로 뒤 SHOWCASE_REVEAL_JS). 앱 번들 실패·지연과 무관하다.
//   2) 앱 번들의 React 효과(installShowcaseGuard). 인라인 스크립트가 CSP로 막혀도 번들이 돌면 같은 가드를 설치하고 드러낸다.
// 둘 다 막히면 영역은 숨김 그대로이고, 대체 안내(로그인·관리자 링크)가 보인다.
export const SHOWCASE_GATED_ID = "showcase-gated";
export const SHOWCASE_FALLBACK_ID = "showcase-fallback";
export const SHOWCASE_GUARD_FLAG = "__dreamShowcaseGuard";

// 가드 설치 → 설치 표시. 표시는 리스너 설치가 끝난 뒤에만 남긴다.
export const SHOWCASE_GUARD_JS = [
  "(function(){",
  `if(window.${SHOWCASE_GUARD_FLAG})return;`,
  "var d=document.documentElement;",
  'addEventListener("pagehide",function(e){if(e.persisted)d.style.visibility="hidden"});',
  'addEventListener("pageshow",function(e){if(e.persisted){d.style.visibility="hidden";location.reload()}});',
  `window.${SHOWCASE_GUARD_FLAG}=true;`,
  "})();",
].join("");

// 가드 설치 표시가 있을 때만 대체 안내를 숨기고 승인 영역을 드러낸다. 승인 영역 바로 뒤에 둔다(이미 파싱된 요소만 만짐).
export const SHOWCASE_REVEAL_JS = [
  "(function(){",
  `if(!window.${SHOWCASE_GUARD_FLAG})return;`,
  `var g=document.getElementById("${SHOWCASE_GATED_ID}"),f=document.getElementById("${SHOWCASE_FALLBACK_ID}");`,
  "if(f)f.hidden=true;",
  "if(g)g.hidden=false;",
  "})();",
].join("");

type GuardWindow = Window & { [SHOWCASE_GUARD_FLAG]?: boolean };

// 앱 번들 경로. 인라인 스크립트와 같은 순서(가드 → 표시 → 드러내기)로 한다. 중복 설치하지 않는다.
export function installShowcaseGuard(win: Window) {
  const w = win as GuardWindow;
  const doc = w.document;
  if (!w[SHOWCASE_GUARD_FLAG]) {
    const root = doc.documentElement;
    w.addEventListener("pagehide", (event) => { if (event.persisted) root.style.visibility = "hidden"; });
    w.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      root.style.visibility = "hidden";
      w.location.reload();
    });
    w[SHOWCASE_GUARD_FLAG] = true;
  }
  const fallback = doc.getElementById(SHOWCASE_FALLBACK_ID);
  const gated = doc.getElementById(SHOWCASE_GATED_ID);
  if (fallback) fallback.hidden = true;
  if (gated) gated.hidden = false;
}
