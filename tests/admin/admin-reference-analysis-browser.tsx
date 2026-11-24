// 관리자 콘텐츠 분석·공개 화면 브라우저 시험 진입점(서버·DB 없음, 합성 응답만).
// 화면의 client 주입 지점에 시험 대역 전송을 넣는다. 요청을 기록하고, 응답은 window.__fixture.reply로 시험이 직접 준다.
import { createRoot } from "react-dom/client";
import { AdminReferenceAnalysis } from "../../components/admin/admin-reference-analysis";
import { createAdminReferenceAnalysisClient, type AdminTransport } from "../../components/admin/admin-reference-analysis-model";
import "../../app/globals.css";

type Entry = { uri: string; method: string; body: unknown; aborted: boolean; done: boolean; respond: (status: number, body?: unknown) => void };
const requests: Entry[] = [];
const transport: AdminTransport = (uri, init) => new Promise((resolve) => {
  const entry: Entry = { uri, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null, aborted: false, done: false,
    respond: (status, body) => { entry.done = true; resolve({ status, json: async () => { if (body === undefined) throw new SyntaxError("empty"); return body; } }); } };
  init.signal?.addEventListener("abort", () => { entry.aborted = true; });
  requests.push(entry);
});
let ids = 0;
(window as unknown as { __fixture: unknown }).__fixture = {
  requests: () => requests.map(({ uri, method, body, aborted, done }) => ({ uri, method, body, aborted, done })),
  reply: (index: number, status: number, body?: unknown) => requests[index].respond(status, body),
};
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<AdminReferenceAnalysis client={createAdminReferenceAnalysisClient(transport)}
  newRequestId={() => `10000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`} />);
