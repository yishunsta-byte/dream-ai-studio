"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import {
  STAGE_LABEL, allowedCommands, applyOutcome, buildAction, isPublicationItem, isPublicationOutcome, outcomeNotice, revokeTarget, stageOf,
  type Notice, type PublicationAction, type PublicationCommand, type PublicationItem, type PublicationList, type PublicationOutcome, type PublicationStage,
} from "./publication-model";
import styles from "./publication-queue.module.css";

// T289 관리자 완성본 검수·게시·철회 큐(첫 세로 단위). 화면은 공급자가 준 목록과 결과만 그린다.
// - source="synthetic"이면 모든 곳에 합성 시험 데이터라고 표시한다(운영 작품처럼 보이지 않게).
// - 닫힌 공급자(list → closed)는 "게시 서버 미연결"만 보이고 어떤 버튼도 만들지 않는다.
// - 준비·게시는 "권리 확인" 체크 뒤에만, 철회는 확인 단계를 한 번 더 거친다. 요청은 대상 버전·세대를 고정한다.
// - 결과가 처리 못 함(unavailable)이면 같은 요청 UUID로만 다시 보낼 수 있다(중복 게시 방지).
// - T289-F1: 목록 조회와 쓰기는 서로 배타적이다. 조회 중에는 체크·동작을 막고, 쓰기 중에는 조회를 막는다.
//   그래도 늦게 도착한 목록은 조회 순번·쓰기 순번·공급자 세대가 모두 같을 때만 반영한다(createSyncGate).
//   명시 새로고침은 처리 미확정(같은 UUID 재시도) 상태를, 그 줄의 버전이 그대로일 때 보존한다(rowsAfterList).
// - T289-F2: 목록 조회 실패는 미확정 요청을 지우지 않는다(rowsAfterFailedLoad). 지우는 것은 권위 있는 새 버전·삭제(목록에서 빠짐)와
//   실제 공급자 교체(load·apply 변경)뿐이다. initial만 바뀌어도 화면 세대(view)를 올려 이전 조회 응답이 새 화면을 덮지 않게 한다.
// - T289-F3: 진행 중 쓰기 잠금은 목록 줄 상태와 분리한다(inflight 맵 + writes 상태). 줄이 목록에서 빠져도 응답 전까지
//   조회·같은 줄 쓰기를 막는다. 늦게 온 미확정 결과는 최신 권위 목록의 같은 줄·같은 버전일 때만 재시도로 남긴다(retryDecision).
export type PublicationQueueProps = Readonly<{
  source: "server" | "synthetic";
  initial: PublicationList;
  load: () => Promise<PublicationList>;
  apply: (action: PublicationAction) => Promise<PublicationOutcome>;
  newRequestId?: () => string;
  now?: () => number;
}>;

export type Row = { rights: boolean; confirmRevoke: boolean; notice: Notice | null; retry: PublicationAction | null; retryBase: string | null; stale: boolean };
const EMPTY_ROW: Row = { rights: false, confirmRevoke: false, notice: null, retry: null, retryBase: null, stale: false };
const PILL: Record<PublicationStage, "queued" | "approval" | "done"> = { candidate: "queued", prepared: "approval", published: "done", republishing: "done" };
const KIND = { image: "이미지", video: "영상", music: "음악" } as const;
const COMMAND = { prepare: "게시 준비", complete: "게시", revoke: "철회" } as const;

export type QueueView = { kind: "closed" } | { kind: "failed" } | { kind: "ok"; items: PublicationItem[] };
type View = QueueView;
function toView(list: PublicationList): View {
  if (list.kind !== "ok") return { kind: list.kind };
  // 한 줄이라도 계약에 맞지 않으면 목록 전체를 믿지 않는다(일부만 그려 운영 상태를 잘못 보이지 않게).
  if (!Array.isArray(list.items) || !list.items.every(isPublicationItem)) return { kind: "failed" };
  const slugs = new Set(list.items.map((item) => item.slug));
  return slugs.size === list.items.length ? { kind: "ok", items: [...list.items] } : { kind: "failed" };
}
const fallbackId = () => crypto.randomUUID();
// T289-F4: 줄 상태·진행 쓰기는 slug로 찾는다. 허용 주소 이름(예: constructor)이 객체의 상속 속성을 읽지 않도록 자체 키만 인정한다.
export function ownEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

// 조회·쓰기 순서 판정(순수).
// - provider: 실제 공급자(load·apply) 교체 때만 오른다. 쓰기 응답은 이 세대가 같을 때만 반영한다.
// - view: 화면을 새로 시작할 때마다(공급자 교체·initial 교체) 오른다. 조회 응답은 이 세대까지 같아야 반영한다.
export type LoadTicket = Readonly<{ load: number; writes: number; provider: number; view: number }>;
export function createSyncGate() {
  let provider = 0, view = 0, loads = 0, writesStarted = 0, inflight = 0;
  let source: { load: unknown; apply: unknown } | null = null;
  return {
    // 화면 재시작 신호. load·apply가 바뀌었으면 공급자 교체, 아니면 initial만 바뀐 화면 재시작이다.
    restart(load: unknown, apply: unknown): boolean {
      const swapped = !source || source.load !== load || source.apply !== apply;
      if (swapped) { provider++; inflight = 0; source = { load, apply }; }
      view++;
      return swapped;
    },
    viewNow: () => view,
    beginWrite() { writesStarted++; inflight++; return provider; },
    endWrite(ticketProvider: number) { if (ticketProvider !== provider) return false; inflight = Math.max(0, inflight - 1); return true; },
    beginLoad(): LoadTicket { loads++; return { load: loads, writes: writesStarted, provider, view }; },
    // 가장 최근 조회이고, 조회 뒤 시작된 쓰기·진행 중 쓰기가 없고, 공급자·화면 세대가 그대로일 때만 반영한다.
    accepts: (t: LoadTicket) => t.load === loads && t.writes === writesStarted && inflight === 0 && t.provider === provider && t.view === view,
  };
}

// 권위 있는 목록을 받았을 때 줄 상태 정리(순수).
// - 처리 미확정 재시도는 그 줄의 버전이 재시도 당시와 같을 때만 같은 요청·안내와 함께 남긴다.
// - 버전이 바뀌었거나 줄이 빠졌으면(서버가 처리했거나 다른 변경·삭제) 지운다. 그 밖의 상태는 초기화한다.
export function rowsAfterList(rows: Readonly<Record<string, Row>>, items: readonly PublicationItem[]): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (const item of items) {
    const row = ownEntry(rows, item.slug);
    if (row?.retry && row.retryBase === item.version) out[item.slug] = { ...EMPTY_ROW, retry: row.retry, retryBase: row.retryBase, notice: row.notice };
  }
  return out;
}

// 목록 조회 실패(순수): 권위 있는 정보가 없으므로 미확정 요청을 지우지 않는다. 권리 체크 등 임시 상태만 지운다.
// (진행 중 쓰기 잠금은 줄 상태가 아니라 화면의 inflight·writes가 가진다.)
export function rowsAfterFailedLoad(rows: Readonly<Record<string, Row>>): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (const [slug, row] of Object.entries(rows)) if (row.retry) out[slug] = { ...EMPTY_ROW, retry: row.retry, retryBase: row.retryBase, notice: row.notice };
  return out;
}

// 늦게 온 쓰기 결과를 지금 화면에 어떻게 남길지(순수).
// - keep: 최신 목록에 같은 줄이 같은 버전으로 있거나, 최신 목록이 권위 없는 상태(실패·미연결)라 아직 판단할 수 없음.
// - notice: 같은 줄이 다른 버전으로 바뀜(그사이 새 목록이 옴) → 재시도·결과 반영 없이 안내만.
// - drop: 같은 줄이 최신 목록에서 빠짐(삭제) → 아무것도 되살리지 않음.
export function retryDecision(latest: QueueView, slug: string, baseVersion: string): "keep" | "notice" | "drop" {
  if (latest.kind !== "ok") return "keep";
  const live = latest.items.find((item) => item.slug === slug);
  if (!live) return "drop";
  return live.version === baseVersion ? "keep" : "notice";
}
const SUPERSEDED: Notice = { tone: "warning", text: "이전 요청의 결과를 확인하지 못했어요. 그사이 새 목록을 받았으니 지금 목록 기준으로 판단해 주세요.", reload: false, retry: false };

export function PublicationQueue({ source, initial, load, apply, newRequestId = fallbackId, now = Date.now }: PublicationQueueProps) {
  const [view, setView] = useState<View>(() => toView(initial));
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(false);
  const [staleLoad, setStaleLoad] = useState(false);
  const [gate] = useState(createSyncGate);
  // 진행 중 쓰기: 동기 판정용 맵(같은 이벤트 안 중복 클릭도 막음)과 그리기용 상태. 키는 slug, 값은 쓰기 시작 때 공급자 세대.
  const inflight = useRef(new Map<string, number>());
  const [writes, setWrites] = useState<Record<string, PublicationCommand>>({});
  // 화면 재시작: initial·load·apply 중 하나라도 바뀌면 받은 값으로 다시 그리고(렌더 중 이전 값 비교),
  // 같은 조건으로 화면 세대를 올려 이전 조회 응답을 버린다(레이아웃 효과 = 같은 커밋 안에서 동기 실행).
  // 실제 공급자 교체면 줄 상태를 모두 버리고, initial만 바뀌면 새 목록을 권위 있는 목록으로 보고 같은 규칙으로 정리한다.
  const [provided, setProvided] = useState({ initial, load, apply });
  if (provided.initial !== initial || provided.load !== load || provided.apply !== apply) {
    const swapped = provided.load !== load || provided.apply !== apply;
    const next = toView(initial);
    setProvided({ initial, load, apply });
    setView(next); setLoading(false); setStaleLoad(false);
    setRows((current) => swapped ? {} : next.kind === "ok" ? rowsAfterList(current, next.items) : rowsAfterFailedLoad(current));
    if (swapped) setWrites({}); // initial만 바뀌면 진행 중 쓰기 잠금은 그대로(같은 공급자의 응답을 기다림)
  }
  useLayoutEffect(() => { if (gate.restart(provided.load, provided.apply)) inflight.current.clear(); }, [gate, provided]);
  // 늦은 쓰기 결과가 최신 화면을 보도록, 커밋된 view를 같은 커밋 안에서 기록한다.
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; }, [view]);
  const anyBusy = Object.keys(writes).length > 0;
  const synthetic = source === "synthetic";
  const row = (slug: string) => ownEntry(rows, slug) ?? EMPTY_ROW;
  const patch = (slug: string, next: Partial<Row>) => setRows((all) => ({ ...all, [slug]: { ...(ownEntry(all, slug) ?? EMPTY_ROW), ...next } }));

  async function reload() {
    if (inflight.current.size > 0 || anyBusy || loading) return;
    const ticket = gate.beginLoad();
    setLoading(true); setStaleLoad(false);
    let next: View;
    try { next = toView(await load()); } catch { next = { kind: "failed" }; }
    if (ticket.view !== gate.viewNow()) return; // 화면이 새로 시작됨(공급자·initial 교체): 새 화면을 건드리지 않음
    setLoading(false);
    if (!gate.accepts(ticket)) { setStaleLoad(true); return; } // 늦은 목록: 성공한 작업·재시도 상태를 덮지 않음
    setView(next);
    setRows((current) => next.kind === "ok" ? rowsAfterList(current, next.items) : rowsAfterFailedLoad(current));
  }

  async function send(item: PublicationItem, action: PublicationAction) {
    if (loading || inflight.current.has(item.slug)) return; // 같은 줄 진행 중이면 전송 0(중복 클릭 포함)
    const ticket = gate.beginWrite();
    inflight.current.set(item.slug, ticket);
    setWrites((all) => ({ ...all, [item.slug]: action.command }));
    patch(item.slug, { notice: null, confirmRevoke: false });
    let outcome: PublicationOutcome;
    try {
      const reply: unknown = await apply(action);
      outcome = isPublicationOutcome(reply) ? reply : { status: "unavailable" };
    } catch { outcome = { status: "unavailable" }; }
    if (!gate.endWrite(ticket)) return; // 교체된 공급자의 응답(잠금은 교체 때 이미 비움)
    inflight.current.delete(item.slug);
    setWrites((all) => { const next = { ...all }; delete next[item.slug]; return next; });
    const decision = retryDecision(viewRef.current, item.slug, item.version);
    if (decision === "drop") return; // 그 줄이 최신 목록에서 빠짐: 되살리지 않음
    if (decision === "notice") { patch(item.slug, { notice: SUPERSEDED, retry: null, retryBase: null }); return; }
    const notice = outcomeNotice(action.command, outcome);
    const updated = applyOutcome(item, action, outcome, now());
    if (updated) {
      setView((current) => current.kind === "ok" ? { kind: "ok", items: current.items.map((it) => it.slug === item.slug && it.version === item.version ? updated : it) } : current);
      patch(item.slug, { notice, retry: null, retryBase: null, rights: false, stale: false });
      return;
    }
    const success = outcome.status === "prepared" || outcome.status === "published" || outcome.status === "revoked";
    // 성공인데 요청과 맞지 않는 결과는 화면이 추측하지 않고 다시 불러오기를 요구한다.
    patch(item.slug, {
      notice: success ? { tone: "warning", text: "처리 결과가 화면의 상태와 맞지 않아요. 목록을 다시 불러와 주세요.", reload: true, retry: false } : notice,
      retry: notice.retry ? action : null, retryBase: notice.retry ? item.version : null, stale: success || notice.reload,
    });
  }

  function start(item: PublicationItem, command: PublicationCommand) {
    if (loading) return;
    const action = buildAction(item, command, newRequestId(), row(item.slug).rights);
    if (action) void send(item, action);
  }

  return <section aria-labelledby="publication-queue" className="stack">
    <div className={styles.head}>
      <h2 id="publication-queue">완성본 검수·게시</h2>
      {view.kind !== "closed" && <Button variant="secondary" className={styles.reload} onClick={reload} loading={loading} loadingLabel="불러오는 중" disabled={anyBusy}>목록 다시 불러오기</Button>}
    </div>
    {staleLoad && <p role="status" className={styles.warning}>불러오는 사이 다른 작업이 끝나서 이번 목록은 반영하지 않았어요. 필요하면 다시 불러와 주세요.</p>}
    <p className={styles.note}>내 계정이 소유한 완성본만 보여요. 게시하면 공개 메인 목록에 올라가고, 철회하면 공개 목록과 표지 주소에서 내려가요.</p>
    {synthetic && <Callout tone="info" title="합성 시험 데이터예요">운영 작품이 아니에요. 게시·철회도 이 화면 안의 시험 공급자에만 반영돼요.</Callout>}
    {view.kind === "closed" && <Card>
      <h3 className={styles.title}>게시 서버 <StatusPill status="locked">미연결</StatusPill></h3>
      <p className={styles.note}>관리자 게시·철회 서버 기능이 아직 연결되지 않았어요. 연결되기 전에는 이 화면에서 게시하거나 철회할 수 없어요.</p>
    </Card>}
    {view.kind === "failed" && <Callout tone="warning" title="게시 목록을 불러오지 못했어요">잠시 뒤 목록 다시 불러오기를 눌러 주세요.</Callout>}
    {view.kind === "ok" && !view.items.length && <Card><p className={styles.note}>검수할 완성본이 없어요.</p></Card>}
    {view.kind === "ok" && view.items.length > 0 && <ul className={styles.list}>
      {view.items.map((item) => {
        const r = row(item.slug);
        const busy = ownEntry(writes, item.slug) ?? null;
        const stage = stageOf(item);
        const commands = loading || r.stale || r.retry || busy ? [] : allowedCommands(item, r.rights);
        const rightsId = `rights-${item.slug}`;
        const blocked = item.rights !== "confirmed" ? "권리 증빙이 확인되지 않아 게시할 수 없어요." : !item.source.finished ? "원본이 완성본이 아니라 게시할 수 없어요." : null;
        const revokeGen = revokeTarget(item);
        return <li key={item.slug}><Card>
          <div className="stack">
            <h3 className={styles.title}>{item.title} {synthetic && <StatusPill status="sample">합성</StatusPill>}</h3>
            <p className={styles.meta}><StatusPill status={PILL[stage]}>{STAGE_LABEL[stage]}</StatusPill><span>{KIND[item.kind]}</span><span>주소 이름 {item.slug}</span></p>
            <dl className={styles.facts}>
              <div><dt>대상 리비전</dt><dd>v{item.version}</dd></div>
              <div><dt>게시 중 세대</dt><dd>{item.activeGeneration ?? "없음"}</dd></div>
              <div><dt>준비된 세대</dt><dd>{item.pendingGeneration ?? "없음"}</dd></div>
              <div><dt>원본</dt><dd>리비전 {item.source.revision} · {item.source.finished ? "완성본" : "미완성"}</dd></div>
              <div><dt>권리 증빙</dt><dd>{item.rights === "confirmed" ? "확인됨" : "미확인"}</dd></div>
            </dl>
            {blocked && <p className={styles.note}>{blocked}</p>}
            {!blocked && !r.stale && !r.retry && <label className={styles.check} htmlFor={rightsId}>
              <input id={rightsId} type="checkbox" checked={r.rights} disabled={!!busy || loading} onChange={(event) => patch(item.slug, { rights: event.target.checked })} />
              권리 증빙과 표시 문구를 확인했어요(게시 준비·게시에 필요)
            </label>}
            <div className={styles.actions}>
              {commands.filter((c) => c !== "revoke").map((command) => <Button key={command} onClick={() => start(item, command)}>
                {command === "prepare" ? `v${item.version} 게시 준비` : `세대 ${item.pendingGeneration} 게시`}
              </Button>)}
              {commands.includes("revoke") && !r.confirmRevoke && <Button variant="danger" onClick={() => patch(item.slug, { confirmRevoke: true, notice: null })}>철회…</Button>}
              {commands.includes("revoke") && r.confirmRevoke && <>
                <Button variant="danger" onClick={() => start(item, "revoke")}>세대 {revokeGen} 철회 확정</Button>
                <Button variant="secondary" onClick={() => patch(item.slug, { confirmRevoke: false })}>취소</Button>
              </>}
              {busy && <Button loading loadingLabel={`${COMMAND[busy]} 요청 중`}>{COMMAND[busy]}</Button>}
              {r.retry && <Button variant="secondary" disabled={loading || !!busy} onClick={() => void send(item, r.retry!)}>같은 {COMMAND[r.retry.command]} 요청 다시 시도</Button>}
              {(r.stale || r.retry) && <Button variant="secondary" onClick={reload} disabled={loading || anyBusy}>목록 다시 불러오기</Button>}
            </div>
            {!blocked && !r.rights && !r.stale && !r.retry && !busy && <p className={styles.note}>{item.pendingGeneration
              ? `권리를 다시 확인하면 세대 ${item.pendingGeneration}을 게시할 수 있어요.`
              : item.activeGeneration ? "권리를 확인하면 새 세대를 게시 준비할 수 있어요." : "권리를 확인하면 게시 준비를 할 수 있어요."}</p>}
            <p role="status" className={r.notice ? styles[r.notice.tone] : styles.note}>{r.notice?.text ?? ""}</p>
          </div>
        </Card></li>;
      })}
    </ul>}
  </section>;
}
