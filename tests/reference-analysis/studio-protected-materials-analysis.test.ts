import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  loadProtectedMaterials, neutralMaterials, noticeFor, ProtectedMaterialsView, revocationAware, StudioProtectedMaterialsAnalysis,
  type ProtectedMaterialsState, type ProtectedMaterialsTransport,
} from "../../components/reference-analysis/studio-protected-materials-analysis";
import type { RegisteredAnalysisProvider } from "../../components/reference-analysis/studio-registered-analysis";

// 보호 목록(7514ad0) → 기존 등록 자료 분석 화면 격리 어댑터. 합성 자료만 쓴다.
const a = { projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012", label: "등록 이미지 ·00000012" };
const b = { projectId: "10000000-0000-4000-8000-000000000021", assetId: "10000000-0000-7000-8000-000000000022", label: "SYNTHETIC-PRIVATE-LABEL" };
const secrets = [a.projectId, a.assetId, a.label, b.projectId, b.assetId, b.label, "00000012"];
const reply = (status: number, body?: unknown) => {
  const cancel = vi.fn(async () => {});
  return { status, json: async () => body, body: { cancel } };
};
const transportOf = (response: ReturnType<typeof reply> | Error) =>
  vi.fn<ProtectedMaterialsTransport>(async () => { if (response instanceof Error) throw response; return response; });
const load = (transport: ProtectedMaterialsTransport, signal = new AbortController().signal, timeoutMs = 1000) =>
  loadProtectedMaterials({ uri: "/test/materials", transport, signal, timeoutMs });

describe("보호 목록 응답 판정", () => {
  it("200이면 현재 목록 순서대로 중립 이름을 붙이고, 요청은 GET·no-store·같은 출처·리다이렉트 금지다", async () => {
    const transport = transportOf(reply(200, { materials: [a, b] }));
    const state = await load(transport);
    expect(state).toEqual({ kind: "ready", materials: [
      { projectId: a.projectId, assetId: a.assetId, label: "등록 자료 1" },
      { projectId: b.projectId, assetId: b.assetId, label: "등록 자료 2" },
    ] });
    expect(transport).toHaveBeenCalledWith("/test/materials", expect.objectContaining({
      method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: expect.any(AbortSignal),
    }));
  });

  it("빈 배열은 빈 목록, 401은 재로그인, 403은 접근 제한, 503·204·그 밖은 실패다(본문은 읽지 않고 버린다)", async () => {
    expect(await load(transportOf(reply(200, { materials: [] })))).toEqual({ kind: "ready", materials: [] });
    for (const [status, kind] of [[401, "login"], [403, "forbidden"], [503, "failed"], [204, "failed"], [500, "failed"], [302, "failed"]] as const) {
      const response = reply(status, { code: "X", materials: [a] });
      const json = vi.spyOn(response, "json");
      expect(await load(transportOf(response))).toEqual({ kind });
      expect(json).not.toHaveBeenCalled();
      expect(response.body.cancel).toHaveBeenCalledOnce();
    }
  });

  it("연결 실패·형식 오류·중복·추가 칸·잘못된 ID·빈 이름은 모두 실패로 닫는다", async () => {
    expect(await load(transportOf(new TypeError("network")))).toEqual({ kind: "failed" });
    for (const body of [null, [], {}, { materials: {} }, { materials: [a], extra: 1 }, { materials: [a, a] },
      { materials: [{ ...a, assetId: a.assetId.toUpperCase() }, a] }, { materials: [{ ...a, path: "/private" }] },
      { materials: [{ ...a, projectId: "not-a-guid" }] }, { materials: [{ ...a, label: " " }] }, { materials: [null] }]) {
      expect(neutralMaterials(body), JSON.stringify(body)).toBeUndefined();
      expect(await load(transportOf(reply(200, body)))).toEqual({ kind: "failed" });
    }
  });

  it("취소되거나 시간이 지나면 실패로 끝나고, 늦게 온 본문은 반영하지 않는다", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const transport: ProtectedMaterialsTransport = async () => ({ status: 200, json: () => new Promise((resolve) => { release = () => resolve({ materials: [a] }); }) });
    const pending = load(transport, controller.signal);
    await Promise.resolve();
    controller.abort();
    release();
    expect(await pending).toEqual({ kind: "failed" });
    const slow: ProtectedMaterialsTransport = (_uri, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    expect(await load(slow, new AbortController().signal, 20)).toEqual({ kind: "failed" });
  });

  it("취소를 무시하고 늦게 성공을 돌려주는 전송도 취소 뒤면 실패로 닫고, 취소 전 성공은 목록으로 받는다", async () => {
    // 시험 대역: 취소 신호를 기록만 하고 거절하지 않는다. 응답은 시험이 직접 풀어 준다.
    const double = () => {
      const seen = { aborted: false, bodyRead: 0 };
      let respond!: () => void;
      const transport: ProtectedMaterialsTransport = (_uri, init) => new Promise((resolve) => {
        init.signal?.addEventListener("abort", () => { seen.aborted = true; });
        respond = () => resolve({ status: 200, json: async () => { seen.bodyRead++; return { materials: [a] }; }, body: null });
      });
      return { transport, seen, respond: () => respond() };
    };
    const late = double();
    const controller = new AbortController();
    const pending = load(late.transport, controller.signal);
    await Promise.resolve();
    controller.abort();
    late.respond();
    expect(await pending).toEqual({ kind: "failed" });
    expect(late.seen).toEqual({ aborted: true, bodyRead: 1 });

    const normal = double();
    const ok = load(normal.transport);
    await Promise.resolve();
    normal.respond();
    expect(await ok).toEqual({ kind: "ready", materials: [{ projectId: a.projectId, assetId: a.assetId, label: "등록 자료 1" }] });
    expect(normal.seen).toEqual({ aborted: false, bodyRead: 1 });
  });
});

describe("철회 감지", () => {
  const ready = { schemaVersion: 1, status: "ready", media: "image", proposals: [] } as never;
  const unavailable = (reason: string) => ({ schemaVersion: 1, status: "unavailable", reason }) as never;
  it("단건 분석이 자료 접근 불가·선택 무효면 목록 재조회를 한 번 알리고 결과는 그대로 돌려준다", async () => {
    for (const [result, fires] of [[unavailable("source_unavailable"), 1], [unavailable("invalid_selection"), 1],
      [unavailable("analysis_unavailable"), 0], [unavailable("timed_out"), 0], [unavailable("cancelled"), 0], [ready, 0]] as const) {
      const onRevoked = vi.fn();
      const base: RegisteredAnalysisProvider = { materials: [], analyze: vi.fn(async () => result) };
      const wrapped = revocationAware(base, onRevoked);
      expect(await wrapped.analyze({ projectId: a.projectId, assetId: a.assetId }, new AbortController().signal)).toBe(result);
      expect(onRevoked).toHaveBeenCalledTimes(fires);
    }
  });

  it("사용자가 이미 취소한 요청의 응답으로는 재조회하지 않는다", async () => {
    const onRevoked = vi.fn();
    const controller = new AbortController();
    const wrapped = revocationAware({ materials: [], analyze: async () => { controller.abort(); return unavailable("source_unavailable"); } }, onRevoked);
    await wrapped.analyze({ projectId: a.projectId, assetId: a.assetId }, controller.signal);
    expect(onRevoked).not.toHaveBeenCalled();
  });
});

describe("상태별 화면", () => {
  const ready = (materials: readonly { projectId: string; assetId: string; label: string }[]): ProtectedMaterialsState => ({ kind: "ready", materials });
  const provider = (materials: RegisteredAnalysisProvider["materials"]): RegisteredAnalysisProvider => ({ materials, analyze: vi.fn() });
  const render = (state: ProtectedMaterialsState, revoked = false) => {
    const listed = state.kind === "ready" ? state.materials : [];
    return renderToStaticMarkup(createElement(ProtectedMaterialsView, {
      state, notice: noticeFor(state, revoked), provider: state.kind === "ready" ? provider(listed) : undefined, loginHref: "/login?next=%2Fcloud%2Freference-analysis",
    }));
  };
  const named = neutralMaterials({ materials: [a, b] })!;

  it("자료가 있으면 기존 분석 화면에 중립 이름만 보이고 ID·서버 이름은 어디에도 없다", () => {
    const html = render(ready(named));
    expect(html).toContain(">등록 자료 1</option>");
    expect(html).toContain(">등록 자료 2</option>");
    expect(html).toContain("등록 자료 분석</h2>");
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>분석 실행/);
    for (const secret of secrets) expect(html).not.toContain(secret);
  });

  it.each([
    ["빈 목록", ready([]), false, ["분석할 수 있는 등록 자료가 없어요.", ">목록 다시 조회</button>", 'href="/cloud/projects"'], false],
    ["철회 뒤 남은 자료", ready(named.slice(1)), true, ["선택한 자료에 접근할 수 없어요.", "이전 선택과 결과는 표시하지 않아요."], true],
    ["철회 뒤 남은 자료 없음", ready([]), true, ["분석할 수 있는 등록 자료가 없어요."], false],
    ["401", { kind: "login" }, false, ["다시 로그인해 주세요.", 'href="/login?next=%2Fcloud%2Freference-analysis">다시 로그인</a>'], false],
    ["403", { kind: "forbidden" }, false, ["이 화면에 접근할 수 없어요."], false],
    ["503·연결 실패", { kind: "failed" }, false, ["등록 자료를 불러오지 못했어요.", ">목록 다시 조회</button>"], false],
    ["불러오는 중", { kind: "loading" }, false, ["등록 자료 목록을 불러오고 있어요."], false],
  ] as const)("%s", (_name, state, revoked, texts, showsAnalysis) => {
    const html = render(state as ProtectedMaterialsState, revoked);
    for (const text of texts) expect(html).toContain(text);
    expect(html.includes("등록 자료 분석</h2>")).toBe(showsAnalysis);
    expect(html.includes("<option")).toBe(showsAnalysis);
    for (const secret of secrets) expect(html).not.toContain(secret);
    if (!showsAnalysis) expect(html).not.toMatch(/분석 실행|분석 결과/);
    // 같은 안내가 두 번 나오지 않는다(빈 목록일 때 기존 화면 안내와 겹치지 않음).
    expect(html.split(texts[0]).length - 1).toBe(1);
  });

  it("403에는 다시 조회·재로그인 버튼이 없고, 철회 안내에는 다른 동작이 없다", () => {
    expect(render({ kind: "forbidden" })).not.toMatch(/다시 조회|다시 로그인/);
    expect(render(ready(named.slice(1)), true)).not.toMatch(/목록 다시 조회|다시 로그인|내 프로젝트 열기/);
  });

  it("다시 조회를 시작할 때 숨겨진 안내에 바로 초점을 주지 않고, 안내가 그려진 뒤 효과에서 옮긴다(09735c9 검수 결함)", () => {
    const source = readFileSync("components/reference-analysis/studio-protected-materials-analysis.tsx", "utf8");
    const reload = source.slice(source.indexOf("const reload = useCallback"), source.indexOf("useEffect(() => {"));
    expect(reload).not.toContain(".focus()");
    expect(source).toContain('if (view.state.kind === "loading") { noticeRef.current?.focus(); return; }');
    expect(source).toContain("if (!view.focus || !focusAfter.current) return;");
  });

  it("서버 렌더에서는 목록을 요청하지 않고 불러오는 중 안내만 그린다(자료 데이터 없음)", () => {
    const transport = vi.fn<ProtectedMaterialsTransport>();
    const html = renderToStaticMarkup(createElement(StudioProtectedMaterialsAnalysis, {
      listUri: "/test/materials", analyzeUri: "/test/analyze", transport: transport as never, timeoutMs: 1000,
    }));
    expect(transport).not.toHaveBeenCalled();
    expect(html).toContain("등록 자료 목록을 불러오고 있어요.");
    expect(html).not.toContain("<select");
  });
});
