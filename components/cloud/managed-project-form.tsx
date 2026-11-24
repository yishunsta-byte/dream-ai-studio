"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import type { MenuSnapshot, ProjectInputErrors } from "@/lib/menus/inputs";
import { Button, Callout, Card } from "@/components/ui/primitives";
import { Field, FormErrorSummary } from "@/components/ui/interactive";
import { assetChoicesPath, classifyChoices, classifyCreate, cloudBriefPath, createBody, keyMessageCheck, lengthChoices, mergeChoices, nextAttempt,
  type AssetChoice, type Attempt, type ChoicesPage } from "./managed-project-requests";

// P1-02 클라우드 새 프로젝트(관리형 저장소). 로컬 ProjectForm과 같은 입력 규칙(menus.json 스냅샷)을 쓰되,
// 요청 키(UUIDv7)로 같은 내용의 재시도를 한 번으로 묶고, 201 {id}를 받은 뒤에만 그 ID의 브리프로 이동한다.
// 제품 원본 자료(productAssets)는 서버가 확인한 소유 자료 목록(GET /api/projects/asset-choices, Backend msg_1741d19f7010)에서만 고른다.
// 목록을 읽지 못했으면(경로 없음·미구성 503·권한·실패) 제출하지 않고 제약을 말한다. 서버는 생성 때 같은 조건을 다시 검사한다.
// 등장 캐릭터는 클라우드 캐릭터 저장소가 없어 이 화면에서 받지 않는다(선택 항목).
// P2-MANAGED-GENERAL-SHORTS-ENTRY: 자료 목록 잠금은 필수 자료 칸이 있는 분야(쇼핑숏츠)에서만 건다. 자료가 선택인 분야(주제별 쇼츠)는
// 목록을 못 읽어도 자료 없이 저장할 수 있다. 길이 선택지가 있는 분야는 목표 길이를 고르는 칸으로 받는다.
// 배정 2(CMD-20261125-009): 핵심 메시지 글자 수 상한(keyMessageLength, 설정의 options 문자열, 기본 100)을 고른다.
// 이미 쓴 글이 고른 상한보다 길면 자르지 않고 글자 수를 알려 주며, 상한 이하가 될 때까지 저장을 막는다.

type Choices = { kind: "loading" } | { kind: "ready"; items: AssetChoice[]; nextCursor?: string; more?: boolean }
  | { kind: Exclude<ChoicesPage["kind"], "ok"> };

async function readChoices(cursor: string | undefined, signal?: AbortSignal): Promise<ChoicesPage> {
  try {
    const response = await fetch(assetChoicesPath(cursor), { credentials: "same-origin", cache: "no-store", signal });
    return classifyChoices(response.status, await response.json().catch(() => null));
  } catch { return { kind: "failed" }; }
}
type Notice = { tone: "warning" | "info"; title: string; body: string; login?: boolean };

const cloudFields = (snapshot: MenuSnapshot) => [...snapshot.commonInputs, ...snapshot.menu.inputs].filter(field => field.type !== "characters");

export function ManagedProjectForm({ snapshot }: { snapshot: MenuSnapshot }) {
  const fields = useMemo(() => cloudFields(snapshot), [snapshot]);
  const hasAssets = fields.some(field => field.type === "assets");
  const needsAssets = fields.some(field => field.type === "assets" && field.required);
  const lengths = lengthChoices(snapshot.menu as typeof snapshot.menu & Record<string, unknown>);
  const defaultLength = lengths && !lengths.includes(snapshot.menu.defaultLengthSec) ? (lengths.includes(30) ? 30 : lengths[0]) : snapshot.menu.defaultLengthSec;
  const limitOptions = fields.find(field => field.id === "keyMessageLength")?.options;
  const defaultLimit = limitOptions ? (limitOptions.includes("100") ? "100" : limitOptions[0]) : undefined;
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map(field => [field.id,
    field.type === "checkbox" ? false : ["assets", "multiselect"].includes(field.type) ? []
      : field.id === "aspect" ? snapshot.menu.defaultAspect : field.id === "lengthSec" ? defaultLength
      : field.id === "keyMessageLength" && defaultLimit ? defaultLimit : ""])));
  const [errors, setErrors] = useState<ProjectInputErrors>({});
  const [notice, setNotice] = useState<Notice>();
  const [pending, setPending] = useState(false);
  const unresolved = useRef<Attempt | undefined>(undefined);
  const router = useRouter();
  const [assets, setAssets] = useState<Choices>(() => hasAssets ? { kind: "loading" } : { kind: "ready", items: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hasAssets) return;
    const controller = new AbortController();
    void readChoices(undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setAssets(page.kind === "ok" ? { kind: "ready", items: page.assets, nextCursor: page.nextCursor } : { kind: page.kind });
    });
    return () => controller.abort();
  }, [attempt, hasAssets]);
  const loadMore = async () => {
    if (assets.kind !== "ready" || !assets.nextCursor || assets.more) return;
    setAssets({ ...assets, more: true });
    const page = await readChoices(assets.nextCursor);
    setAssets(page.kind === "ok" ? { kind: "ready", items: mergeChoices(assets.items, page.assets), nextCursor: page.nextCursor }
      : { ...assets, more: false });
    if (page.kind !== "ok") setNotice({ tone: "warning", title: "자료를 더 불러오지 못했어요", body: "이미 불러온 자료는 그대로 고를 수 있어요. 잠시 뒤 다시 눌러 주세요." });
  };
  const assetsReady = assets.kind === "ready";
  const { max: messageLimit, count: messageCount, over: messageOver } = keyMessageCheck(limitOptions, values.keyMessageLength, values.keyMessage);
  const canSubmit = (!needsAssets || assetsReady) && !messageOver;
  const summary = useMemo(() => Object.entries(errors).map(([id, message]) => ({ id: id === "_form" ? "managed-project-error" : `input-${id}`,
    label: fields.find(field => field.id === id)?.label ?? "입력 내용", message })), [errors, fields]);
  const change = (id: string, value: unknown) => setValues(old => ({ ...old, [id]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !canSubmit) return;
    const inputs = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, id === "lengthSec" && value !== "" ? Number(value) : value]));
    const attempt = nextAttempt(unresolved.current, createBody(snapshot.menu.id, inputs), () => v7());
    unresolved.current = attempt;
    setPending(true); setErrors({}); setNotice(undefined);
    let outcome: ReturnType<typeof classifyCreate>;
    try {
      const response = await fetch("/api/projects", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": attempt.key }, body: attempt.body });
      outcome = classifyCreate(response.status, await response.json().catch(() => null));
    } catch { outcome = { kind: "unknown" }; }
    setPending(false);
    // 결과를 모르는 요청만 같은 키를 다시 쓴다. 나머지는 다음 제출에 새 키.
    if (outcome.kind !== "unknown") unresolved.current = undefined;
    if (outcome.kind === "created") { router.push(cloudBriefPath(outcome.id)); router.refresh(); return; }
    if (outcome.kind === "invalid") { setErrors(outcome.errors); return; }
    if (outcome.kind === "unknown") setNotice({ tone: "warning", title: "저장됐는지 확인하지 못했어요",
      body: "연결이 끊겼거나 프로젝트 저장소가 응답하지 않았어요. 내용을 바꾸지 않고 다시 누르면 같은 요청으로 확인해서 프로젝트가 두 번 만들어지지 않아요." });
    if (outcome.kind === "key-conflict") setNotice({ tone: "warning", title: "다시 확인이 필요해요", body: "이전 요청과 내용이 달라 새 요청으로 보내야 해요. 내용을 확인하고 다시 눌러 주세요." });
    if (outcome.kind === "locked") setNotice({ tone: "warning", title: "이 분야의 프로젝트를 만들 수 없어요", body: "이 분야는 아직 클라우드에서 만들 수 없어요. 다른 분야를 골라 주세요." });
    if (outcome.kind === "login") setNotice({ tone: "warning", title: "다시 로그인해 주세요", body: "로그인이 끝나 저장하지 않았어요. 로그인한 뒤 이 화면에서 다시 시도해 주세요.", login: true });
    if (outcome.kind === "forbidden") setNotice({ tone: "warning", title: "이 계정으로는 만들 수 없어요", body: "허용된 계정으로 로그인해 주세요.", login: true });
  }

  return <form className="stack form-width" noValidate onSubmit={submit} aria-busy={pending || undefined}>
    <div id="managed-project-error" tabIndex={-1}><FormErrorSummary errors={summary} /></div>
    {hasAssets && assets.kind === "loading" && <p role="status" className="muted">확인된 내 자료 목록을 불러오고 있어요.</p>}
    {!needsAssets && hasAssets && (assets.kind === "unlinked" || assets.kind === "failed") && <Callout tone="info" title="지금은 참고 자료를 고를 수 없어요">
      <p>참고 자료는 선택 항목이라 비워 두고 저장할 수 있어요.</p>
      {assets.kind === "failed" && <Button type="button" variant="secondary" size="sm" onClick={() => { setAssets({ kind: "loading" }); setAttempt(value => value + 1); }}>자료 목록 다시 불러오기</Button>}
    </Callout>}
    {needsAssets && assets.kind === "unlinked" && <Callout tone="warning" title="아직 클라우드에서 자료를 고를 수 없어요">
      새 프로젝트에는 확인된 제품 사진이나 영상이 필요해요. 클라우드 자료 목록이 연결되면 여기에서 골라 바로 만들 수 있어요. 지금은 저장하지 않아요.
    </Callout>}
    {(assets.kind === "login" || assets.kind === "forbidden") && <Callout tone="warning" title="자료 목록을 볼 수 없어요">
      <p>{assets.kind === "login" ? "로그인이 끝났어요. 다시 로그인해 주세요." : "허용된 계정으로 로그인해 주세요."}</p>
      <p><Link href={`/login?next=${encodeURIComponent("/cloud/projects/new")}`}>로그인</Link></p>
    </Callout>}
    {needsAssets && assets.kind === "failed" && <Callout tone="warning" title="자료 목록을 불러오지 못했어요">
      <p>잠시 뒤 다시 불러와 주세요. 목록을 읽기 전에는 저장하지 않아요.</p>
      <Button type="button" variant="secondary" size="sm" onClick={() => { setAssets({ kind: "loading" }); setAttempt(value => value + 1); }}>자료 목록 다시 불러오기</Button>
    </Callout>}
    {notice && <Callout tone={notice.tone} title={notice.title}>
      <p role="alert">{notice.body}</p>
      {notice.login && <p><Link href={`/login?next=${encodeURIComponent("/cloud/projects/new")}`}>로그인</Link></p>}
    </Callout>}
    <Callout title="확인한 내용만 등록해 주세요.">광고·협찬, 실사형 AI, 음악 항목을 선택하면 검수 항목이 추가돼요.</Callout>
    <Card><div className="stack">{fields.map(field => {
      const props = { id: `input-${field.id}`, name: field.id, disabled: pending };
      const selected = Array.isArray(values[field.id]) ? values[field.id] as string[] : [];
      let control;
      if (field.type === "checkbox") control = <input {...props} type="checkbox" checked={values[field.id] === true} onChange={event => change(field.id, event.target.checked)} />;
      else if (field.type === "assets") {
        const options = assets.kind === "ready" ? assets.items.filter(asset => !field.accept || field.accept.includes(asset.kind)) : [];
        control = <select {...props} multiple value={selected} disabled={pending || !options.length} onChange={event => change(field.id, Array.from(event.target.selectedOptions).map(option => option.value))}>
          {options.length ? options.map(option => <option key={option.id} value={option.id}>{option.title}</option>)
            : <option disabled value="">{assetsReady ? "고를 수 있는 확인된 자료가 없어요" : assets.kind === "loading" ? "자료 목록을 불러오고 있어요" : "자료 목록을 쓸 수 없어요"}</option>}
        </select>;
      } else if (field.type === "multiselect") control = <select {...props} multiple value={selected} onChange={event => change(field.id, Array.from(event.target.selectedOptions).map(option => option.value))}>
        {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select>;
      else if (field.id === "lengthSec" && lengths) control = <select {...props} value={String(values[field.id] ?? "")} onChange={event => change(field.id, event.target.value)}>
        {lengths.map(value => <option key={value} value={value}>{value}초</option>)}
      </select>;
      else if (field.type === "select") control = <select {...props} value={String(values[field.id] ?? "")} onChange={event => change(field.id, event.target.value)}>
        {!(field.id === "keyMessageLength" && defaultLimit) && <option value="">선택해 주세요</option>}{field.options?.map(option => <option key={option}>{option}</option>)}
      </select>;
      else if (field.type === "textarea") control = <textarea {...props} value={String(values[field.id] ?? "")} maxLength={field.maxLength} onChange={event => change(field.id, event.target.value)} />;
      else control = <input {...props} type={field.type === "datetime" ? "datetime-local" : field.type === "number" ? "number" : field.type === "url" ? "url" : field.type === "date" ? "date" : "text"}
        min={field.min} max={field.max} maxLength={field.maxLength} value={String(values[field.id] ?? "")} onChange={event => change(field.id, event.target.value)} />;
      return <div key={field.id} className="stack">
        <Field label={field.label} required={field.required} help={field.help}
          error={errors[field.id] ?? (field.id === "keyMessage" && messageOver ? `고른 글자 수(${messageLimit}자)보다 ${messageCount - messageLimit!}자 길어요. 줄이거나 더 큰 글자 수를 골라 주세요.` : undefined)}>{control}</Field>
        {field.id === "keyMessage" && messageLimit !== undefined && <p className="muted" id="keyMessage-count" aria-live="polite">{messageCount} / {messageLimit}자</p>}
        {field.type === "assets" && assets.kind === "ready" && <div className="stack">
          <p className="muted">서버에서 확인을 마친 내 자료만 보여요(최신순). 여러 개를 고를 수 있어요.</p>
          {assets.nextCursor && <div><Button type="button" variant="secondary" size="sm" loading={assets.more} loadingLabel="불러오는 중" onClick={() => void loadMore()}>자료 더 불러오기</Button></div>}
        </div>}
      </div>;
    })}</div></Card>
    <Button type="submit" loading={pending} loadingLabel="저장 중" disabled={!canSubmit}
      disabledReason={canSubmit ? undefined : messageOver ? "핵심 메시지를 고른 글자 수 이하로 줄여 주세요" : assets.kind === "loading" ? "자료 목록을 불러오고 있어요" : "확인된 자료 목록을 읽어야 만들 수 있어요"}>저장하고 브리프 확인</Button>
  </form>;
}
