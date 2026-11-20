"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import {
  credentialGroups, isKeyFormat, isModelId, readCredentialSettings, saveCredentialSettings, testCredential,
  type CredentialField, type CredentialGroup, type CredentialOutcome, type CredentialProgram, type CredentialSettings,
  type CredentialTest, type CredentialTestCode,
} from "./gemini-credentials-client";
import styles from "./admin-gemini-settings.module.css";

// P0 Gemini 설정(Design msg_72dad930c7d0, Backend msg_bb18c2ae5fd0·msg_cb4ee4e63485):
// 환경·저장 상태 → 키(이미지·쇼츠 공용 / 음악 별도) → 모델 ID → 설정 저장 → 분석기별 연결 시험.
// 키는 화면 상태에 담지 않고 가려진 입력에만 두며, 저장에 성공한 묶음의 입력은 바로 지운다.
const loginLink = adminLoginPath({ next: "/admin#admin-api-integrations" });
const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const groupOrder = ["reference", "music"] as const satisfies readonly CredentialGroup[];
const programOrder = ["image", "music", "shorts"] as const satisfies readonly CredentialProgram[];
const groupOf: Record<CredentialProgram, CredentialGroup> = { image: "reference", shorts: "reference", music: "music" };
const groupText: Record<CredentialGroup, { name: string; key: string }> = {
  reference: { name: "이미지·쇼츠", key: "이미지·쇼츠 공용 API 키" },
  music: { name: "음악", key: "음악 API 키" },
};
const programText: Record<CredentialProgram, string> = { image: "이미지 분석", music: "음악 분석", shorts: "쇼츠 분석" };

type Read = { kind: "loading" } | { kind: "login" } | { kind: "forbidden" } | { kind: "failed" } | { kind: "ok"; value: CredentialSettings };
type Notice = { tone: "success" | "warning" | "danger"; text: string };
type TestNotice = Notice & { retry?: { group: CredentialGroup; keptEdits: boolean } };
type Models = Record<CredentialProgram, string>;
type Testing = Partial<Record<CredentialProgram, CredentialTest | "pending" | "stale" | "error">>;

function keyState(settings: CredentialSettings, group: CredentialGroup) {
  const sources = credentialGroups[group].map(program => settings.programs[program].source);
  if (sources.includes("stored")) return { text: "키 저장됨", tone: "success" } as const;
  if (sources.includes("environment")) return { text: "서버 제공 설정 사용 중", tone: "neutral" } as const;
  return { text: "미등록", tone: "warning" } as const;
}

function failureText(outcome: Exclude<CredentialOutcome, { kind: "ok" } | { kind: "field" }>) {
  switch (outcome.kind) {
    case "login": return "로그인이 끝났어요. 다시 로그인한 뒤 저장해 주세요.";
    case "forbidden": return "이 계정에는 키를 등록할 권한이 없어요.";
    case "stale": return "다른 곳에서 먼저 설정이 바뀌어 최신 설정을 다시 불러왔어요. 확인한 뒤 다시 저장해 주세요.";
    case "storage": return "서버의 키 저장소가 준비되지 않아 저장하지 못했어요.";
    case "provider": return "Gemini가 응답하지 않아 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
    case "timeout": return "Gemini 확인이 늦어져 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
    default: return "저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.";
  }
}

function fieldMessage(field: CredentialField, code: "invalid_input" | "invalid_key" | "model_not_found" | "required") {
  if (field === "apiKey") return code === "invalid_key" ? "Gemini가 이 키를 받아들이지 않았어요. 키를 확인해 주세요."
    : code === "required" ? "처음 저장할 때는 API 키가 필요해요." : "키 형식을 확인해 주세요. 영문·숫자·밑줄·하이픈 16~256자예요.";
  if (code === "model_not_found") return "Gemini에서 이 모델을 찾지 못했거나 이 키로 쓸 수 없어요.";
  return "모델 ID는 영문·숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 128자까지 쓸 수 있어요(models/ 없이).";
}

const testCause: Record<CredentialTestCode, string> = {
  invalid_key: "키 확인 필요", model_not_found: "모델 ID 또는 사용 권한 확인", provider_error: "Gemini 응답 오류", timed_out: "응답 지연",
};

// 시험은 화면에서 저장한 묶음(버전 1 이상)만 할 수 있고, 결과는 지금 저장된 버전과 같을 때만 그대로 보여 준다.
function testState(settings: CredentialSettings, program: CredentialProgram, local: Testing[CredentialProgram]) {
  const version = settings.groups[groupOf[program]].version;
  const item = settings.programs[program];
  if (version === 0) return { text: item.configured ? "서버 제공 설정 사용 중 · 키 등록 후 시험" : "미등록", tone: item.configured ? "neutral" : "warning" } as const;
  if (local === "pending") return { text: "시험 중", tone: "neutral" } as const;
  if (local === "stale") return { text: "설정이 바뀌어 다시 시험 필요", tone: "warning" } as const;
  if (local === "error") return { text: "시험하지 못했어요", tone: "danger" } as const;
  const result = local ?? item.lastTest ?? null;
  if (!result) return { text: "저장됨 · 시험 전", tone: "neutral" } as const;
  if (result.version !== version) return { text: "다시 시험 필요", tone: "warning" } as const;
  return result.status === "verified"
    ? { text: "연결 확인", tone: "success", at: result.checkedAt } as const
    : { text: `시험 실패 · ${result.code ? testCause[result.code] : "원인 미확인"}`, tone: "danger", at: result.checkedAt } as const;
}

function SettingsForm({ settings, onSaved, onStale, onLogin }: {
  settings: CredentialSettings; onSaved: (value: CredentialSettings) => void; onStale: () => Promise<CredentialSettings | null>; onLogin: () => void;
}) {
  const base = useId();
  const ready = settings.storage === "ready";
  const savedModels = (): Models => ({ image: settings.programs.image.modelId ?? "", music: settings.programs.music.modelId ?? "", shorts: settings.programs.shorts.modelId ?? "" });
  const [models, setModels] = useState(savedModels);
  const [keyOpen, setKeyOpen] = useState<Record<CredentialGroup, boolean>>({ reference: false, music: false });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Testing>({});
  const [rechecking, setRechecking] = useState(false);
  const [testNotice, setTestNotice] = useState<TestNotice | null>(null);
  // 시험이 409를 받았는데 최신 설정을 아직 못 읽은 묶음. 그동안 그 묶음의 시험은 옛 버전을 보내지 않도록 잠근다.
  const [needsRefresh, setNeedsRefresh] = useState<CredentialGroup | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const testNoticeRef = useRef<HTMLParagraphElement>(null);
  const referenceKey = useRef<HTMLInputElement>(null);
  const musicKey = useRef<HTMLInputElement>(null);
  const keyRef = (group: CredentialGroup): RefObject<HTMLInputElement | null> => group === "reference" ? referenceKey : musicKey;
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const requests = useRef(new Set<AbortController>());
  const versions = useRef({ reference: settings.groups.reference.version, music: settings.groups.music.version });
  const savedRef = useRef<Models>(savedModels());
  // 초점은 그린 직후 옮긴다(새로 열린 입력 포함). 화면 밖 탭에서도 동작하도록 rAF를 쓰지 않는다.
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (target === "notice" ? noticeRef.current : target === "test-notice" ? testNoticeRef.current : document.getElementById(target))?.focus();
  });
  useEffect(() => { const active = requests.current; return () => active.forEach(controller => controller.abort()); }, []);
  // 서버 버전이 바뀌면(저장·다시 불러오기) 바뀐 묶음의 모델 입력 중 사용자가 고치지 않은 칸만 새 저장값으로 맞추고,
  // 바뀐 묶음의 화면 시험 표시는 버린다. 저장하지 않은 입력은 덮어쓰지 않는다.
  useEffect(() => {
    const changed = groupOrder.filter(group => versions.current[group] !== settings.groups[group].version);
    if (!changed.length) return;
    versions.current = { reference: settings.groups.reference.version, music: settings.groups.music.version };
    const before = savedRef.current;
    const after = savedModels();
    savedRef.current = after;
    setModels(previous => {
      const next = { ...previous };
      for (const group of changed) for (const program of credentialGroups[group]) if (previous[program].trim() === before[program]) next[program] = after[program];
      return next;
    });
    setTesting(previous => Object.fromEntries(Object.entries(previous).filter(([program]) => !changed.includes(groupOf[program as CredentialProgram]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.groups.reference.version, settings.groups.music.version]);

  const id = (name: string) => `${base}-${name.replace(".", "-")}`;
  const keyId = (group: CredentialGroup) => id(`${group}-key`);
  const showKey = (group: CredentialGroup) => settings.groups[group].version === 0 || keyOpen[group];
  const track = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
  const clearKey = (group: CredentialGroup) => { const input = keyRef(group).current; if (input) input.value = ""; };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !ready) return;
    const local: Record<string, string> = {};
    const plans: { group: CredentialGroup; apiKey: string; models: Partial<Models> }[] = [];
    for (const group of groupOrder) {
      const programs = credentialGroups[group];
      const apiKey = showKey(group) ? keyRef(group).current?.value.trim() ?? "" : "";
      const changed = programs.some(program => models[program].trim() !== (settings.programs[program].modelId ?? ""));
      if (!apiKey && !changed) continue;
      if (settings.groups[group].version === 0 && !apiKey) local[keyId(group)] = fieldMessage("apiKey", "required");
      else if (apiKey && !isKeyFormat(apiKey)) local[keyId(group)] = fieldMessage("apiKey", "invalid_input");
      for (const program of programs) if (!isModelId(models[program].trim())) local[id(`models.${program}`)] = fieldMessage(`models.${program}`, "invalid_input");
      plans.push({ group, apiKey, models: Object.fromEntries(programs.map(program => [program, models[program].trim()])) });
    }
    setErrors(local);
    const firstInvalid = Object.keys(local)[0];
    if (firstInvalid) { pendingFocus.current = firstInvalid; setNotice(null); return; }
    pendingFocus.current = "notice";
    if (!plans.length) { setNotice({ tone: "warning", text: "바뀐 내용이 없어요. 키를 넣거나 모델 ID를 바꾼 뒤 저장해 주세요." }); return; }
    pendingFocus.current = null;
    setNotice(null);
    setSaving(true);
    const saved: CredentialGroup[] = [];
    // 각 묶음은 사용자가 보고 고친 버전으로 보낸다. 앞 묶음 저장 응답에 실린 다른 묶음의 새 버전을 쓰면 다른 탭의 변경을 덮어쓴다.
    const basis = { reference: settings.groups.reference.version, music: settings.groups.music.version };
    for (const plan of plans) {
      const controller = track();
      let outcome: CredentialOutcome;
      try {
        outcome = await saveCredentialSettings({ group: plan.group, expectedVersion: basis[plan.group],
          apiKey: plan.apiKey || undefined, models: plan.models }, controller.signal);
      } catch { return; } finally { requests.current.delete(controller); }
      if (outcome.kind === "ok") {
        clearKey(plan.group);
        setKeyOpen(previous => ({ ...previous, [plan.group]: false }));
        saved.push(plan.group);
        onSaved(outcome.value);
        continue;
      }
      setSaving(false);
      const done = saved.length ? `${saved.map(group => groupText[group].name).join("·")} 설정은 저장했어요. ` : "";
      if (outcome.kind === "field") {
        const target = outcome.field === "apiKey" ? keyId(plan.group) : id(outcome.field);
        if (outcome.field === "apiKey") setKeyOpen(previous => ({ ...previous, [plan.group]: true }));
        setErrors({ [target]: fieldMessage(outcome.field, outcome.code) });
        pendingFocus.current = target;
        setNotice(done ? { tone: "warning", text: `${done}${groupText[plan.group].name} 설정은 저장하지 못했어요.` } : null);
        return;
      }
      if (outcome.kind === "login" || outcome.kind === "forbidden") groupOrder.forEach(clearKey);
      if (outcome.kind === "login") { onLogin(); return; }
      if (outcome.kind === "stale") await onStale();
      pendingFocus.current = "notice";
      setNotice({ tone: outcome.kind === "stale" || outcome.kind === "forbidden" ? "warning" : "danger", text: done + failureText(outcome) });
      return;
    }
    setSaving(false);
    pendingFocus.current = "notice";
    setNotice({ tone: "success", text: `저장했어요. Gemini에서 ${plans.some(plan => plan.apiKey) ? "키와 " : ""}모델 정보를 확인했어요. 아래에서 연결 시험을 해 보세요.` });
  }

  async function refreshAfterStale(group: CredentialGroup, keptEdits: boolean) {
    setNeedsRefresh(group);
    setRefreshing(true);
    const latest = await onStale();
    setRefreshing(false);
    pendingFocus.current = "test-notice";
    if (!latest) {
      setTestNotice({ tone: "danger", text: `다른 곳에서 ${groupText[group].name} 설정이 바뀌었는데 최신 설정을 불러오지 못했어요. 다시 불러온 뒤 시험해 주세요.`, retry: { group, keptEdits } });
      return;
    }
    setNeedsRefresh(null);
    setTestNotice({ tone: "warning", text: `다른 곳에서 ${groupText[group].name} 설정이 바뀌어 최신 설정을 불러왔어요.${keptEdits ? " 저장하지 않은 입력은 그대로 두었어요." : ""} 다시 시험해 주세요.` });
  }

  async function runTest(program: CredentialProgram) {
    if (testing[program] === "pending") return;
    const group = groupOf[program];
    const version = settings.groups[group].version;
    setTesting(previous => ({ ...previous, [program]: "pending" }));
    setTestNotice(null);
    const controller = track();
    let outcome;
    try { outcome = await testCredential({ program, group, version }, controller.signal); } catch { return; } finally { requests.current.delete(controller); }
    if (outcome.kind === "login") { onLogin(); return; }
    // 다른 곳에서 설정이 바뀌어 409가 오면 최신 설정(모델·버전)을 다시 읽는다. 시험은 자동으로 다시 하지 않는다.
    if (outcome.kind === "stale") {
      setTesting(previous => ({ ...previous, [program]: "stale" }));
      await refreshAfterStale(group, credentialGroups[group].some(item => models[item].trim() !== (settings.programs[item].modelId ?? "")));
      return;
    }
    // 늦게 온 이전 버전의 결과는 지금 설정에 적용하지 않는다.
    const next = outcome.kind === "ok" ? outcome.value.version === versions.current[group] ? outcome.value : "stale" : "error";
    setTesting(previous => ({ ...previous, [program]: next }));
  }

  const describe = (fieldKey: string, help?: string) => [help && `${fieldKey}-help`, errors[fieldKey] && `${fieldKey}-error`].filter(Boolean).join(" ") || undefined;
  const fieldError = (fieldKey: string) => errors[fieldKey] && <p id={`${fieldKey}-error`} className={styles.error}>{errors[fieldKey]}</p>;
  const dirty = programOrder.some(program => models[program].trim() !== (settings.programs[program].modelId ?? ""));

  return <>
    <dl className={styles.status} aria-label="Gemini 키 저장 상태">
      <div><dt>저장 위치</dt><dd data-tone={ready ? "success" : "warning"}>{ready ? "서버 키 저장소" : "서버 키 저장소 미연결"}</dd></div>
      {groupOrder.map(group => {
        const state = keyState(settings, group);
        const updated = settings.groups[group].updatedAt;
        return <div key={group}><dt>{groupText[group].name} 키</dt>
          <dd data-tone={state.tone}>{state.text}{updated && <> · 변경 <time dateTime={updated}>{time.format(new Date(updated))}</time></>}</dd></div>;
      })}
    </dl>
    {!ready && <div className={styles.unavailable}>
      <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice} data-tone="warning">
        서버 키 저장소에 연결되지 않아 지금은 이 화면에서 저장할 수 없어요. 서버 제공 설정이 있으면 분석기는 그 설정을 써요.{notice ? ` ${notice.text}` : ""}
      </p>
      <Button type="button" variant="secondary" size="sm" loading={rechecking} loadingLabel="다시 확인 중" onClick={async () => {
        setRechecking(true);
        const latest = await onStale();
        setRechecking(false);
        pendingFocus.current = "notice";
        setNotice(!latest ? { tone: "danger", text: "상태를 다시 불러오지 못했어요." }
          : latest.storage === "ready" ? { tone: "success", text: "저장소에 연결됐어요. 이제 저장할 수 있어요." }
          : { tone: "warning", text: "다시 확인했지만 아직 연결되지 않았어요." });
      }}>저장소 다시 확인</Button>
      <a className={styles.link} href="#admin-manual">설정 방법 보기</a>
    </div>}
    <form className={styles.form} onSubmit={submit} noValidate aria-label="Gemini 키와 모델 ID" aria-busy={saving || undefined}>
      <div className={styles.columns}>
      <fieldset className={styles.fieldset} disabled={!ready || saving}>
        <legend>API 키</legend>
        <div className={styles.grid}>
          {groupOrder.map(group => {
            const key = keyId(group);
            const stored = settings.groups[group].version > 0;
            return <div className={styles.field} key={group}>
              <label htmlFor={key}>{groupText[group].key}</label>
              {showKey(group) ? <>
                <input ref={keyRef(group)} id={key} name={`${group}-api-key`} type="password" autoComplete="off" spellCheck={false} autoCapitalize="off"
                  maxLength={256} aria-invalid={!!errors[key]} aria-describedby={describe(key, "help")} />
                <p id={`${key}-help`} className={styles.help}>{stored ? "비워 두면 저장된 키를 그대로 써요. " : ""}저장한 키는 다시 보여 주지 않아요.</p>
                {fieldError(key)}
                {stored && <Button type="button" variant="ghost" size="sm" onClick={() => {
                  clearKey(group);
                  setKeyOpen(previous => ({ ...previous, [group]: false }));
                  setErrors(previous => ({ ...previous, [key]: undefined }));
                }}>교체 취소</Button>}
              </> : <div className={styles.keyStored}>
                <span id={`${key}-help`} className={styles.help}>저장된 키를 써요. 값은 보이지 않아요.</span>
                <Button type="button" variant="secondary" size="sm" aria-describedby={`${key}-help`}
                  onClick={() => { pendingFocus.current = key; setKeyOpen(previous => ({ ...previous, [group]: true })); }}>{groupText[group].name} 키 교체</Button>
              </div>}
            </div>;
          })}
        </div>
      </fieldset>
      <fieldset className={styles.fieldset} disabled={!ready || saving}>
        <legend>모델 ID</legend>
        <div className={styles.grid}>
          {programOrder.map(program => {
            const field = id(`models.${program}`);
            return <div className={styles.field} key={program}>
              <label htmlFor={field}>{programText[program]} 모델 ID</label>
              <input id={field} name={`models.${program}`} type="text" autoComplete="off" spellCheck={false} autoCapitalize="off" maxLength={128}
                value={models[program]} aria-invalid={!!errors[field]} aria-describedby={describe(field)}
                onChange={event => { const value = event.target.value; setModels(previous => ({ ...previous, [program]: value })); }} />
              {fieldError(field)}
            </div>;
          })}
        </div>
      </fieldset>
      </div>
      {ready && <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice} data-tone={notice?.tone}>{notice?.text ?? ""}</p>}
      <div><Button type="submit" loading={saving} loadingLabel="Gemini에서 확인 중" disabled={!ready}>설정 저장</Button></div>
    </form>
    <section className={styles.tests} aria-labelledby={`${base}-tests`}>
      <h5 id={`${base}-tests`}>연결 시험</h5>
      <p className={styles.help}>저장된 설정으로 각 분석기의 Gemini 모델 정보를 확인해요. 원본 자료나 분석 요청은 보내지 않아요.{dirty ? " 바꾼 모델 ID는 먼저 저장해 주세요." : ""}</p>
      <p ref={testNoticeRef} tabIndex={-1} role="status" className={styles.notice} data-tone={testNotice?.tone}>{testNotice?.text ?? ""}</p>
      {testNotice?.retry && <div><Button type="button" variant="secondary" size="sm" loading={refreshing} loadingLabel="불러오는 중"
        onClick={() => { const retry = testNotice.retry!; void refreshAfterStale(retry.group, retry.keptEdits); }}>최신 설정 다시 불러오기</Button></div>}
      <ul>
        {programOrder.map(program => {
          const state = testState(settings, program, testing[program]);
          const at = "at" in state ? state.at : undefined;
          return <li key={program}>
            <div>
              <strong>{programText[program]}</strong>
              <span className={styles.help}>{settings.programs[program].modelId ?? "모델 미설정"}</span>
            </div>
            <p className={styles.state} role="status" aria-label={`${programText[program]} 연결 상태`} data-tone={state.tone}>
              {state.text}{at && <> · 최근 확인 <time dateTime={at}>{time.format(new Date(at))}</time></>}
            </p>
            <Button type="button" variant="secondary" size="sm" loading={testing[program] === "pending"} loadingLabel="시험 중"
              disabled={settings.groups[groupOf[program]].version === 0 || saving || needsRefresh === groupOf[program]} onClick={() => void runTest(program)}>
              {programText[program]} 연결 시험
            </Button>
          </li>;
        })}
      </ul>
    </section>
  </>;
}

export function GeminiSettingsCard() {
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    void readCredentialSettings(controller.signal).then(outcome => {
      if (controller.signal.aborted) return;
      setRead(outcome.kind === "ok" ? outcome : outcome.kind === "login" || outcome.kind === "forbidden" ? { kind: outcome.kind } : { kind: "failed" });
    }, () => {});
    return () => controller.abort();
  }, [attempt]);

  // 최신 설정을 다시 읽어 화면에 반영하고 그 값을 돌려준다. 읽지 못했으면 null.
  async function reload() {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const outcome = await readCredentialSettings(controller.signal).catch(() => null);
    if (!outcome || controller.signal.aborted) return null;
    if (outcome.kind === "ok") setRead(outcome);
    else if (outcome.kind === "login" || outcome.kind === "forbidden") setRead({ kind: outcome.kind });
    return outcome.kind === "ok" ? outcome.value : null;
  }

  return <Card className={styles.card}>
    <div className={styles.head}>
      <h4>Gemini 설정</h4>
      <p className={styles.help}>분석기에 쓸 Gemini 키와 모델 ID를 서버에 저장해요. 저장할 때 Gemini에서 키와 모델 정보를 확인하고, 분석기별 연결은 연결 시험으로 확인해요.</p>
    </div>
    <div aria-live="polite">
      {read.kind === "loading" && <p role="status">Gemini 설정을 불러오고 있어요.</p>}
      {read.kind === "login" && <p role="status">로그인이 끝났어요. <a className={styles.link} href={loginLink}>관리자 로그인</a></p>}
      {read.kind === "forbidden" && <p role="status">이 계정에는 Gemini 설정을 볼 권한이 없어요.</p>}
      {read.kind === "failed" && <div className={styles.failed}>
        <p role="status">Gemini 설정을 불러오지 못했어요.</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => { setRead({ kind: "loading" }); setAttempt(value => value + 1); }}>다시 불러오기</Button>
      </div>}
    </div>
    {read.kind === "ok" && <SettingsForm settings={read.value} onSaved={value => setRead({ kind: "ok", value })} onStale={reload} onLogin={() => setRead({ kind: "login" })} />}
    <p className={styles.help}>키는 서버에만 저장되고 이 화면이나 브라우저에 남지 않아요. <a className={styles.link} href="#admin-manual">키와 모델 설정 방법</a></p>
  </Card>;
}
