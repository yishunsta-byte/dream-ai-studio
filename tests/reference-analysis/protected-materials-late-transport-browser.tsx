// 보호 목록 화면의 늦은 성공 응답 시험용 브라우저 진입점(서버·DB 없음, 합성 자료만).
// 기존 transport 주입 지점에 시험 대역을 넣는다: 목록 요청을 기록하고, 취소 신호는 기록만 하며 거절하지 않는다(취소 뒤에도 성공을 돌려줄 수 있음).
// 세션 경계 값은 시험용으로 공개된 SessionBoundaryContext로 직접 바꾼다(view·epoch). window.__fixture로 조작한다.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionBoundaryContext } from "../../components/auth/session-boundary";
import { StudioProtectedMaterialsAnalysis } from "../../components/reference-analysis/studio-protected-materials-analysis";
import "../../app/globals.css";

type Entry = { id: number; uri: string; method: string; aborted: boolean; settled: boolean; bodyRead: number; resolve: (materials: unknown[]) => void };
type BoundaryState = { view: "current" | "checking"; epoch: number };
const requests: Entry[] = [];
type Transport = Parameters<typeof StudioProtectedMaterialsAnalysis>[0]["transport"];
// 목록·분석 응답 모양을 함께 만족하는 응답 하나(ok·status·json·body)를 돌려준다.
const transport = ((uri: string, init: RequestInit) => new Promise((resolve) => {
  const entry: Entry = { id: requests.length + 1, uri, method: String(init.method), aborted: false, settled: false, bodyRead: 0, resolve: (materials) => {
    entry.settled = true;
    resolve({ ok: true, status: 200, json: async () => { entry.bodyRead++; return { materials }; }, body: null });
  } };
  init.signal?.addEventListener("abort", () => { entry.aborted = true; });
  requests.push(entry);
})) as unknown as Transport;
const fixture = {
  requests: () => requests.map(({ id, uri, method, aborted, settled, bodyRead }) => ({ id, uri, method, aborted, settled, bodyRead })),
  resolve: (id: number, materials: unknown[]) => requests[id - 1].resolve(materials),
  setBoundary: (() => {}) as (value: BoundaryState) => void,
};
(window as unknown as { __fixture: typeof fixture }).__fixture = fixture;

function App() {
  const [boundary, setBoundary] = useState<BoundaryState>({ view: "current", epoch: 0 });
  useEffect(() => { fixture.setBoundary = setBoundary; }, []);
  const value = useMemo(() => ({ ...boundary, cleared: false, retry: () => {}, setPaused: () => {} }), [boundary]);
  return <SessionBoundaryContext.Provider value={value}>
    <StudioProtectedMaterialsAnalysis listUri="/test-only/materials" analyzeUri="/test-only/analysis" transport={transport} timeoutMs={600_000} />
  </SessionBoundaryContext.Provider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<App />);
