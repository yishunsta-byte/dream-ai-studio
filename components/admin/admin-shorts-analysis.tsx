"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import {
  SHORTS_ANALYSIS_URI, shortsAnalysisAvailabilitySchema, shortsAnalysisResultSchema, youtubeVideoId, type ShortsAnalysisResult,
} from "@/lib/reference-analysis/shorts-analysis-contract";
import styles from "./admin-reference-analysis.module.css";

const errors: Record<string, string> = {
  invalid_input: "공개 YouTube 쇼츠 또는 시청 주소를 확인해 주세요.",
  not_configured: "쇼츠 분석 모델이 연결되면 이 기능을 사용할 수 있어요.",
  provider_error: "Gemini가 영상을 분석하지 못했어요. 공개 영상인지 확인해 주세요.",
  invalid_response: "분석 결과 형식이 올바르지 않아요. 잠시 후 다시 시도해 주세요.",
  timed_out: "영상 응답이 지연됐어요. 잠시 후 다시 시도해 주세요.",
};

type Availability = { kind: "checking" } | { kind: "configured" } | { kind: "not_configured" }
  | { kind: "failed"; message: string };

export function AdminShortsAnalysis({ onSourceChange, appearance }: { onSourceChange?: (url: string) => void; appearance?: "premiere" } = {}) {
  const id = useId();
  const retryStatusId = `${id}-retry-status`;
  const urlField = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<ShortsAnalysisResult>();
  const [availability, setAvailability] = useState<Availability>({ kind: "checking" });
  const [statusAttempt, setStatusAttempt] = useState(0);
  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    async function checkAvailability(): Promise<Availability> {
      try {
        const response = await fetch(SHORTS_ANALYSIS_URI, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        if (response.status === 401 || response.status === 403) {
          return { kind: "failed", message: "관리자 로그인과 권한을 확인해 주세요." };
        }
        if (response.ok) {
          const status = shortsAnalysisAvailabilitySchema.safeParse(await response.json());
          if (status.success) return { kind: status.data.semantic.shorts };
        }
      } catch {
        // The status may be checked again without resending the analysis.
      }
      return { kind: "failed", message: "쇼츠 모델 설정을 확인하지 못했어요." };
    }
    void checkAvailability().then(status => {
      if (controller.signal.aborted) return;
      if (status.kind === "configured" && document.activeElement?.id === retryStatusId) {
        urlField.current?.focus({ preventScroll: true });
      }
      setAvailability(status);
    });
    return () => controller.abort();
  }, [retryStatusId, statusAttempt]);

  function reset() {
    active.current?.abort();
    active.current = null;
    setRunning(false);
    setNotice("");
    setResult(undefined);
  }

  async function analyze() {
    if (availability.kind !== "configured" || !consent || active.current) return;
    if (!youtubeVideoId(url.trim())) {
      setNotice(errors.invalid_input);
      urlField.current?.focus();
      return;
    }
    setNotice("");
    setResult(undefined);
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    try {
      const response = await fetch(SHORTS_ANALYSIS_URI, {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), authorized: true }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        setNotice("관리자 로그인과 권한을 확인해 주세요.");
        return;
      }
      const body: { error?: unknown; result?: unknown } = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (body.error === "not_configured") {
          setAvailability({ kind: "not_configured" });
          setConsent(false);
          return;
        }
        setNotice(typeof body.error === "string" && Object.hasOwn(errors, body.error)
          ? errors[body.error]
          : "현재 쇼츠 분석에 연결할 수 없어요.");
        return;
      }
      const parsed = shortsAnalysisResultSchema.safeParse(body.result);
      if (parsed.success) {
        setResult(parsed.data);
        setNotice("쇼츠 분석을 완료했어요.");
      } else setNotice(errors.invalid_response);
    } catch {
      if (!controller.signal.aborted) setNotice("현재 쇼츠 분석에 연결할 수 없어요.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }

  const findings = result?.findings;
  return <section className={styles.panel} data-appearance={appearance} aria-labelledby={`${id}-title`}>
    <div className={styles.surface}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); void analyze(); }}>
        <h3 id={`${id}-title`}>YouTube 쇼츠 분석</h3>
        {availability.kind !== "configured" && <div className={styles.promptEditor}>
          <p className={styles.status} role="status">
            {availability.kind === "checking" ? "쇼츠 모델 설정을 확인하는 중이에요."
              : availability.kind === "not_configured" ? errors.not_configured : availability.message}
          </p>
          {(availability.kind !== "checking" || statusAttempt > 0) && <div className={styles.actions}>
            <a className={styles.link} href="#admin-api-integrations">API연동 보기</a>
            <Button id={retryStatusId} type="button" variant="secondary" aria-disabled={availability.kind === "checking"}
              onClick={() => {
                if (availability.kind === "checking") return;
                setAvailability({ kind: "checking" });
                setStatusAttempt(attempt => attempt + 1);
              }}>설정 다시 확인</Button>
          </div>}
        </div>}
        <label className={styles.field} htmlFor={`${id}-url`}>
          공개 YouTube 영상 주소
          <input ref={urlField} id={`${id}-url`} inputMode="url" autoComplete="off" spellCheck={false}
            maxLength={2048} value={url} aria-describedby={`${id}-help`}
            onChange={event => { reset(); setUrl(event.target.value); setConsent(false); onSourceChange?.(event.target.value); }} />
        </label>
        <p className={styles.note} id={`${id}-help`}>공개 쇼츠 주소나 YouTube 시청 주소를 입력하세요.</p>
        <div className={styles.options}>
          <label><input type="checkbox" checked={consent} disabled={availability.kind !== "configured"}
            onChange={event => { reset(); setConsent(event.target.checked); }} />
            분석 권리를 확인했고 영상 주소를 Gemini에 보내는 데 동의해요.
          </label>
        </div>
        <div className={styles.actions}>
          <Button className={styles.run} type="submit" loading={running} loadingLabel="쇼츠 분석 중"
            disabled={availability.kind !== "configured" || !consent || !url.trim()}>쇼츠 분석</Button>
          {running && <Button type="button" variant="secondary" onClick={reset}>취소</Button>}
        </div>
        <p className={styles.status} role="status">{running ? "공개 영상 분석 중" : notice}</p>
      </form>
      {findings && <div className={styles.inference}>
        <h4>Gemini 영상 분석 제안</h4>
        <p className={styles.note}>모델이 영상에서 찾은 내용이에요. 공개하기 전에 원본과 대조하세요.</p>
        <p>{findings.summary}</p>
        <p><strong>첫 장면</strong> {findings.hook ?? "미확인"}</p>
        <p><strong>화면 구성</strong> {findings.composition ?? "미확인"}</p>
        <p><strong>소리</strong> {findings.sound ?? "미확인"}</p>
        {findings.segments.length > 0 && <ol className={styles.observations} aria-label="시간대별 근거">
          {findings.segments.map((segment, index) => <li key={`${segment.timestamp}-${index}`}>
            <span className={styles.measureRange}>{segment.timestamp}</span>
            <p>{segment.evidence}</p>
          </li>)}
        </ol>}
        {findings.draftPrompt && <><h5>새 영상 연출 초안</h5><p>{findings.draftPrompt}</p></>}
      </div>}
    </div>
  </section>;
}
