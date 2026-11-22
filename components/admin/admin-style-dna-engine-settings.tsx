"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import type { StyleDnaEngine } from "@/lib/reference-analysis/style-dna-engine-credential-contract";
import {
  acceptsEngineKey, acceptsEngineModel, readStyleDnaEngineSettings, saveStyleDnaEngineSetting,
  type StyleDnaEngineSetting,
} from "./style-dna-engine-credentials-client";
import styles from "./admin-gemini-settings.module.css";
import integration from "./admin-platform-integrations.module.css";
import { imageAnalysisModels } from "./admin-model-suggestions";

const engines = ["openai", "anthropic"] as const;
const label = { openai: "OpenAI", anthropic: "Anthropic Claude" } as const;
const modelExample = { openai: "gpt-… 또는 o3-…", anthropic: "claude-…" } as const;
const loginLink = adminLoginPath({ next: "/admin/integrations" });
const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
type ReadState = { kind: "loading" } | Awaited<ReturnType<typeof readStyleDnaEngineSettings>>;
type AccessDenied = "login" | "forbidden";
type Notice = { tone: "success" | "warning" | "danger"; text: string };
type Field = "model" | "key";

function EngineCard({ provider, initial, onDenied }: {
  provider: StyleDnaEngine; initial: StyleDnaEngineSetting; onDenied: (kind: AccessDenied) => void;
}) {
  const id = useId();
  const name = label[provider];
  const [setting, setSetting] = useState(initial);
  const [model, setModel] = useState(initial.modelId ?? "");
  const [replaceKey, setReplaceKey] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [error, setError] = useState<{ field: Field; text: string }>();
  const [busy, setBusy] = useState<"save" | "reload">();
  const [needsReload, setNeedsReload] = useState(false);
  const active = useRef<AbortController | null>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const modelField = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focus = useRef<"key" | "model" | "notice" | null>(null);
  const showKey = !setting.configured || replaceKey;

  useEffect(() => () => active.current?.abort(), []);
  useLayoutEffect(() => {
    const next = focus.current;
    focus.current = null;
    if (next) (next === "key" ? keyField : next === "model" ? modelField : status).current?.focus();
  });

  function notify(tone: Notice["tone"], text: string) {
    focus.current = "notice";
    setNotice({ tone, text });
  }

  function clearKey() {
    if (keyField.current) keyField.current.value = "";
  }

  function apply(saved: StyleDnaEngineSetting) {
    clearKey();
    setSetting(saved);
    setModel(saved.modelId ?? "");
    setReplaceKey(false);
    setNeedsReload(false);
  }

  async function reload(signal: AbortSignal, conflict: boolean) {
    setBusy("reload");
    const result = await readStyleDnaEngineSettings(signal);
    if (signal.aborted) return;
    if (result.kind === "login" || result.kind === "forbidden") return onDenied(result.kind);
    if (result.kind === "ok") {
      apply(result.value.providers[provider]);
      notify(conflict ? "warning" : "success", conflict
        ? "다른 곳에서 설정을 변경했어요. 최신 설정을 확인한 뒤 다시 수정해 주세요."
        : "최신 설정을 불러왔어요.");
      return;
    }
    setNeedsReload(true);
    notify("danger", conflict
      ? "다른 곳에서 설정을 변경했어요. 저장하려면 최신 설정을 다시 불러와 주세요."
      : "최신 설정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    try { await work(controller.signal); }
    finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(undefined);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || needsReload) return;
    const modelId = model.trim();
    const apiKey = showKey ? keyField.current?.value.trim() ?? "" : "";
    const issue = !acceptsEngineModel(provider, modelId)
      ? { field: "model" as const, text: `모델 ID를 확인해 주세요. ${modelExample[provider]} 형식을 사용해요.` }
      : showKey && !acceptsEngineKey(apiKey)
        ? { field: "key" as const, text: apiKey ? "API 키의 형식을 확인해 주세요." : "API 키를 입력해 주세요." }
        : undefined;
    setError(issue);
    if (issue) {
      focus.current = issue.field;
      setNotice(undefined);
      return;
    }
    if (!apiKey && modelId === setting.modelId) {
      notify("warning", "모델 ID를 바꾸거나 새 API 키를 입력해 주세요.");
      return;
    }
    clearKey();
    setNotice(undefined);
    setBusy("save");
    void run(async signal => {
      const result = await saveStyleDnaEngineSetting({ provider, modelId, expectedVersion: setting.version, ...(apiKey && { apiKey }) }, signal);
      if (signal.aborted) return;
      if (result.kind === "login" || result.kind === "forbidden") return onDenied(result.kind);
      if (result.kind === "ok") {
        apply(result.value.setting);
        notify("success", `${name}에서 확인한 키와 모델을 저장했어요.`);
        return;
      }
      if (result.kind === "stale") return reload(signal, true);
      if (result.kind === "invalid") {
        notify("danger", "모델 ID와 API 키를 확인한 뒤 다시 저장해 주세요.");
        return;
      }
      if (result.kind === "invalid_key" || result.kind === "model_not_found" || result.kind === "quota_exceeded" || result.kind === "timed_out") {
        const messages = {
          invalid_key: "플랫폼이 API 키를 받아들이지 않았어요. 키와 권한을 확인해 주세요.",
          model_not_found: "이 API 키로 사용할 수 있는 모델 ID인지 확인해 주세요.",
          quota_exceeded: "플랫폼 요청 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.",
          timed_out: "플랫폼 모델 확인 시간이 초과됐어요. 잠시 뒤 다시 시도해 주세요.",
        } as const;
        notify("danger", messages[result.kind]);
        return;
      }
      setNeedsReload(true);
      notify("danger", result.kind === "storage"
        ? "서버 키 저장소에 연결하지 못했어요. 최신 설정을 다시 불러와 주세요."
        : "저장 결과를 확인하지 못했어요. 최신 설정을 다시 불러와 주세요.");
    });
  }

  const modelId = `${id}-model`;
  const keyId = `${id}-key`;
  return <Card className={styles.card}>
    <div className={styles.head}><h4>{name}</h4></div>
    <dl className={styles.status} aria-label={`${name} 등록 상태`}>
      <div><dt>저장 상태</dt><dd data-tone={setting.configured ? "success" : "warning"}>
        {setting.configured ? `등록됨 · 버전 ${setting.version}` : "미등록"}
      </dd></div>
      <div><dt>마지막 저장</dt><dd>{setting.updatedAt
        ? <time dateTime={setting.updatedAt}>{dateTime.format(new Date(setting.updatedAt))}</time> : "없음"}</dd></div>
    </dl>
    <form className={styles.form} onSubmit={submit} noValidate aria-label={`${name} 등록`} aria-busy={!!busy || undefined}>
      <fieldset className={styles.fieldset} disabled={!!busy || needsReload}>
        <legend>키와 모델</legend>
        <div className={styles.field}>
          <label htmlFor={modelId}>모델 ID</label>
          <input id={modelId} ref={modelField} name={`${provider}-model`} list={`${modelId}-suggestions`} value={model} maxLength={128} autoComplete="off" spellCheck={false}
            aria-invalid={error?.field === "model" || undefined}
            aria-describedby={`${modelId}-help${error?.field === "model" ? ` ${modelId}-error` : ""}`}
            onChange={event => { setModel(event.target.value); if (error?.field === "model") setError(undefined); }} />
          <datalist id={`${modelId}-suggestions`}>
            {imageAnalysisModels[provider].map(option => <option key={option} value={option} />)}
          </datalist>
          <p className={styles.help} id={`${modelId}-help`}>{modelExample[provider]}</p>
          {error?.field === "model" && <p className={styles.error} id={`${modelId}-error`}>{error.text}</p>}
        </div>
        {showKey ? <div className={styles.field}>
          <label htmlFor={keyId}>{setting.configured ? "새 API 키" : "API 키"}</label>
          <input id={keyId} ref={keyField} name={`${provider}-key`} type="password" autoComplete="new-password" spellCheck={false}
            autoCapitalize="off" maxLength={256} aria-invalid={error?.field === "key" || undefined}
            aria-describedby={error?.field === "key" ? `${keyId}-error` : undefined}
            onChange={() => { if (error?.field === "key") setError(undefined); }} />
          {error?.field === "key" && <p className={styles.error} id={`${keyId}-error`}>{error.text}</p>}
          {setting.configured && <Button variant="ghost" size="sm" onClick={() => {
            clearKey(); setReplaceKey(false); setError(undefined); focus.current = "model";
          }}>교체 취소</Button>}
        </div> : <div className={styles.keyStored}>
          <span className={styles.help}>키를 유지한 채 모델만 바꿀 수 있어요.</span>
          <Button variant="secondary" size="sm" onClick={() => { setReplaceKey(true); focus.current = "key"; }}>API 키 교체</Button>
        </div>}
      </fieldset>
      <p ref={status} tabIndex={-1} role="status" className={styles.notice} data-tone={notice?.tone}>{notice?.text ?? ""}</p>
      <div>{needsReload
        ? <Button variant="secondary" size="sm" loading={busy === "reload"} loadingLabel="불러오는 중"
          onClick={() => { void run(signal => reload(signal, false)); }}>최신 설정 다시 불러오기</Button>
        : <Button type="submit" disabled={busy === "reload"} loading={busy === "save"} loadingLabel="모델 확인 중">검증 후 설정 저장</Button>}</div>
    </form>
  </Card>;
}

export function StyleDnaEngineSettingsCards({ only }: { only?: StyleDnaEngine }) {
  const [read, setRead] = useState<ReadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readStyleDnaEngineSettings(controller.signal).then(result => { if (!controller.signal.aborted) setRead(result); });
    return () => controller.abort();
  }, [attempt]);
  return <div className={integration.provider} id="image-engine-settings">
    <h3>이미지 분석 엔진 등록</h3>
    <p className={integration.engineIntro}>키와 모델을 저장한 뒤 이미지 분석기에서 해당 엔진을 선택하고 실제 분석을 실행해 연결을 확인하세요.</p>
    {read.kind === "ok" ? <div className={integration.engineCards}>
      {(only ? [only] : engines).map(provider => <EngineCard key={provider} provider={provider} initial={read.value.providers[provider]}
        onDenied={kind => setRead({ kind })} />)}
    </div> : <Card className={styles.card}>
      {read.kind === "loading" ? <p role="status">이미지 분석 엔진 설정을 불러오고 있어요.</p>
        : read.kind === "login" ? <p role="status">로그인이 끝났어요. <a className={styles.link} href={loginLink}>관리자 로그인</a></p>
        : read.kind === "forbidden" ? <p role="status">이 계정에는 엔진 설정을 볼 권한이 없어요.</p>
        : <div className={styles.failed}>
          <p role="status">{read.kind === "storage" ? "이미지 분석 엔진 키 저장소에 연결할 수 없어요." : "엔진 설정을 불러오지 못했어요."}</p>
          <Button variant="secondary" size="sm" onClick={() => { setRead({ kind: "loading" }); setAttempt(value => value + 1); }}>다시 불러오기</Button>
        </div>}
    </Card>}
  </div>;
}
