"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import { imageAnalysisSection } from "./admin-paths";
import { styleDnaImageModels, styleDnaRatio, styleDnaTestPromptLimit, type StyleDnaOptions, type StyleDnaRecord, type StyleDnaTestResult } from "@/lib/reference-analysis/style-dna-contract";
import type { ReadyResult } from "./admin-reference-analysis-model";
import { nearestAspectRatio, StyleDnaReport } from "./admin-style-dna-report";
import {
  analyzeRequest, analyzeStyleDna, compareStyleDna, engineBasisText, engineLabel, fileSha256, fillSubject, needsSubject, newRequestId, paletteProximity, readEngineCredentials,
  deleteStyleDna, readStyleDnaLibrary, readStyleDnaRecord, referenceImage, refineRequest, refineStyleDna, testRequest, testStyleDna, testUploadRequest,
  type AnalyzeSource, type EngineChoice, type EngineCredentials, type LibraryOutcome, type OpOutcome, type StyleDnaCode,
} from "./style-dna-client";
import { FlaskConical, HelpCircle, Loader2, Microscope, Moon, Sliders, Sparkles, Sun, Upload, Wand2 } from "./style-dna-original/icons";
import { StudioCameraLighting, StudioDnaBars, StudioHelp, StudioPalette, StudioReport, StudioReportWaiting, StudioScanOverlay } from "./style-dna-original/studio-parts";
import { REFINE_QUICK, StudioRefine } from "./style-dna-original/studio-refine";
import { StudioTest } from "./style-dna-original/studio-test";
import { StudioLibrary, type LibraryNote, type LibraryState } from "./style-dna-original/studio-library";
import { studioContext } from "./admin-studio-return";
import { LoadedNotice, StudioCompare } from "./style-dna-original/studio-compare";
import { previewPalette, studioView } from "./style-dna-original/studio-data";
import { StudioShell } from "./style-dna-original/studio-shell";
import studio from "./style-dna-original/studio.module.css";
import panel from "./admin-reference-analysis.module.css";
import styles from "./admin-style-dna-workflow.module.css";

// P1-06 Style DNA 작업실: 원본 v1.39의 ① 이미지 분석 → ② 프롬프트 보정 → ③ 결과 테스트와 보관함·다시 열기를 Backend ab798b1 전용 API로 잇는다.
// 분석은 파일·직접 HTTPS 주소·보관 기록 재분석, 복제·변형(강도 0~100)·분석 지침·첨부 이미지 구문·대상 모델 문법을 보낸다. 결과는 기존 Style DNA 보고서
// (픽셀 측정·비율·구도·조명 근거·한영 프롬프트)를 그대로 쓰고, 서버 실측 5색 팔레트를 함께 보여 준다. 보정은 최신 버전에만 피드백을 보내 새 버전을 쌓고,
// 시험은 고른 버전의 프롬프트로 이미지 1장을 만들어 원본과 슬라이더로 비교한다(색 근접도는 서버 실측 5색으로 화면에서 계산).
// 모든 호출은 따로 동의해야 나가고, 동의는 그때 고른 엔진(Gemini·OpenAI·Anthropic)과 모델·등록 버전에 묶인다(엔진을 바꾸면 풀림, 시험 생성은 언제나 Gemini). 진행 중 다른 기록을 열거나 메뉴를 떠나면 요청을 끊고 늦은 응답을 버린다.
// 연결이 끊기면 같은 요청 ID·같은 내용으로만 다시 확인한다(서버가 새 호출 없이 저장된 결과를 돌려준다).
// P1-06 원본 전체 화면(/admin/style-dna, layout="original")은 원본 사이드바 껍데기 안에서 그리고 로그인 뒤 같은 화면으로 돌아온다.
const panelLogin = adminLoginPath({ next: "/admin#admin-style-dna" });
const originalLogin = adminLoginPath({ next: "/admin/style-dna" });
const LAST = "dream:style-dna:last";
const UPLOAD_LIMIT = 4 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const LIMITS = { guidance: 800, feedback: 600, subject: 500, url: 4096 };
type Step = "library" | "analyze" | "refine" | "test";
type ConsentStep = "refine" | "test";
type Model = StyleDnaTestResult["model"];
const modelIds = Object.keys(styleDnaImageModels) as Model[];
export const mutationStage = (level: number) => level <= 30 ? { label: "안정", full: "안정 (원본 스타일 충실)", desc: "원본 스타일 엄격 보존, 미세 질감 개선만" }
  : level <= 70 ? { label: "조화", full: "조화 (스타일 변형·응용)", desc: "구도 유지, 아트스타일·조명 적극 변형" }
  : { label: "파격", full: "파격 (과감한 재해석)", desc: "핵심 축만 유지, 대담하고 새로운 재해석" };
export const modeText = (record: Pick<StyleDnaRecord, "mode" | "options">) =>
  record.mode === "replicate" ? "스타일 복제" : `스타일 변형 ${record.options.mutationLevel}%(${mutationStage(record.options.mutationLevel).label})`;
const when = (value: string) => new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
const day = (value: string) => new Date(value).toLocaleDateString("ko-KR");
const LIBRARY_LIMIT = 100;
const noSubscribe = () => () => {};
const messages: Record<StyleDnaCode, string> = {
  invalid_input: "입력을 확인해 주세요. 주소는 직접 열리는 HTTPS 이미지여야 해요.",
  too_large: "이미지가 4MiB를 넘어요. 더 작은 파일을 골라 주세요.",
  not_found: "기록이나 원본 이미지를 찾을 수 없어요. 보관함을 다시 불러와 주세요.",
  stale_credential: "Gemini 등록 버전이 바뀌었어요. 최신 설정을 다시 읽었으니 다시 동의하고 실행해 주세요.",
  stale_revision: "다른 곳에서 새 보정 버전이 먼저 저장됐어요. 최신 기록을 다시 읽었어요.",
  request_conflict: "같은 요청 번호에 다른 내용이 있어요. 다시 동의하고 새로 실행해 주세요.",
  limit_reached: "보관 한도(100개)에 닿았어요.",
  not_configured: "이미지 분석 모델이 등록되지 않았어요. API키등록·플랫폼연동에서 먼저 등록해 주세요.",
  storage_unavailable: "Style DNA 저장소가 준비되지 않았어요.",
  model_error: "Gemini가 결과를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  timed_out: "Gemini 응답 시간이 지났어요. 잠시 뒤 다시 시도해 주세요.",
  subject_required: "이 프롬프트에는 피사체 자리가 있어요. 피사체를 입력해 주세요.",
  in_progress: "아직 처리 중이에요. 잠시 뒤 '결과 다시 확인'을 눌러 주세요.",
  invalid_reference: "참조 이미지를 읽지 못했어요. PNG·JPG·WebP 이미지를 다시 골라 주세요.",
  reference_mismatch: "참조 이미지가 보내는 중에 바뀌었어요. 다시 골라 주세요.",
  unsupported_format: "참조 이미지는 PNG·JPG·WebP만 쓸 수 있어요.",
  stale_spot_version: "다른 곳에서 점검 지점이 바뀌었어요. 기록을 다시 불러와 주세요.",
  comparison_media_mismatch: "원본이나 결과 이미지가 기록과 달라요. 기록을 다시 열어 주세요.",
  comparison_unmeasured: "저장된 점검 지점이 없어 추세를 남길 수 없어요.",
  failed: "결과를 확인하지 못했어요. 다시 시도해 주세요.",
};
type Notice = { tone: "status" | "alert"; text: string; login?: boolean; retry?: boolean };
type Pending = { label: string; run: (signal: AbortSignal) => Promise<void> };
const store = { get: () => { try { return sessionStorage.getItem(LAST); } catch { return null; } },
  set: (id: string | null) => { try { if (id) sessionStorage.setItem(LAST, id); else sessionStorage.removeItem(LAST); } catch { /* 저장 불가면 다시 열기만 빠짐 */ } } };

type Props = { layout?: "panel" | "original" | "embedded"; account?: string };

export function AdminStyleDnaWorkflow({ layout = "panel", account = "" }: Props = {}) {
  const id = useId();
  const original = layout !== "panel";
  const embedded = layout === "embedded";
  const loginLink = embedded ? adminLoginPath({ next: `/admin#${imageAnalysisSection}` }) : original ? originalLogin : panelLogin;
  const settingsLink = layout === "original" ? "/admin#admin-api-integrations" : "#admin-api-integrations";
  const [library, setLibrary] = useState<LibraryOutcome | { kind: "loading" }>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [record, setRecord] = useState<StyleDnaRecord>();
  // 원본처럼 일반 진입 첫 화면은 보관함. 새로고침 뒤 마지막 기록 복귀·작업실 장면 링크(?project=&scene=)는 지금처럼 분석 화면으로 연다(Master msg_cfdcdc56f15f).
  // 사용자가 단계를 고르기 전(null)에는 작업실 장면 링크면 분석, 아니면 보관함(서버 그림은 보관함, 주소는 브라우저에서만 읽는다).
  const [pickedStep, setStep] = useState<Step | null>(null);
  const fromStudio = useSyncExternalStore(noSubscribe, () => !!studioContext(window.location.search), () => false);
  const step: Step = pickedStep ?? (embedded || fromStudio ? "analyze" : "library");
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [libraryNote, setLibraryNote] = useState<LibraryNote | null>(null);
  // 나중에 눌리는 '다시 확인'이 그때 열린 기록을 알 수 있게 열린 기록 ID를 따라간다(다른 기록을 열었으면 그 선택은 지우지 않는다).
  const openId = useRef<string | undefined>(undefined);
  const [running, setRunning] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [copied, setCopied] = useState("");
  // ① 분석
  const [sourceKind, setSourceKind] = useState<"file" | "url" | "record">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<StyleDnaOptions["mode"]>("replicate");
  const [mutationLevel, setMutationLevel] = useState(30);
  const [guidance, setGuidance] = useState("");
  const [includeImageTag, setIncludeImageTag] = useState(true);
  const [targetModel, setTargetModel] = useState<Model>("gemini-nano-banana-2.1");
  // 원본 분석 화면(P1-06 1단계): 밝은 화면이 기본, 도움말 창, 끌어다 놓기, 고른 파일 미리보기·브라우저 색 미리 추출(서버 전송 없음)
  const [dark, setDark] = useState(false);
  const [help, setHelp] = useState(false);
  const [drag, setDrag] = useState(false);
  const [picked, setPicked] = useState(false);
  const [preview, setPreview] = useState<{ url: string; colors: { hex: string; percent: number }[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // ② 보정 · ③ 시험
  const [feedback, setFeedback] = useState("");
  const [testRevision, setTestRevision] = useState<number | null>(null);
  const [testModel, setTestModel] = useState<Model>("gemini-nano-banana-2.1");
  const [subject, setSubject] = useState("");
  const [attach, setAttach] = useState(true);
  const [ratio, setRatio] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  // ③ 원본 3단계: 프롬프트 직접 편집(서버 customPrompt ≤2400)과 바꾼 참조 이미지(multipart customReference, 화면에서만 미리보기 주소).
  const [editing, setEditing] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  // 원본 v1.35: 추세 회차 프롬프트를 편집 칸으로 불러오기 전 상태(되돌리기용)
  const [loadedFrom, setLoadedFrom] = useState<{ round: number; prevPrompt: string; prevEditing: boolean } | null>(null);
  const [reference, setReference] = useState<{ file: File; href: string } | null>(null);
  // 분석·보정 엔진(서버 f2d7e63): 원본처럼 하나를 골라 분석과 보정에 함께 쓴다. OpenAI·Anthropic 설정은 키 원문 없이 등록 여부·모델·버전만 읽는다.
  const [engines, setEngines] = useState<EngineCredentials | null>(null);
  const [engine, setEngine] = useState<EngineChoice>("gemini");
  // 동의는 단계별로 그때 고른 엔진·모델·등록 버전에 묶는다(시험 생성은 Gemini 등록 버전).
  const [consent, setConsent] = useState<{ step: ConsentStep; version: number; engine: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const reading = useRef<AbortController | null>(null);
  const reopened = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void readStyleDnaLibrary(controller.signal).then(outcome => {
      setLibrary(outcome);
      // 새로고침 뒤 마지막으로 연 기록을 다시 연다(처음 한 번).
      if (outcome.kind !== "ok" || reopened.current) return;
      reopened.current = true;
      const last = store.get();
      if (last && outcome.items.some(item => item.id === last)) {
        setStep(current => current ?? "analyze");
        void open(last, true);
      }
    }, () => { if (!controller.signal.aborted) setLibrary({ kind: "failed" }); });
    void readEngineCredentials(controller.signal).then(value => { if (!controller.signal.aborted) setEngines(value); }, () => { /* 끊김 */ });
    return () => controller.abort();
    // open은 기록을 여는 일회성 동작이라 다시 읽기 기준(attempt)에만 묶는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(() => () => { active.current?.abort(); reading.current?.abort(); }, []);
  useEffect(() => { openId.current = record?.id; }, [record]);
  const previewUrl = useRef<string | null>(null);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const settings = library.kind === "ok" ? library.settings : null;
  const version = settings?.credentialVersion ?? 0;
  const ready = !!settings && version > 0 && !!settings.analysisModel;
  const engineSetting = engine === "gemini" ? null : engines?.[engine] ?? null;
  const engineModel = engine === "gemini" ? settings?.analysisModel ?? null : engineSetting?.configured ? engineSetting.modelId : null;
  const engineVersion = engine === "gemini" ? version : engineSetting?.version ?? 0;
  const engineReady = engine === "gemini" ? ready : !!settings && !!engineModel && engineVersion > 0;
  const engineKey = `${engine}:${engineModel ?? ""}`;
  const engineShort = { gemini: "Gemini", openai: "OpenAI", anthropic: "Claude" }[engine];
  const engineChoices = (["gemini", "openai", "anthropic"] as const).map(value => {
    const off = value !== "gemini" && !engines?.[value]?.configured;
    return { value, short: { gemini: "Gemini", openai: "OpenAI", anthropic: "Claude" }[value], label: `${engineLabel(value)}${off ? " (키 미등록)" : ""}`, disabled: off };
  });
  const engineWarn = !settings || engineReady ? null : engine === "gemini" ? "이미지 분석 모델이 등록되지 않았어요. API키등록·플랫폼연동에서 등록해 주세요."
    : `${engineLabel(engine)} 키가 등록되지 않았거나 바뀌었어요. API키등록·플랫폼연동에서 확인하거나 다른 AI를 선택해 주세요.`;
  const agreed = (target: ConsentStep) => target === "test" ? ready && consent?.step === "test" && consent.version === version
    : engineReady && consent?.step === target && consent.version === engineVersion && consent.engine === engineKey;
  const agree = (target: ConsentStep, checked: boolean) => {
    setNotice(null);
    setConsent(checked ? target === "test" ? { step: target, version, engine: "gemini" } : { step: target, version: engineVersion, engine: engineKey } : null);
  };
  /** 분석·보정 요청의 동작 값: 고른 엔진의 등록 버전, OpenAI·Anthropic이면 engine을 싣는다. */
  const engineOp = () => ({ requestId: newRequestId(), credentialVersion: engineVersion,
    ...(engine !== "gemini" && engineModel ? { engine: { provider: engine, modelId: engineModel } } : {}) });
  const say = (code: StyleDnaCode, provider: EngineChoice) => provider === "gemini" ? messages[code] : messages[code].replace("Gemini", engineLabel(provider));
  const stop = () => { active.current?.abort(); active.current = null; setRunning(""); };
  const changed = () => { if (active.current) { stop(); setNotice({ tone: "status", text: "조건이 바뀌어 진행 중이던 요청을 멈췄어요. 설정을 확인하고 다시 실행해 주세요." }); } setConsent(null); };
  const reloadLibrary = () => { setConsent(null); setLibrary({ kind: "loading" }); setAttempt(value => value + 1); };
  const pickEngine = (next: EngineChoice) => { if (next === engine) return; changed(); setEngine(next); };

  async function open(recordId: string, quiet = false) {
    stop(); reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setPending(null); setConsent(null); if (!quiet) setNotice(null);
    const outcome = await readStyleDnaRecord(recordId, controller.signal).catch(() => (controller.signal.aborted ? null : { kind: "error" as const, code: "failed" as const, status: 0 }));
    if (!outcome || controller.signal.aborted || reading.current !== controller) return;
    reading.current = null;
    if (outcome.kind !== "ok") {
      if (outcome.kind === "error" && outcome.code === "not_found") store.set(null);
      setNotice({ tone: "alert", text: outcome.kind === "login" ? "로그인이 끝났어요." : outcome.kind === "error" ? messages[outcome.code] : "기록을 열지 못했어요.", login: outcome.kind === "login" });
      return;
    }
    show(outcome.value);
    if (!quiet) setNotice({ tone: "status", text: `보관한 분석을 열었어요. '${outcome.value.title}'` });
    return true;
  }
  /** 보관함 카드 열기: 원본처럼 그 기록의 분석 화면으로 간다. */
  async function openCard(recordId: string) {
    if (opening || deleting) return;
    setOpening(recordId); setLibraryNote(null);
    const done = await open(recordId).finally(() => setOpening(null));
    if (done) setStep("analyze");
  }
  /** 열린 기록을 닫는다(새 이미지 분석·열린 기록 삭제). */
  function closeRecord() {
    setRecord(undefined); store.set(null); setPicked(false); setShown(null); setTestRevision(null);
    setEditing(false); setCustomPrompt(""); setLoadedFrom(null); pickReference(null);
  }
  /** '새 이미지 분석': 열린 기록을 닫고 빈 분석 폼으로(Master 결정). */
  function fresh() {
    changed();
    closeRecord();
    // 입력한 내용(파일·주소·추가 분석 지침·피드백·피사체)은 비운다. 기록 열기·다시 열기는 폼을 건드리지 않는다(Tester·Design cb6f6b2 관찰).
    setSourceKind("file"); setFile(null); setUrl(""); setGuidance(""); setFeedback(""); setSubject("");
    setNotice(null); setPending(null); setLibraryNote(null);
    setStep("analyze");
  }
  /** 목록을 조용히 다시 읽는다(불러오는 중 표시 없이, 성공할 때만 바꾼다). */
  async function refreshLibrary() {
    const outcome = await readStyleDnaLibrary().catch(() => null);
    if (outcome?.kind === "ok") setLibrary(outcome);
    return outcome?.kind === "ok";
  }
  /** 보관함 삭제(Backend 0727932): 204·404(이미 없음)면 카드·열린 기록·마지막 기록 기억을 지우고 목록을 다시 읽는다. 그 밖의 실패는 목록을 그대로 둔다. */
  async function removeCard(recordId: string) {
    if (deleting) return false;
    const title = library.kind === "ok" ? library.items.find(item => item.id === recordId)?.title ?? "" : "";
    setDeleting(recordId); setLibraryNote(null);
    const outcome = await deleteStyleDna(recordId).catch(() => ({ kind: "lost" as const }));
    setDeleting(null);
    const gone = outcome.kind === "ok" || (outcome.kind === "error" && outcome.code === "not_found");
    if (gone) {
      forget(recordId, outcome.kind === "ok" ? `분석을 삭제했어요. '${title}'` : `이미 삭제된 분석이라 목록에서 뺐어요. '${title}'`);
      return true;
    }
    const keep = " 목록은 그대로예요.";
    setLibraryNote(outcome.kind === "login" ? { tone: "alert", text: "로그인이 끝나 삭제하지 못했어요." + keep, login: loginLink }
      : outcome.kind === "forbidden" ? { tone: "alert", text: "이 계정에는 삭제 권한이 없어요." + keep }
      : outcome.kind === "lost" ? { tone: "alert", text: "연결이 끊겨 삭제됐는지 확인하지 못했어요. 목록을 다시 확인해 주세요.", retry: () => void recheck(recordId, title) }
      : outcome.kind === "error" && outcome.code === "storage_unavailable" ? { tone: "alert", text: "Style DNA 저장소가 준비되지 않아 삭제하지 못했어요." + keep }
      : outcome.kind === "error" && outcome.code === "invalid_input" ? { tone: "alert", text: "기록 번호가 올바르지 않아 삭제하지 못했어요." + keep }
      : { tone: "alert", text: "삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요." + keep });
    return false;
  }
  /** 지워진(204)·이미 없는(404) 기록 정리: 카드 빼기, 같은 ID일 때만 열린 기록 닫기·마지막 기록 기억 지우기, 안내, 목록 다시 읽기. */
  function forget(recordId: string, text: string) {
    setLibrary(current => current.kind === "ok" ? { ...current, items: current.items.filter(item => item.id !== recordId) } : current);
    if (openId.current === recordId) { changed(); closeRecord(); setNotice(null); setPending(null); }
    if (store.get() === recordId) store.set(null);
    setLibraryNote({ tone: "status", text });
    void refreshLibrary();
  }
  /** 삭제 응답이 끊긴 뒤 '다시 확인'(Master msg_4f114fbc7b49): DELETE를 다시 보내지 않고 그 기록 상세를 읽어 판단한다.
   * 404 not_found → 삭제된 것으로 정리, 200 → 삭제되지 않음(그대로), 그 밖(권한·저장소·통신) → 자료 그대로 두고 다시 확인. */
  async function recheck(recordId: string, title: string) {
    if (deleting) return;
    setDeleting(recordId); setLibraryNote(null);
    const outcome = await readStyleDnaRecord(recordId).catch(() => ({ kind: "lost" as const }));
    setDeleting(null);
    if (outcome.kind === "error" && outcome.code === "not_found") { forget(recordId, `분석을 삭제했어요. '${title}'`); return; }
    if (outcome.kind === "ok") { setLibraryNote({ tone: "status", text: `삭제되지 않았어요. '${title}' 기록은 그대로 있어요.` }); void refreshLibrary(); return; }
    setLibraryNote(outcome.kind === "login" ? { tone: "alert", text: "로그인이 끝나 삭제됐는지 확인하지 못했어요. 목록은 그대로예요.", login: loginLink }
      : { tone: "alert", text: "삭제됐는지 아직 확인하지 못했어요. 목록은 그대로예요.", retry: () => void recheck(recordId, title) });
  }
  function show(value: StyleDnaRecord) {
    setRecord(value); store.set(value.id); setPicked(false);
    setTestRevision(value.revisions.at(-1)?.revision ?? 1);
    setShown(value.tests.at(-1)?.id ?? null);
    setEditing(false); setCustomPrompt(""); setLoadedFrom(null); pickReference(null);
  }

  /** 쓰기 한 건을 실행한다. 끊긴 연결은 같은 요청으로만 다시 확인할 수 있게 남긴다. */
  async function execute<T>(label: string, call: (signal: AbortSignal) => Promise<OpOutcome<T>>, done: (value: T) => void, provider: EngineChoice = "gemini") {
    if (active.current) return;
    const run = async (signal: AbortSignal) => {
      const outcome = await call(signal);
      if (signal.aborted) return;
      active.current = null; setRunning("");
      if (outcome.kind === "ok") { setPending(null); setConsent(null); done(outcome.value); return; }
      if (outcome.kind === "lost") {
        setPending({ label, run });
        setNotice({ tone: "alert", retry: true, text: "응답을 받지 못했어요. 이미 저장됐을 수 있어요. '결과 다시 확인'은 같은 요청을 다시 물어봐요(새로 만들지 않아요)." });
        return;
      }
      setPending(outcome.kind === "error" && outcome.code === "in_progress" ? { label, run } : null);
      if (outcome.kind === "login" || outcome.kind === "forbidden") {
        setNotice({ tone: "alert", text: outcome.kind === "login" ? "로그인이 끝났어요." : "이 계정에는 Style DNA 권한이 없어요.", login: outcome.kind === "login" });
        return;
      }
      setConsent(null);
      setNotice({ tone: "alert", text: say(outcome.code, provider), retry: outcome.code === "in_progress" });
      if (outcome.code === "stale_credential" || outcome.code === "not_configured") reloadLibrary();
      if ((outcome.code === "stale_revision" || outcome.code === "not_found") && record) void open(record.id, true);
    };
    const controller = new AbortController();
    active.current = controller;
    setRunning(label); setNotice(null);
    try { await run(controller.signal); } catch { /* 끊긴 요청은 결과를 버린다 */ }
  }
  async function retry() {
    if (!pending || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(pending.label); setNotice(null);
    try { await pending.run(controller.signal); } catch { /* 끊김 */ }
  }

  const source: AnalyzeSource | null = sourceKind === "file" ? (file ? { kind: "file", file } : null)
    : sourceKind === "url" ? (url.trim() ? { kind: "url", url } : null) : record ? { kind: "record", id: record.id } : null;
  const fileProblem = sourceKind === "file" && file ? (!TYPES.includes(file.type) ? "JPG·PNG·WebP 이미지만 분석할 수 있어요." : file.size > UPLOAD_LIMIT ? "이미지가 4MiB를 넘어요." : "") : "";
  const urlProblem = sourceKind === "url" && url.trim() && !/^https:\/\//i.test(url.trim()) ? "주소는 https://로 시작해야 해요." : "";
  const options: StyleDnaOptions = { mode, guidance: guidance.trim(), mutationLevel: mode === "mutate" ? mutationLevel : 30, includeImageTag, targetModel };
  const analyzeReady = !!source && !fileProblem && !urlProblem && [...guidance].length <= LIMITS.guidance;
  function submitAnalyze(event: FormEvent) {
    event.preventDefault();
    if (!analyzeReady || !source || !engineReady) return;
    const request = analyzeRequest(source, options, engineOp());
    void execute("이미지 분석", signal => analyzeStyleDna(request, { signal }), value => {
      // 원본처럼 분석 화면에 결과를 그대로 보여 준다(보정은 아래 추론 막대 또는 2단계).
      show(value); setFeedback("");
      setNotice({ tone: "status", text: `분석을 마치고 보관함에 저장했어요. '${value.title}'` });
      reloadLibrary();
    }, engine);
  }

  const latest = record?.revisions.at(-1);
  const refineReady = !!record && !!latest && !!feedback.trim() && [...feedback].length <= LIMITS.feedback;
  function submitRefine(event: FormEvent) {
    event.preventDefault();
    if (!record || !latest || !refineReady || !agreed("refine")) return;
    const body = refineRequest({ revision: latest.revision, feedback }, engineOp());
    void execute("프롬프트 보정", signal => refineStyleDna(record.id, body, latest.revision + 1, { signal }), value => {
      show(value); setFeedback("");
      setNotice({ tone: "status", text: `새 보정 버전을 저장했어요(버전 ${latest.revision + 1}). 이전 버전도 그대로 남아 있어요.` });
    }, engine);
  }

  const chosen = record?.revisions.find(item => item.revision === testRevision);
  const subjectNeeded = needsSubject(chosen?.prompts.en) || needsSubject(chosen?.prompts.ko);
  const autoRatio = record ? nearestAspectRatio(record.original.width, record.original.height) : null;
  const basePrompt = chosen ? fillSubject(chosen.prompts.en ?? chosen.prompts.ko ?? "", subject) : "";
  const testReady = !!record && !!chosen && (editing
    ? !!customPrompt.trim() && [...customPrompt].length <= styleDnaTestPromptLimit && !needsSubject(customPrompt)
    : (!subjectNeeded || !!subject.trim()) && [...subject].length <= LIMITS.subject);
  /** 바꾼 참조 이미지(미리보기 주소는 바꾸거나 닫을 때 돌려준다). 형식·크기가 맞지 않으면 고르지 않는다. */
  function pickReference(file: File | null | undefined) {
    if (file && !referenceImage.ok(file)) {
      setNotice({ tone: "alert", text: file.size > referenceImage.limit ? "참조 이미지는 4MB까지 쓸 수 있어요." : messages.unsupported_format });
      return;
    }
    setReference(previous => { if (previous) URL.revokeObjectURL(previous.href); return file ? { file, href: URL.createObjectURL(file) } : null; });
  }
  useEffect(() => () => { setReference(previous => { if (previous) URL.revokeObjectURL(previous.href); return null; }); }, []);
  async function submitTest(event: FormEvent) {
    event.preventDefault();
    if (!record || !chosen || !testReady || !agreed("test")) return;
    const input = { revision: chosen.revision, model: testModel, subject, attachImage: attach, ...(ratio && { aspectRatio: ratio }),
      ...(editing && { customPrompt }) };
    const op = { requestId: newRequestId(), credentialVersion: version };
    // 같은 본문으로만 다시 확인하므로(유실·202) 참조 파일의 해시는 보내기 전에 한 번만 잰다.
    const upload = attach && reference ? reference.file : null;
    const sha = upload ? await fileSha256(upload).catch(() => null) : null;
    if (upload && !sha) { setNotice({ tone: "alert", text: messages.invalid_reference }); return; }
    const body = upload && sha ? testUploadRequest(input, op, upload, sha) : testRequest(input, op);
    // 추세에 남길 프롬프트: 편집 칸으로 다시 불러올 수 있는 글(직접 편집이면 편집한 글, 아니면 피사체를 넣은 버전 프롬프트)
    const trendPrompt = editing ? customPrompt.trim() : basePrompt;
    const comparison = record.comparison;
    void execute("시험 이미지 생성", signal => testStyleDna(record.id, body, chosen.revision, { signal }), value => {
      setRecord(previous => previous && previous.id === record.id ? { ...previous, tests: [...previous.tests.filter(item => item.id !== value.id), value] } : previous);
      setShown(value.id);
      setNotice({ tone: "status", text: `버전 ${value.revision} 프롬프트로 시험 이미지를 만들었어요.` });
      // 원본 v1.34(Master 결정): 새 결과(201·이 실행의 유실 복구)에서만, 측정된 저장 지점이 있으면 추세를 한 번 남긴다. 공급자 호출 없음, 실패는 화면을 막지 않는다.
      if (comparison?.spots.some(spot => spot.diff !== null)) void recordTrend(record.id, value, comparison.spotVersion, trendPrompt);
    });
  }
  async function recordTrend(recordId: string, value: StyleDnaTestResult, spotVersion: number, prompt: string) {
    const outcome = await compareStyleDna(recordId, { action: "record-trend", testId: value.id, originalSha256: value.original.sha256,
      resultSha256: value.image.sha256, spotVersion, prompt }).catch(() => null);
    if (outcome?.kind === "ok") setRecord(previous => previous && previous.id === recordId ? { ...previous, comparison: outcome.value } : previous);
  }
  /** 점검 지점을 보관함에 저장(서버가 저장된 원본·결과에서 다시 잰다). 결과 문구를 돌려준다. */
  async function saveSpots(target: StyleDnaTestResult, spots: { x: number; y: number }[], frame: { width: number; height: number }) {
    if (!record) return "저장하지 못했습니다.";
    const recordId = record.id;
    const outcome = await compareStyleDna(recordId, { action: "save-spots", testId: target.id, originalSha256: target.original.sha256,
      resultSha256: target.image.sha256, spotVersion: record.comparison?.spotVersion ?? 0, frame, spots }).catch(() => null);
    if (outcome?.kind === "ok") {
      setRecord(previous => previous && previous.id === recordId ? { ...previous, comparison: outcome.value } : previous);
      return `보관함에 ${spots.length}곳을 저장했습니다. 프롬프트를 고쳐 다시 만들면 같은 자리를 비교해 드립니다.`;
    }
    if (outcome?.kind === "error" && outcome.code === "stale_spot_version") {
      void open(recordId, true);
      return "다른 곳에서 점검 지점이 바뀌었어요. 최신 기록을 다시 불러왔으니 확인한 뒤 다시 저장해 주세요.";
    }
    if (outcome?.kind === "login") return "로그인이 끝났어요. 다시 로그인한 뒤 저장해 주세요.";
    if (outcome?.kind === "forbidden") return "이 계정에는 Style DNA 권한이 없어요.";
    if (outcome?.kind === "error" && outcome.code === "comparison_media_mismatch") return "원본이나 결과 이미지가 기록과 달라 저장하지 못했어요. 기록을 다시 열어 주세요.";
    return outcome?.kind === "lost" ? "응답을 받지 못했어요. 기록을 다시 열어 저장됐는지 확인해 주세요." : "점검 지점을 저장하지 못했습니다.";
  }
  const test = record?.tests.find(item => item.id === shown);
  const proximity = test ? paletteProximity(test.original.palette, test.image.palette) : null;
  // 실제 실행 엔진(기록·리비전의 engine). 첫 리비전은 기록의 engine, 엔진 칸이 없는 이전 기록은 의미 분석 공급자(없으면 Gemini).
  const basisText = (item: { revision: number; engine?: StyleDnaRecord["engine"] }) => {
    if (!record) return "";
    const basis = item.engine ?? (item.revision === 1 ? record.engine : undefined);
    return engineBasisText(basis, item.revision === 1 && record.semantic.status !== "unavailable" ? record.semantic.provider : "gemini");
  };
  const busy = !!running;
  const view = useMemo(() => record ? studioView(record) : undefined, [record]);
  // 파일을 고르면 미리보기 주소를 새로 만들고(이전 것은 해제) 128px로 줄여 색을 미리 잰다. 늦게 끝난 이전 측정은 버린다.
  const pick = (next: File | null | undefined) => {
    if (!next) return;
    changed(); setSourceKind("file"); setFile(next); setPicked(true);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    if (!TYPES.includes(next.type)) { setPreview(null); return; }
    const url = URL.createObjectURL(next);
    previewUrl.current = url;
    setPreview({ url, colors: [] });
    void previewPalette(url).then(colors => setPreview(current => current?.url === url ? { url, colors } : current));
  };
  const showPreview = sourceKind === "file" && picked && !!preview;
  const shownImage = showPreview ? preview.url : record?.original.href ?? null;
  const shownPalette = showPreview ? preview.colors : view?.palette ?? [];
  const paletteNote = showPreview ? "고른 파일에서 브라우저가 직접 잰 색이에요(서버로 보내지 않아요). 분석하면 서버 실측 5색으로 바뀌어요."
    : view ? "서버가 원본 이미지에서 실제로 잰 5색이에요." : "이미지를 고르면 주요 색이 여기에 표시돼요.";
  const analyzing = running === "이미지 분석";
  const libraryState: LibraryState = library.kind === "loading" ? { kind: "loading" } : library.kind === "ok" ? { kind: "ok", items: library.items }
    : { kind: "error", text: { login: "로그인이 끝났어요.", forbidden: "이 계정에는 Style DNA 권한이 없어요.", unavailable: "Style DNA 저장소가 준비되지 않았어요.",
      failed: "보관함을 불러오지 못했습니다." }[library.kind], ...(library.kind === "login" ? { login: loginLink } : { retry: reloadLibrary }) };
  const stage = mutationStage(mutationLevel);
  const libraryFeedback = library.kind === "loading" ? <p className={panel.status} role="status">보관함과 설정을 확인하는 중이에요.</p>
    : library.kind !== "ok" ? <p className={panel.status} role="alert">
      {{ login: "로그인이 끝났어요.", forbidden: "이 계정에는 Style DNA 권한이 없어요.", unavailable: "Style DNA 저장소가 준비되지 않았어요.", failed: "보관함을 읽지 못했어요." }[library.kind]}
      {library.kind === "login" ? <> <a className={panel.link} href={loginLink}>관리자 로그인</a></> : <> <button type="button" className={panel.link} onClick={reloadLibrary}>다시 확인</button></>}
    </p> : null;
  const analyzeHint = step === "analyze" ? engineWarn : null;
  const operationFeedback = <>
    <p id={`${id}-operation-status`} className={panel.status} role={notice?.tone === "alert" ? "alert" : "status"}>
      {running ? `${running} 중이에요.` : notice?.text ?? analyzeHint ?? ""}
      {!running && notice?.login && <> <a className={panel.link} href={loginLink}>관리자 로그인</a></>}
      {!running && pending && <> <button type="button" className={panel.link} onClick={() => void retry()}>결과 다시 확인</button></>}
    </p>
    {running && <div className={panel.actions}><Button type="button" variant="secondary" onClick={() => { stop(); setPending(null); setNotice({ tone: "status", text: "요청을 멈췄어요. 이미 저장됐는지는 보관함에서 확인할 수 있어요." }); }}>멈추기</Button></div>}
  </>;

  const body = <section className={`${panel.panel} ${styles.workflow}`} data-layout={layout} aria-labelledby={`${id}-title`}>
    {original ? <h1 id={`${id}-title`} className={styles.srOnly}>{{ library: "보관함", analyze: "1단계 이미지 분석", refine: "2단계 프롬프트 보정", test: "3단계 결과 테스트" }[step]}</h1>
      : <div className={panel.head}><h3 id={`${id}-title`}>Style DNA 작업실 · 분석 → 보정 → 결과 테스트</h3></div>}
    {!original && <p className={panel.note}>원본 Style DNA v1.39의 세 단계를 이어서 써요. 분석·보정·시험 결과는 내 보관함에 저장되고 다시 열 수 있어요. 각 실행은 따로 동의해야 Gemini를 불러요.</p>}
    {step !== "library" && step !== "analyze" && libraryFeedback}
    {/* 원본 전체 화면에는 이 설정 줄이 없다(엔진·모델은 분석 화면에서 고른다). 미등록일 때만 안내로 남긴다. */}
    {settings && (!original || !ready) && <p className={panel.note} aria-label="Style DNA 설정">{ready ? `분석 모델 ${settings.analysisModel} · Gemini 등록 버전 ${version}` : "이미지 분석 모델이 등록되지 않아 실행할 수 없어요. API키등록·플랫폼연동에서 등록해 주세요."}
      {` · 시험 생성 모델 ${settings.testModels.map(model => model.label).join(", ")}`}</p>}


    {!original && <div className={styles.nav}>
      <button type="button" className={styles.libraryTab} aria-pressed={step === "library"} onClick={() => { if (step !== "library") { changed(); setStep("library"); } }}>
        보관함{library.kind === "ok" && ` ${library.items.length}`}</button>
    <div className={styles.steps} role="group" aria-label="Style DNA 단계">
      {(["analyze", "refine", "test"] as const).map((value, index) => <button key={value} type="button" aria-pressed={step === value}
        disabled={value !== "analyze" && !record} onClick={() => { if (step !== value) { changed(); setStep(value); } }}>
        {index + 1}. {{ analyze: "이미지 분석", refine: "프롬프트 보정", test: "결과 테스트" }[value]}</button>)}
    </div>
    </div>}

    {original && (step === "refine" || step === "test") && !record && <div className={styles.need}>
      <p>먼저 1단계에서 이미지를 분석하거나 보관함에서 분석을 불러와주세요.</p>
      <div>
        <button type="button" className={styles.needPrimary} onClick={() => setStep("analyze")}>1단계 이미지 분석으로 이동</button>
        <button type="button" className={styles.needGhost} onClick={() => setStep("library")}>보관함에서 불러오기</button>
      </div>
    </div>}

    {step === "library" && <StudioLibrary state={libraryState} limit={LIBRARY_LIMIT} current={record?.id} opening={opening} when={day}
      onOpen={recordId => void openCard(recordId)} onNew={fresh} settingsHref={settingsLink}
      deleting={deleting} onDelete={removeCard} note={libraryNote} />}

    {step === "analyze" && <div className={studio.studio} data-theme={dark ? "dark" : "light"} role="region" aria-label="이미지 스타일 분석기">
      <StudioHelp open={help} onClose={() => setHelp(false)} />
      <header className={studio.header}>
        <div className={studio.brand}>
          <span className={studio.brandIcon}><Microscope size={20} /></span>
          <div><h4 className={studio.brandTitle}>이미지 스타일 분석기</h4><p>이미지 한 장으로 카메라·조명·팔레트·스타일을 정밀 분석하여 마스터 프롬프트를 추출합니다</p></div>
        </div>
        <div className={studio.quick}>
          {record && <button type="button" className={`${studio.pill} ${studio.pillAccent}`} disabled={busy} onClick={() => { changed(); setStep("test"); }}>
            <FlaskConical size={14} />3단계 결과 테스트</button>}
          <button type="button" className={studio.pill} aria-label="도움말" onClick={() => setHelp(true)}><HelpCircle size={14} /><span className={studio.pillText}>도움말</span></button>
          <button type="button" className={studio.pill} title="스튜디오 테마 전환" aria-label={dark ? "화이트 모드" : "다크 스튜디오"} aria-pressed={dark} onClick={() => setDark(value => !value)}>
            {dark ? <Sun size={14} className={studio.sun} /> : <Moon size={14} />}<span className={studio.pillText}>{dark ? "화이트 모드" : "다크 스튜디오"}</span></button>
        </div>
      </header>

      <div className={studio.grid}>
        <form className={studio.column} onSubmit={submitAnalyze} aria-busy={busy || undefined} aria-label="분석 설정">
          <section className={studio.card} aria-label="이미지 소스 선택">
            <div className={`${studio.cardHead} ${studio.headPlain}`}><h4><span className={studio.emoji} aria-hidden>📤</span>이미지 소스 선택</h4></div>
            {sourceKind === "file" && <button type="button" className={studio.drop} data-drag={drag || undefined} aria-label="분석할 이미지 고르기(클릭 또는 파일 끌어다 놓기)"
              onClick={() => fileInput.current?.click()} onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={event => { event.preventDefault(); setDrag(false); pick(event.dataTransfer.files?.[0]); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {shownImage ? <img src={shownImage} alt="업로드된 이미지 미리보기" />
                : <><Upload size={28} /><span className={studio.dropTitle}>클릭 또는 파일 끌어다 놓기</span><span className={studio.dropHint}>JPG · PNG · WebP (최대 4MB)</span></>}
              {picked && file && <span className={studio.fileName}>{file.name}</span>}
            </button>}
            <input ref={fileInput} className={studio.hiddenInput} type="file" accept={TYPES.join(",")} tabIndex={-1} aria-hidden aria-invalid={!!fileProblem || undefined}
              onChange={event => { pick(event.target.files?.[0]); event.target.value = ""; }} />
            <div className={studio.sourceAlt} role="radiogroup" aria-label="분석 대상">
              {(["file", "url", "record"] as const).map(kind => <label key={kind} className={studio.imageTag}>
                <input type="radio" name={`${id}-source`} checked={sourceKind === kind} disabled={kind === "record" && !record}
                  onChange={() => { changed(); setSourceKind(kind); }} />{{ file: "파일", url: "HTTPS 주소", record: "열린 기록 원본 다시 분석" }[kind]}</label>)}
            </div>
            {sourceKind === "url" && <label className={studio.urlField}>이미지 주소
              <input type="url" inputMode="url" maxLength={LIMITS.url} value={url} aria-invalid={!!urlProblem || undefined} placeholder="https://"
                onChange={event => { changed(); setUrl(event.target.value); }} /></label>}
            {sourceKind === "record" && record && <p className={studio.cardNote}>&apos;{record.title}&apos;의 저장된 원본({record.original.width}×{record.original.height})을 새 기록으로 다시 분석해요.</p>}
            <p className={studio.cardNote} id={`${id}-analyze-info`}>시작하면 이미지 사본과 분석 설정을 {engineShort}에 보내고 결과를 보관함에 저장해요.</p>
            <button type="submit" className={studio.primary} aria-describedby={`${id}-analyze-info ${id}-operation-status`} disabled={!analyzeReady || !engineReady || busy}>
              {analyzing ? <Loader2 size={16} className={studio.spin} /> : <Sparkles size={16} />}{analyzing ? "이미지 시퀀싱 중..." : "이미지 시퀀싱 시작"}</button>
            {libraryFeedback}
            {operationFeedback}
            {(fileProblem || urlProblem) && <p className={studio.error} role="alert">{fileProblem || urlProblem}</p>}
          </section>

          <StudioCameraLighting view={view} analyzing={analyzing} />

          <section className={studio.card} aria-label="시스템 가이던스">
            <div className={studio.cardHead}><h4><span className={studio.emoji} aria-hidden>⚙️</span>시스템 가이던스</h4>
              <span className={studio.tip}>
                <label className={studio.imageTag}><input type="checkbox" checked={includeImageTag} onChange={event => { changed(); setIncludeImageTag(event.target.checked); }} />첨부 이미지 제공</label>
                <details className={studio.tipWrap}><summary className={studio.tipMark} aria-label="첨부 이미지 제공 기능 안내">?</summary>
                  <div className={studio.tipCard} role="note"><p className={studio.tipTitle}>🖼️ [첨부 이미지] 제공 기능이란?</p>
                    체크 시 프롬프트에 <strong>&apos;[첨부 이미지]&apos;</strong> 태그가 자동 삽입됩니다. Midjourney, Gemini, ChatGPT 등 이미지 생성 AI에 프롬프트를 입력할 때 <strong>원본 사진을 파일로 함께 첨부</strong>하면,
                    AI가 원본의 구도·조명·화풍을 100% 스타일 앵커로 직접 참조하여 완벽한 스타일 전이(Style Transfer)를 수행합니다.</div></details>
              </span>
            </div>
            <div className={studio.segment} role="group" aria-label="분석 방식">
              {([["replicate", "스타일 복제"], ["mutate", "스타일 변형"]] as const).map(([value, label]) =>
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => { if (mode !== value) { changed(); setMode(value); } }}>{label}</button>)}
            </div>
            {mode === "mutate" && <div className={studio.mutation}>
              <label className={studio.mutationHead} htmlFor={`${id}-mutation`}><span><Sliders size={14} />변형 강도</span><strong>{mutationLevel}%</strong></label>
              <input id={`${id}-mutation`} type="range" min={0} max={100} value={mutationLevel} aria-valuetext={`${mutationLevel}% · ${stage.label}`}
                onChange={event => { changed(); setMutationLevel(Number(event.target.value)); }} />
              <span className={studio.stage} data-stage={stage.label} title={stage.desc}>{stage.full}</span>
            </div>}
            <label className={studio.field}>타겟 이미지 모델
              <select value={targetModel} onChange={event => { changed(); setTargetModel(event.target.value as Model); }}>
                {modelIds.map(model => <option key={model} value={model}>{styleDnaImageModels[model].label}</option>)}</select></label>
            <label className={studio.field}>추가 분석 지침 (선택)
              <textarea maxLength={LIMITS.guidance} value={guidance} placeholder=">> 예: '조명과 표면 질감을 집중 분석', '따뜻한 감성 톤으로 추출' 등 자유 입력"
                onChange={event => { changed(); setGuidance(event.target.value); }} />
              <span className={studio.count}>{[...guidance].length} / {LIMITS.guidance}</span></label>
            <div className={studio.engine}>
              {/* 주인님 지시(CMD-043): 분석 AI·모델 고르는 칸 대신 플랫폼 단추만 둔다. 모델과 등록 버전은 API키등록·플랫폼연동에 등록한 값을 그대로 쓴다. */}
              <p className={studio.engineHead} id={`${id}-engine-head`}>분석 AI</p>
              <div className={`${studio.segment} ${studio.segmentThree}`} role="group" aria-labelledby={`${id}-engine-head`} aria-describedby={`${id}-engine`}>
                {engineChoices.map(choice => <button key={choice.value} type="button" aria-pressed={engine === choice.value} disabled={busy || choice.disabled}
                  value={choice.value} title={choice.label} onClick={event => pickEngine(event.currentTarget.value as EngineChoice)}>{choice.short}{choice.disabled && <small> 키 미등록</small>}</button>)}
              </div>
              <p className={studio.engineNote} id={`${id}-engine`}>API키등록·플랫폼연동에 등록한 {engineShort} 키{engineModel ? `(${engineModel})` : ""}로 호출되며 요금은 그 계정에 청구돼요. 시험 이미지 생성은 언제나 Gemini로 해요.</p>
            </div>
          </section>
        </form>

        <div className={studio.column}>
          <div className={studio.viewer} role="img" aria-label={shownImage ? "스캔 뷰어" : "스캔 뷰어(이미지 없음)"}>
            {shownImage ? <div className={studio.viewerFrame}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={studio.viewerImage} data-scanning={analyzing || undefined} src={shownImage} alt="" />
              <StudioScanOverlay scanning={analyzing} ratio={!showPreview && record ? nearestAspectRatio(record.original.width, record.original.height) : null} />
            </div> : <div className={studio.waiting}>
              <span className={studio.waitingIcon}><Microscope size={32} /><span className={studio.ping} aria-hidden /></span>
              <div><strong>{analyzing ? "AI가 이미지의 시각적 유전자를 정밀 스캔하고 있습니다…" : "이미지를 업로드하면 DNA 스캔이 시작됩니다"}</strong>
                <p>좌측에서 이미지를 선택하고 [이미지 시퀀싱 시작]을 눌러주세요.</p></div>
            </div>}
          </div>
          {view && record ? <StudioReport view={view} onCopied={setCopied}
            engine={basisText(record.revisions.find(item => item.revision === view.revision) ?? { revision: view.revision })} /> : <StudioReportWaiting />}
        </div>

        <div className={studio.column}>
          <StudioPalette palette={shownPalette} note={paletteNote} />
          <StudioDnaBars view={view} analyzed={!!view} />
        </div>
      </div>

      <form className={studio.footer} onSubmit={submitRefine} aria-label="추론 인터페이스" aria-busy={busy || undefined}>
        <div className={studio.engineBrand}><span className={studio.ai} aria-hidden>AI</span><div><p>PROMPT ENGINE / STUDIO</p><strong>이미지 스타일 분석기</strong></div></div>
        <div className={studio.inference}>
          <label className={studio.live} htmlFor={`${id}-refine`}>◎ 추론 인터페이스 (실시간 미세 보정)</label>
          <div className={studio.inferRow}>
            <input id={`${id}-refine`} className={studio.refineInput} type="text" maxLength={LIMITS.feedback} disabled={!record || busy} value={feedback}
              placeholder={record ? "스타일 보정을 위한 피드백 입력 (예: '조명을 더 따뜻하게', '배경을 단순하게')..." : "분석 완료 후 보정 피드백을 입력할 수 있습니다..."}
              onChange={event => { changed(); setFeedback(event.target.value); }} />
            <button type="submit" className={studio.refineButton} disabled={!refineReady || !agreed("refine") || busy}>
              {running === "프롬프트 보정" ? <Loader2 size={14} className={studio.spin} /> : <Wand2 size={14} />}미세 보정 요청</button>
          </div>
          {record && latest && <label className={studio.consent}><input type="checkbox" checked={agreed("refine")} disabled={!engineReady || busy}
            onChange={event => agree("refine", event.target.checked)} />
            현재 버전 {latest.revision}의 프롬프트와 피드백을 {engineShort}({engineModel ?? "모델 미등록"})에 보내 새 보정 버전을 만드는 데 동의해요(호출 1건).</label>}
        </div>
        <button type="button" className={studio.testLink} disabled={!record || busy} onClick={() => { changed(); setStep("test"); }}>
          <FlaskConical size={16} />3단계 결과 테스트</button>
      </form>

      {record && <details className={studio.measure}><summary>픽셀 측정 상세(서버 측정 보고서)</summary>
        <StyleDnaReport semantic={record.semantic} result={record.result.status === "ready" ? record.result as ReadyResult : undefined}
          size={{ width: record.original.width, height: record.original.height }} settingsHref={null} />
      </details>}
    </div>}

    {step === "refine" && record && latest && view && <StudioRefine id={id} image={record.original.href} view={view}
      revisions={record.revisions.map(item => ({ ...item, engineText: basisText(item) }))}
      feedback={feedback} limit={LIMITS.feedback} quick={REFINE_QUICK} busy={busy} running={running === "프롬프트 보정"} ready={engineReady} agreed={agreed("refine")}
      engine={{ value: engine, short: engineShort, model: engineModel, choices: engineChoices, warn: engineWarn, onChange: pickEngine }}
      when={when} onCopied={setCopied} onSubmit={submitRefine}
      onFeedback={value => { changed(); setFeedback(value); }}
      onQuick={text => { changed(); setFeedback(value => value.trim() ? `${value.trim()}, ${text}` : text); }}
      onClear={() => { changed(); setFeedback(""); }}
      onConsent={checked => agree("refine", checked)}
      onTest={revision => { changed(); setTestRevision(revision); setStep("test"); }} />}

    {step === "test" && record && <StudioTest id={id} original={record.original} aspect={autoRatio ?? null}
      revisions={record.revisions} revision={testRevision} onRevision={revision => { changed(); setTestRevision(revision); }}
      editing={editing} onEditing={next => { changed(); if (next) setCustomPrompt(basePrompt); else setLoadedFrom(null); setEditing(next); }}
      subject={subject} subjectLimit={LIMITS.subject} subjectNeeded={subjectNeeded} onSubject={value => { changed(); setSubject(value); }}
      prompt={customPrompt} promptLimit={styleDnaTestPromptLimit} onPrompt={value => { changed(); setCustomPrompt(value); }}
      promptNotice={loadedFrom && <LoadedNotice round={loadedFrom.round} onClose={() => setLoadedFrom(null)}
        onUndo={() => { changed(); setCustomPrompt(loadedFrom.prevPrompt); setEditing(loadedFrom.prevEditing); setLoadedFrom(null); }} />}
      attach={attach} onAttach={value => { changed(); setAttach(value); }}
      reference={reference && { href: reference.href, name: reference.file.name }} referenceAccept={referenceImage.accept}
      onReference={file => { changed(); pickReference(file); }} onReferenceClear={() => { changed(); pickReference(null); }}
      models={settings?.testModels ?? modelIds.map(model => ({ id: model, ...styleDnaImageModels[model] }))} model={testModel}
      onModel={value => { changed(); setTestModel(value as Model); }} ratio={ratio} ratios={styleDnaRatio.options} onRatio={value => { changed(); setRatio(value); }}
      ready={ready} agreed={agreed("test")} onConsent={checked => agree("test", checked)}
      consent={`버전 ${chosen?.revision ?? "-"}의 ${editing ? "직접 편집한 프롬프트" : "프롬프트"}${attach ? reference ? "와 고른 참조 이미지" : "와 원본 이미지" : ""}를 Gemini 이미지 모델에 보내 시험 이미지 1장을 만들고 보관하는 데 동의해요.`}
      busy={busy} running={running === "시험 이미지 생성"} canRun={testReady} onSubmit={event => void submitTest(event)} missing={!!settings && !ready}
      tests={record.tests} shown={shown} onShow={setShown} modelLabel={model => styleDnaImageModels[model as Model]?.label ?? model}
      proximity={proximity} when={when}
      compare={test && <StudioCompare before={test.original.href} after={test.image.href} label={`원본과 시험 결과 비교(버전 ${test.revision})`} maxHeight={640}
        comparison={record.comparison} when={when} onSaveSpots={(spots, frame) => saveSpots(test, spots, frame)}
        onLoadPrompt={(prompt, round) => {
          // 원본 v1.35: 좋았던 회차의 프롬프트로 돌아가기 — 직접 편집 모드로 바꾸고 단계 맨 위로(불러오기 전 상태는 되돌리기용으로 보관)
          changed();
          setLoadedFrom(previous => previous ? { ...previous, round } : { round, prevPrompt: customPrompt, prevEditing: editing });
          setCustomPrompt(prompt); setEditing(true);
          document.querySelector('[aria-label="결과 테스트"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
        }} />} />}

    {step !== "analyze" && operationFeedback}
    <p className={panel.status} role="status">{copied}</p>
  </section>;
  if (!original) return body;
  // 원본 사이드바: 단계를 바꾸면 진행 중 요청·동의를 푼다(기존 단계 단추와 같은 동작).
  return <StudioShell embedded={embedded} step={step} account={account} guideHref={embedded ? "#admin-manual" : "/admin#admin-manual"} settingsHref={settingsLink}
    onStep={next => { if (next !== step) { changed(); setStep(next); } }}>{body}</StudioShell>;
}
