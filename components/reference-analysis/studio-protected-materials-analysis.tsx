"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useSessionBoundary } from "@/components/auth/session-boundary";
import { createStudioRegisteredAnalysisProvider } from "./studio-registered-analysis-provider";
import { StudioRegisteredAnalysis, type RegisteredAnalysisProvider, type RegisteredAnalysisResult } from "./studio-registered-analysis";
import styles from "./studio-protected-materials-analysis.module.css";

/**
 * 보호 목록(7514ad0 GET 계약) → 기존 등록 자료 분석 화면을 잇는 격리 조립용 클라이언트 어댑터.
 * 운영 보호 셸(T317)에는 아직 연결하지 않는다. 목록·분석 요청 수단은 주입받는다.
 * 화면에는 현재 목록 안에서만 구분하는 중립 이름(등록 자료 1…)만 쓰고, projectId·assetId·서버 label은 표시하지 않는다.
 * 세션 방어(2f77c62 G1·G2):
 * - 분석 POST 401·403: 목록 GET 401·403과 같은 ‘다시 로그인’·‘접근 불가’ 상태로 바꾸고 선택·권리 확인·결과·초안을 지운다.
 * - 공통 SessionBoundary 안이면 그 epoch가 바뀔 때(다른 탭 알림·복원) 진행 중 목록·분석을 취소하고 목록·선택·결과·초안을 지운다.
 *   경계가 현재 계정을 다시 확인(view=current)한 뒤에만 목록을 새로 받으므로, 새 선택은 확인된 상태에서만 생긴다.
 *   경계 밖(null)이면 이전과 같다. 서버 권한 판정·공통 세션 구현은 바꾸지 않는다.
 */

type ListResponse = Pick<Response, "status" | "json"> & { body?: Pick<ReadableStream, "cancel"> | null };
export type ProtectedMaterialsTransport = (uri: string, init: RequestInit) => Promise<ListResponse>;
type Material = RegisteredAnalysisProvider["materials"][number];

export type ProtectedMaterialsState =
  | { kind: "loading" }
  | { kind: "ready"; materials: readonly Material[] }
  | { kind: "login" | "forbidden" | "failed" };

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function discard(response: ListResponse) {
  try { void response.body?.cancel().catch(() => {}); } catch { /* 주입된 전송이 취소 중 바로 실패할 수 있다. */ }
}

/** 목록 응답 본문을 검사하고 중립 이름을 붙인다. 형식이 하나라도 틀리거나 중복이면 실패로 본다. */
export function neutralMaterials(body: unknown): readonly Material[] | undefined {
  if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || !Array.isArray((body as { materials?: unknown }).materials)) return;
  const rows = (body as { materials: unknown[] }).materials;
  const seen = new Set<string>();
  const materials: Material[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return;
    const { projectId, assetId, label, ...rest } = row as Record<string, unknown>;
    if (Object.keys(rest).length || typeof projectId !== "string" || typeof assetId !== "string" || typeof label !== "string" ||
      !guid.test(projectId) || !guid.test(assetId) || !label.trim()) return;
    const key = `${projectId.toLowerCase()}/${assetId.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    materials.push({ projectId: projectId.toLowerCase(), assetId: assetId.toLowerCase(), label: `등록 자료 ${materials.length + 1}` });
  }
  return materials;
}

/** 보호 목록 GET 한 번. 401·403·그 밖(503·204·연결 실패·형식 오류·시간 초과)을 화면 상태로 나눈다. */
export async function loadProtectedMaterials({ uri, transport, signal, timeoutMs }: {
  uri: string; transport: ProtectedMaterialsTransport; signal: AbortSignal; timeoutMs: number;
}): Promise<Exclude<ProtectedMaterialsState, { kind: "loading" }>> {
  const request = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const response = await transport(uri, {
      method: "GET", headers: { Accept: "application/json" }, signal: request,
      cache: "no-store", credentials: "same-origin", redirect: "error",
    });
    if (response.status !== 200) {
      discard(response);
      if (response.status === 401) return { kind: "login" };
      if (response.status === 403) return { kind: "forbidden" };
      return { kind: "failed" };
    }
    const materials = neutralMaterials(await response.json());
    request.throwIfAborted();
    return materials ? { kind: "ready", materials } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** 단건 분석이 "자료에 접근할 수 없음/선택이 유효하지 않음"이면 목록을 다시 받도록 알린다. */
export function revocationAware(provider: RegisteredAnalysisProvider, onRevoked: () => void): RegisteredAnalysisProvider {
  return {
    materials: provider.materials,
    async analyze(selection, signal) {
      const result: RegisteredAnalysisResult = await provider.analyze(selection, signal);
      if (!signal.aborted && result.status === "unavailable" && (result.reason === "source_unavailable" || result.reason === "invalid_selection")) onRevoked();
      return result;
    },
  };
}

const copy = {
  loading: ["등록 자료 목록을 불러오고 있어요.", ""],
  empty: ["분석할 수 있는 등록 자료가 없어요.", "내 프로젝트에서 등록 자료를 확인한 뒤 목록을 다시 조회해 주세요."],
  revoked: ["선택한 자료에 접근할 수 없어요.", "이전 선택과 결과는 표시하지 않아요. 남은 자료를 새로 선택해 주세요."],
  login: ["다시 로그인해 주세요.", "로그인을 확인할 수 없어 등록 자료 목록을 지웠어요."],
  forbidden: ["이 화면에 접근할 수 없어요.", "클라우드 작업실 계정과 접근 권한을 확인해 주세요."],
  failed: ["등록 자료를 불러오지 못했어요.", "잠시 뒤 목록을 다시 조회해 주세요. 같은 문제가 계속되면 운영 담당자에게 화면 문구와 발생 시각을 알려 주세요."],
} as const;

type Notice = keyof typeof copy | null;

export function noticeFor(state: ProtectedMaterialsState, revoked: boolean): Notice {
  if (state.kind === "loading") return "loading";
  if (state.kind !== "ready") return state.kind;
  if (revoked) return state.materials.length ? "revoked" : "empty";
  return state.materials.length ? null : "empty";
}

/** 상태를 받아 그리는 부분. 목록이 비었거나 실패면 기존 분석 화면(선택·결과)을 아예 그리지 않는다. */
export function ProtectedMaterialsView({ state, notice, provider, loginHref, onReload, noticeRef }: {
  state: ProtectedMaterialsState; notice: Notice; provider?: RegisteredAnalysisProvider; loginHref: string;
  onReload?: () => void; noticeRef?: React.Ref<HTMLDivElement>;
}) {
  const id = useId();
  const [title, detail] = notice ? copy[notice] : ["", ""];
  const tone = notice === "login" || notice === "forbidden" || notice === "failed" || notice === "revoked" ? styles.alert : styles.neutral;
  return <div className={styles.adapter}>
    <div className={`${styles.notice} ${notice ? tone : ""}`} ref={noticeRef} tabIndex={-1} role={notice === "loading" || !notice ? "status" : "alert"}
      aria-labelledby={notice ? `${id}-title` : undefined} hidden={!notice}>
      {notice && <>
        <p id={`${id}-title`} className={styles.title}>{title}</p>
        {detail && <p>{detail}</p>}
      </>}
    </div>
    {notice && notice !== "loading" && notice !== "revoked" && <div className={styles.actions}>
      {notice === "login" && <Link className={styles.primary} href={loginHref}>다시 로그인</Link>}
      {(notice === "failed" || notice === "empty") && <button className={styles.primary} type="button" onClick={onReload}>목록 다시 조회</button>}
      {notice === "empty" && <Link className={styles.secondary} href="/cloud/projects">내 프로젝트 열기</Link>}
    </div>}
    {state.kind === "ready" && state.materials.length > 0 && provider && <StudioRegisteredAnalysis provider={provider} requireRightsConfirmation />}
  </div>;
}

export function StudioProtectedMaterialsAnalysis({ listUri, analyzeUri, transport, timeoutMs, loginHref = "/login?next=%2Fcloud%2Freference-analysis" }: {
  listUri: string; analyzeUri: string; transport: ProtectedMaterialsTransport & Parameters<typeof createStudioRegisteredAnalysisProvider>[0]["transport"];
  timeoutMs: number; loginHref?: string;
}) {
  const [view, setView] = useState<{ state: ProtectedMaterialsState; provider?: RegisteredAnalysisProvider; revoked: boolean; focus: number }>(
    { state: { kind: "loading" }, revoked: false, focus: 0 });
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef(false);
  const boundary = useSessionBoundary();
  const epoch = boundary?.epoch ?? 0;
  const live = !boundary || boundary.view === "current";
  const seenEpoch = useRef(epoch);
  const staleEpoch = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;

  // 분석 POST가 401·403이면 그 목록 세대에서 한 번만 로그인·접근 불가 상태로 바꾼다(목록·선택·결과를 함께 지움).
  const deny = useCallback((mine: number, status: 401 | 403) => {
    if (mine !== generation.current) return;
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    focusAfter.current = true;
    setView(current => ({ state: { kind: status === 401 ? "login" : "forbidden" }, revoked: false, focus: current.focus + 1 }));
  }, []);

  // 목록을 받아 반영한다. 상태는 응답이 온 뒤에만 바꾸고, 그사이 새 조회가 시작됐으면 버린다.
  const fetchList = useCallback(async (revoked: boolean, again: (reason: "revoked") => void) => {
    const mine = ++generation.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const next = await loadProtectedMaterials({ uri: listUri, transport, signal: controller.signal, timeoutMs });
    if (mine !== generation.current || controller.signal.aborted) return;
    inFlight.current = null;
    let provider: RegisteredAnalysisProvider | undefined;
    if (next.kind === "ready") {
      let fired = false;
      provider = revocationAware(createStudioRegisteredAnalysisProvider({ materials: next.materials, uri: analyzeUri, transport, timeoutMs,
        onDenied: (status) => deny(mine, status) }),
        () => { if (!fired && mine === generation.current) { fired = true; again("revoked"); } });
    }
    setView(current => ({ state: next, provider, revoked, focus: current.focus + 1 }));
  }, [listUri, analyzeUri, transport, timeoutMs, deny]);

  // 사용자 조작·철회로 다시 조회할 때: 기존 목록·선택·결과를 즉시 지우고 안내에 초점을 둔다.
  const reload = useCallback(function reload(reason: "user" | "revoked") {
    // 안내는 아직 숨겨져 있을 수 있으므로(철회 직전엔 안내 없음) 초점은 안내가 그려진 뒤 효과에서 옮긴다.
    setView(current => ({ state: { kind: "loading" }, revoked: reason === "revoked", focus: current.focus + 1 }));
    focusAfter.current = true;
    void fetchList(reason === "revoked", reload);
  }, [fetchList]);

  useEffect(() => {
    const generations = generation;
    // 경계가 확인 중일 때 처음 그려지면(레이아웃 유지 이동 등) 목록을 받지 않고, 같은 계정 확인(current) 뒤 아래 효과에서 한 번 받는다.
    if (liveRef.current) void fetchList(false, reload);
    else staleEpoch.current = true;
    return () => { generations.current++; inFlight.current?.abort(); };
  }, [fetchList, reload]);

  // 세션 세대가 바뀌면(경계가 의심 상태로 들어감) 진행 중 목록을 버리고 목록·공급자를 비운다.
  // 공급자가 사라지면 분석 화면이 내려가며 진행 중 분석을 취소하고, 늦게 온 응답·선택·권리 확인·결과·초안은 다시 그리지 않는다.
  useLayoutEffect(() => {
    if (epoch === seenEpoch.current) return;
    seenEpoch.current = epoch;
    staleEpoch.current = true;
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setView(current => ({ state: { kind: "loading" }, revoked: false, focus: current.focus }));
  }, [epoch]);

  // 경계가 같은 계정을 확인한 뒤에만 새 목록을 받는다. 가려진 동안 초점을 잃었으면 안내→자료 선택으로 되돌린다.
  useEffect(() => {
    if (!live || !staleEpoch.current) return;
    staleEpoch.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) focusAfter.current = true;
    void fetchList(false, reload);
  }, [live, epoch, fetchList, reload]);

  const notice = noticeFor(view.state, view.revoked);

  useLayoutEffect(() => {
    if (!view.focus || !focusAfter.current) return;
    // 다시 조회 중: 방금 그려진 ‘불러오는 중’ 안내로. 첫 진입(focusAfter 꺼짐)에서는 초점을 가져가지 않는다.
    if (view.state.kind === "loading") { noticeRef.current?.focus(); return; }
    focusAfter.current = false;
    // 철회 뒤나 안내 없이 목록이 생긴 경우엔 바로 고르도록 자료 선택으로, 아니면 안내로 초점을 옮긴다.
    const select = rootRef.current?.querySelector<HTMLSelectElement>("select:not(:disabled)");
    if (select && (view.revoked || !noticeFor(view.state, view.revoked))) select.focus();
    else noticeRef.current?.focus();
  }, [view]);

  return <div ref={rootRef}>
    <ProtectedMaterialsView state={view.state} notice={notice} provider={view.provider} loginHref={loginHref}
      onReload={() => reload("user")} noticeRef={noticeRef} />
  </div>;
}
