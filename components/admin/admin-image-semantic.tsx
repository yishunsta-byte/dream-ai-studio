import type { ImageSemanticCategory, ImageSemanticResult } from "@/lib/reference-analysis/image-semantic-result";
import styles from "./admin-reference-analysis.module.css";

const labels: Record<ImageSemanticCategory, string> = {
  people: "인물",
  objects: "사물",
  actions: "행동",
  context: "맥락",
  composition: "구도",
  lighting: "조명",
};

const notes: Record<Extract<ImageSemanticResult, { status: "unavailable" }>["reason"], string> = {
  not_configured: "Gemini 설정이 필요해요. API연동 메뉴에서 상태를 확인하세요.",
  image_preparation_failed: "모델에 보낼 이미지를 준비하지 못했어요.",
  provider_error: "Gemini가 요청을 처리하지 못했어요. 잠시 뒤 다시 실행해 주세요.",
  invalid_response: "Gemini에서 사용할 수 있는 분석 결과를 받지 못했어요.",
  timed_out: "Gemini 분석 시간이 초과됐어요. 잠시 뒤 다시 실행해 주세요.",
};

export function ImageSemanticReport({ semantic }: { semantic: ImageSemanticResult }) {
  if (semantic.status === "unavailable") return <div className={styles.promptEditor}>
    <p className={styles.error}>이미지 의미 분석을 완료하지 못했어요.</p>
    <p className={styles.note}>{notes[semantic.reason]}</p>
    {semantic.reason === "not_configured" && <a className={styles.link} href="#admin-api-integrations">API연동 보기</a>}
  </div>;

  return <div className={styles.promptEditor}>
    {semantic.status === "partial" && <p className={styles.note}>일부 항목만 분석했어요.</p>}
    <ul className={styles.observations} aria-label="이미지 의미와 스타일">
      {semantic.findings.map(finding => <li key={finding.category}>
        <strong>{labels[finding.category]} · {finding.certainty === "estimated" ? "추정" : "미확인"}</strong>
        {finding.certainty === "estimated" && <div className={styles.measureValue}>
          <p className={styles.plain}>{finding.description}</p>
          <p className={styles.note}>시각 단서 · {finding.basis}</p>
        </div>}
      </li>)}
    </ul>
    <h4>Style DNA 이미지 생성 프롬프트</h4>
    <label className={styles.field}>한국어
      {semantic.prompts.ko ? <textarea rows={4} readOnly value={semantic.prompts.ko} /> : <span className={styles.note}>제안 없음</span>}
    </label>
    <label className={styles.field}>영어
      {semantic.prompts.en ? <textarea rows={4} readOnly lang="en" value={semantic.prompts.en} /> : <span className={styles.note}>제안 없음</span>}
    </label>
  </div>;
}
