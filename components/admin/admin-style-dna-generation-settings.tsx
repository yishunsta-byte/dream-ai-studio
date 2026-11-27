"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import { styleDnaGeneratedModels, styleDnaUsageGeneratedModels } from "@/lib/reference-analysis/style-dna-contract";
import {
  acceptsGenerationKey, readStyleDnaGenerationSettings, saveStyleDnaGenerationSetting, styleDnaGenerationKeyCharacters,
  type StyleDnaGenerationProvider, type StyleDnaGenerationSetting,
} from "./style-dna-generation-credentials-client";
import styles from "./admin-gemini-settings.module.css";
import { AdminProviderForm } from "./admin-provider-form";

// 이미지 생성 공급자 키 카드(분석 엔진 카드와 같은 틀). 모델은 코드 계약에 고정이라 고르는 칸 없이 키 등록·교체만 받는다.
// 키는 입력 칸(ref)에서 바로 읽어 보내고 상태에 두지 않는다. 보내기 직전에 칸을 비우고, 성공·실패 모두 다시 그리지 않는다.
// 저장은 이 화면의 키 상태만 바꾼다. 이미지 분석기 목록(결과 테스트의 모델)은 다음에 분석기를 열 때 서버가 다시 읽어 반영한다.
const seedream = styleDnaGeneratedModels["seedream-5.5"];
const flux = styleDnaGeneratedModels["flux-2-pro"];
const gptImage = styleDnaUsageGeneratedModels["gpt-image-2.6"];
const info = {
  byteplus: { name: seedream.providerLabel, model: `${seedream.label}(${seedream.vendor}) · ${seedream.modelId}`, size: seedream.size.replace("x", "×"),
    // 저장소에서 근거가 확인된 Seedream 5.5 문서(style-dna-seedream-provider.ts 주석과 같은 출처). 키 발급 화면 주소는 확인 전이라 넣지 않는다.
    docs: "https://docs.byteplus.com/en/docs/ModelArk/seedream-5-5", docsLabel: seedream.label, modelName: seedream.label, usage: "이미지 분석기 결과 테스트의 Seedream 5.5 시험 이미지 생성",
    issuer: "BytePlus ModelArk" },
  // FLUX.2 pro: 공급자 어댑터(style-dna-flux-provider.ts)의 공식 주소와 같은 BFL 문서. 키 발급 화면 주소는 확인 전이라 넣지 않는다.
  bfl: { name: flux.providerLabel, model: `${flux.label}(${flux.vendor}) · ${flux.modelId}`, size: flux.size.replace("x", "×"),
    docs: "https://docs.bfl.ai/", docsLabel: flux.label, modelName: flux.label, usage: "이미지 분석기 결과 테스트의 FLUX.2 pro 시험 이미지 생성", issuer: "Black Forest Labs" },
  // GPT Image 2.6 sunburst: 키 발급은 분석 엔진 OpenAI 카드와 같은 공식 주소. 분석 엔진 OpenAI 키와 별개로 등록·버전 관리한다(같은 키 값을 넣어도 된다).
  openai: { name: gptImage.providerLabel, model: `${gptImage.label}(${gptImage.vendor}) · ${gptImage.modelId}`, size: gptImage.size.replace("x", "×"),
    docs: "https://platform.openai.com/api-keys", docsLabel: "OpenAI API 키 발급", modelName: `${gptImage.label} · sunburst`, usage: "이미지 분석기 결과 테스트의 GPT Image 2.6 시험 이미지 생성",
    issuer: "OpenAI", note: "분석 엔진 OpenAI 키와 따로 등록·버전 관리돼요. 같은 키 값을 넣어도 돼요." },
} as const satisfies Record<StyleDnaGenerationProvider, unknown>;
// 서버가 등록 상태를 알려 준 공급자만 카드로 그린다(BytePlus는 늘, BFL·OpenAI는 응답에 있을 때만).
const shown = (value?: { providers: Partial<Record<StyleDnaGenerationProvider, unknown>> }) =>
  (["byteplus", "bfl", "openai"] as const).filter(provider => provider === "byteplus" || value?.providers[provider] !== undefined);
const loginLink = adminLoginPath({ next: "/admin/integrations" });
type ReadState = { kind: "loading" } | Awaited<ReturnType<typeof readStyleDnaGenerationSettings>>;
// 저장 실패 안내(배정 2, msg_938d6ae503bb). 등록 API는 서버에서 키 형식만 확인하고 저장한다(BytePlus에 보내 확인하지 않음).
// 그래서 422는 형식 재확인으로만 안내하고, 결과가 불명확한 504는 다시 저장하기 전에 등록 상태를 GET으로 확인하게 한다.
// 화면 판정 안내(서버 422와 같은 공통 규칙). 칸 길이를 묶지 않아 붙여 넣은 긴 키가 잘린 채 저장되지 않는다(초과는 이 안내로 거절).
export const generationKeyFormatHint = "API 키의 형식을 확인해 주세요.";
export const generationKeyPasteHint = "붙여 넣은 값에 공백·줄바꿈·쉼표처럼 키에 쓰지 않는 글자가 있어 넣지 않았어요. 키만 다시 복사해 붙여 넣어 주세요.";
export const generationInvalidKeyNotice = (provider: StyleDnaGenerationProvider) =>
  `서버가 API 키 형식을 받아들이지 않았어요. ${info[provider].issuer}에서 발급한 키를 앞뒤 공백 없이 그대로 붙여 넣었는지 확인해 주세요.`;
export const generationSaveNotices = {
  invalid_key: generationInvalidKeyNotice("byteplus"),
  quota_exceeded: "등록 요청이 많아 서버가 이번 저장을 처리하지 않았어요. 이번에 입력한 키는 저장되지 않았으니 잠시 뒤 다시 입력해 저장해 주세요.",
  timed_out: "저장 요청의 결과를 확인하지 못했어요(시간 초과). 키가 저장됐을 수 있으니 다시 저장하기 전에 최신 등록 상태를 불러와 확인해 주세요.",
  storage: "서버 키 저장소에 연결하지 못했어요. 최신 등록 상태를 다시 불러와 주세요.",
  failed: "저장 결과를 확인하지 못했어요. 최신 등록 상태를 다시 불러와 주세요.",
} as const;
type AccessDenied = "login" | "forbidden";
type Notice = { tone: "success" | "warning" | "danger"; text: string };

function GenerationHeader({ provider }: { provider: StyleDnaGenerationProvider }) {
  const item = info[provider];
  return <div className={styles.head} data-provider-heading>
    <h4>{item.name} 생성 키</h4>
    <p className={styles.help}>{item.usage}</p>
    {"note" in item && <p className={styles.help}>{item.note}</p>}
    <a className={styles.link} href={item.docs} target="_blank" rel="noreferrer">{provider === "openai" ? item.docsLabel : `${item.docsLabel} 공식 문서`} ↗</a>
  </div>;
}

function GenerationCard({ provider, initial, onDenied }: {
  provider: StyleDnaGenerationProvider; initial: StyleDnaGenerationSetting; onDenied: (kind: AccessDenied) => void;
}) {
  const id = useId();
  const item = info[provider];
  const [setting, setSetting] = useState(initial);
  const [replaceKey, setReplaceKey] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"save" | "reload">();
  const [needsReload, setNeedsReload] = useState(false);
  const active = useRef<AbortController | null>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const stored = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focus = useRef<"key" | "replace" | "notice" | null>(null);
  const showKey = !setting.configured || replaceKey;

  useEffect(() => () => active.current?.abort(), []);
  useLayoutEffect(() => {
    const next = focus.current;
    focus.current = null;
    if (next === "replace") stored.current?.querySelector("button")?.focus();
    else if (next) (next === "key" ? keyField : status).current?.focus();
  });

  function notify(tone: Notice["tone"], text: string) {
    focus.current = "notice";
    setNotice({ tone, text });
  }

  function clearKey() {
    if (keyField.current) keyField.current.value = "";
  }

  function apply(saved: StyleDnaGenerationSetting) {
    clearKey();
    setSetting(saved);
    setReplaceKey(false);
    setNeedsReload(false);
  }

  async function reload(signal: AbortSignal, conflict: boolean) {
    setBusy("reload");
    const result = await readStyleDnaGenerationSettings(signal);
    if (signal.aborted) return;
    if (result.kind === "login" || result.kind === "forbidden") return onDenied(result.kind);
    // 다시 읽었는데 이 공급자 칸이 사라졌으면(서버가 BFL 연결을 되돌림) 불러오기 실패로 다룬다.
    const next = result.kind === "ok" ? result.value.providers[provider] : undefined;
    if (result.kind === "ok" && next) {
      apply(next);
      notify(conflict ? "warning" : "success", conflict
        ? "다른 곳에서 키를 바꿨어요. 최신 등록 상태를 불러왔으니 확인한 뒤 다시 입력해 주세요."
        : "최신 등록 상태를 불러왔어요.");
      return;
    }
    setNeedsReload(true);
    notify("danger", conflict
      ? "다른 곳에서 키를 바꿨어요. 저장하려면 최신 등록 상태를 다시 불러와 주세요."
      : "최신 등록 상태를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
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
    if (!showKey) {
      notify("warning", "키를 바꾸려면 'API 키 교체'를 누르고 새 키를 입력해 주세요.");
      return;
    }
    // 서버와 같은 공통 판정: 다듬거나 잘라서 보내지 않는다(앞뒤 공백·줄바꿈이 섞이면 그대로 거절).
    const apiKey = keyField.current?.value ?? "";
    const issue = !apiKey ? "API 키를 입력해 주세요." : !acceptsGenerationKey(apiKey) ? generationKeyFormatHint : undefined;
    setError(issue);
    if (issue) {
      focus.current = "key";
      setNotice(undefined);
      return;
    }
    clearKey();
    setNotice(undefined);
    setBusy("save");
    const expectedVersion = setting.version;
    void run(async signal => {
      const result = await saveStyleDnaGenerationSetting({ provider, expectedVersion, apiKey }, signal);
      if (signal.aborted) return;
      if (result.kind === "login" || result.kind === "forbidden") return onDenied(result.kind);
      if (result.kind === "ok") {
        apply(result.value.setting);
        notify("success", `${item.name} 키를 저장했어요(등록 버전 ${result.value.setting.version}). 이미지 분석기를 다시 열면 결과 테스트에 ${item.modelName}가 나타나요.`);
        return;
      }
      if (result.kind === "stale") return reload(signal, true);
      if (result.kind === "invalid") {
        notify("danger", "API 키를 확인한 뒤 다시 저장해 주세요.");
        return;
      }
      // 422·429: 서버가 이번 저장을 받지 않았다(형식 거절·요청 제한). 칸은 이미 비웠으니 다시 입력해 저장한다.
      if (result.kind === "invalid_key" || result.kind === "quota_exceeded") {
        notify("danger", result.kind === "invalid_key" ? generationInvalidKeyNotice(provider) : generationSaveNotices[result.kind]);
        return;
      }
      // 504·503·그 밖: 저장됐는지 알 수 없다. 칸을 잠그고 '최신 등록 상태 다시 불러오기'(GET)를 거친 뒤에만 다시 저장할 수 있다.
      setNeedsReload(true);
      notify("danger", generationSaveNotices[result.kind === "timed_out" || result.kind === "storage" ? result.kind : "failed"]);
    });
  }

  const keyId = `${id}-key`;
  return <Card className={styles.card} data-provider={provider} data-kind="generation">
    <GenerationHeader provider={provider} />
    <p className={`${styles.state} ${styles.stateBadge}`} role="status" aria-label={`${item.name} 등록 상태`}
      data-tone={setting.configured ? "success" : "warning"}>{setting.configured ? `등록됨 · 버전 ${setting.version}` : "등록 안 됨"}</p>
    <AdminProviderForm label={`${item.name} 생성 키 등록`} busy={!!busy} onSubmit={submit}
      target={<><span>키 적용 대상</span><p className={styles.targetValue}>시험 이미지 생성</p></>}
      keys={<fieldset className={styles.fieldset} disabled={!!busy || needsReload}>
        <legend>API 키</legend>
        <div className={styles.field}>
          {showKey ? <label htmlFor={keyId}>{setting.configured ? "새 이미지 생성 API 키" : "이미지 생성 API 키"}</label>
            : <span className={styles.help}>이미지 생성 API 키</span>}
          {showKey ? <>
            <input id={keyId} ref={keyField} name={`${provider}-generation-key`} type="password" autoComplete="new-password" spellCheck={false}
              autoCapitalize="off" aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${keyId}-error` : undefined}
              onChange={() => { if (error) setError(undefined); }}
              onPaste={event => {
                // 한 줄 칸은 붙여 넣은 줄바꿈을 브라우저가 지워 두 줄이 한 키로 합쳐진다. 원문에 키 밖 글자가 있으면 넣지 않는다.
                if (styleDnaGenerationKeyCharacters(event.clipboardData.getData("text/plain"))) return;
                event.preventDefault();
                setError(generationKeyPasteHint);
              }} />
            {error && <p className={styles.error} id={`${keyId}-error`}>{error}</p>}
            {setting.configured && <Button variant="ghost" size="sm" onClick={() => {
              clearKey(); setReplaceKey(false); setError(undefined); focus.current = "replace";
            }}>교체 취소</Button>}
          </> : <div ref={stored} className={styles.keyStored}>
            <span className={styles.help}>저장된 키가 있어요. 키 값은 다시 보여 주지 않아요.</span>
            <Button variant="secondary" size="sm" onClick={() => { setReplaceKey(true); focus.current = "key"; }}>API 키 교체</Button>
          </div>}
        </div>
      </fieldset>}
      models={<fieldset className={styles.fieldset} disabled={!!busy || needsReload}>
        <legend>생성 모델</legend>
        <p className={styles.help}>{item.model} · {item.size} 고정이에요. 모델은 고를 수 없어요.</p>
      </fieldset>}
      notice={<p ref={status} tabIndex={-1} role="status" className={styles.notice} data-tone={notice?.tone}>{notice?.text ?? ""}</p>}>
      {needsReload
        ? <Button variant="secondary" size="sm" loading={busy === "reload"} loadingLabel="불러오는 중"
          onClick={() => { void run(signal => reload(signal, false)); }}>최신 등록 상태 다시 불러오기</Button>
        : <Button type="submit" disabled={busy === "reload" || !showKey} loading={busy === "save"} loadingLabel="저장 중">저장</Button>}
    </AdminProviderForm>
  </Card>;
}

export function StyleDnaGenerationSettingsCards() {
  const [read, setRead] = useState<ReadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readStyleDnaGenerationSettings(controller.signal).then(result => { if (!controller.signal.aborted) setRead(result); });
    return () => controller.abort();
  }, [attempt]);
  return shown(read.kind === "ok" ? read.value : undefined).map(provider => read.kind === "ok"
    ? <GenerationCard key={provider} provider={provider} initial={read.value.providers[provider]!} onDenied={kind => setRead({ kind })} />
    : <Card className={styles.card} key={provider} data-provider={provider} data-kind="generation">
      <GenerationHeader provider={provider} />
      {read.kind === "loading" ? <p role="status">등록 상태를 불러오고 있어요.</p>
        : read.kind === "login" ? <p role="status">로그인이 끝났어요. <a className={styles.link} href={loginLink}>관리자 로그인</a></p>
        : read.kind === "forbidden" ? <p role="status">이 계정에는 생성 키 설정을 볼 권한이 없어요.</p>
        : <div className={styles.failed}>
          <p role="status">{read.kind === "storage" ? "이미지 생성 키 저장소에 연결할 수 없어요." : "생성 키 등록 상태를 불러오지 못했어요."}</p>
          <Button variant="secondary" size="sm" onClick={() => { setRead({ kind: "loading" }); setAttempt(value => value + 1); }}>다시 불러오기</Button>
        </div>}
    </Card>);
}
