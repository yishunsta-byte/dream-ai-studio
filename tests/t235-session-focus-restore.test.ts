import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// T-235(F234-2) 같은 계정 복귀 때 포커스 돌려주기.
// 결함: 돌려줄 대상을 focus 이벤트(onFocus)로만 기억해서, 창이 포커스를 갖지 않을 때(document.hasFocus()=false)
// 이벤트가 오지 않아 대상이 비고 복귀 뒤 activeElement가 BODY가 됐다(Tester 실측, 이 저장소 기준 재현 tmp/t235-baseline.json).
// 이 저장소의 vitest는 node 환경이라 DOM 동작은 실제 브라우저 하네스(tests/t235-focus-browser.ego.js)로 확인한다.
// 여기서는 그 동작을 지키는 코드 순서·조건이 빠지지 않았는지만 고정한다(이것만으로 PASS 판정하지 않는다).
const source = readFileSync("components/auth/session-boundary.tsx", "utf8");
const effect = source.slice(source.indexOf("useLayoutEffect(() => {"), source.indexOf("}, [shown, boundary]);"));
const hideStart = effect.indexOf("if (!shown) {"), hideEnd = effect.indexOf("return;", hideStart);
const hideBranch = effect.slice(hideStart, hideEnd);
const restore = effect.slice(hideEnd);

describe("T-235 가릴 때: 실제 포커스 요소를 기억한 뒤 안내로 옮긴다", () => {
  it("본문 안 activeElement를 lastFocus에 직접 저장하고, 그 다음에 안내로 포커스를 옮긴다", () => {
    const remember = hideBranch.indexOf("if (inBody && active instanceof HTMLElement) lastFocus.current = active;");
    expect(remember).toBeGreaterThan(-1);
    expect(remember).toBeLessThan(hideBranch.indexOf("notice.current?.focus()"));
  });
  it("본문 밖 요소(다른 컨트롤)는 기억하지 않는다", () => {
    expect(hideBranch).toMatch(/const inBody = !!active && !!body\.current\?\.contains\(active\);/);
  });
});

describe("T-235 복귀 때: 빼앗지 않고 안전한 경우에만 돌려준다", () => {
  it("대상이 아직 문서·본문 안에 있고, 지금 포커스가 BODY(안내가 사라져 잃은 경우)일 때만", () => {
    expect(restore).toMatch(/moved\.current && target && target\.isConnected && body\.current\?\.contains\(target\) && \(!active \|\| active === document\.body\)/);
  });
  it("포커스가 실제로 옮겨졌을 때만 화면 밖이면 보이는 곳까지 스크롤", () => {
    expect(restore).toMatch(/target\.focus\(\{ preventScroll: true \}\)/);
    expect(restore).toMatch(/document\.activeElement === target && \(box\.bottom > window\.innerHeight \|\| box\.top < 0\)\) target\.scrollIntoView\(\{ block: "nearest" \}\)/);
    expect(restore).toMatch(/moved\.current = false;/);
  });
  it("확정(cleared)이면 본문을 그리지 않으므로 늦은 same으로 되살릴 대상이 없다", () => {
    expect(source).toMatch(/\{!boundary\.cleared && <div ref=\{body\} data-protected-content=""/);
  });
});
