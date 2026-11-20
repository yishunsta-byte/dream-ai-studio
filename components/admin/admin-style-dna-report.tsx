"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { ImageSemanticCategory, ImageSemanticResult } from "@/lib/reference-analysis/image-semantic-result";
import type { ReadyResult } from "./admin-reference-analysis-model";
import { ImageSemanticReport } from "./admin-image-semantic";
import styles from "./admin-style-dna-report.module.css";

// Style DNA Analyzer v1.01 결과 화면(StudioReportView·StudioPalette·StudioCameraLighting)의 순서를
// 지금 서버가 주는 값만으로 옮긴다: 비율·팔레트(픽셀 측정) → 관찰 카드(Gemini 추정·근거) → 한·영 마스터 프롬프트.
// 키트의 카메라 세부 칸·DNA 점수·제목·팁처럼 서버가 주지 않는 값은 만들어 보여 주지 않는다.

// 키트 lib/dna/types.ts의 지원 비율과 같은 목록·같은 계산(로그 비 차이가 가장 작은 비율).
const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:4", "4:5", "16:10", "10:16"] as const;
export function nearestAspectRatio(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return undefined;
  const target = width / height;
  let best: string = ASPECT_RATIOS[0];
  let bestDiff = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [w, h] = ratio.split(":").map(Number);
    const diff = Math.abs(Math.log(target / (w / h)));
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best;
}

type ImageObservation = Extract<ReadyResult["proposals"][number]["observations"][number], { measure: "region_color_luminance" }>;
// 서버 픽셀 측정 중 이미지 전체 영역 값. 없으면(측정 실패·다른 매체) undefined.
export function wholeImageMeasure(result?: ReadyResult): ImageObservation | undefined {
  for (const proposal of result?.proposals ?? []) {
    if (proposal.media !== "image") continue;
    for (const observation of proposal.observations) {
      if (observation.measure !== "region_color_luminance") continue;
      const { x, y, width, height } = observation.location;
      if (x === 0 && y === 0 && width === 1 && height === 1) return observation;
    }
  }
  return undefined;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const luminanceLabels = ["어두운 영역", "중간보다 어두운 영역", "중간보다 밝은 영역", "밝은 영역"] as const;
// 키트 리포트처럼 구조·조명을 먼저, 나머지 관찰은 그 뒤에.
const cardOrder: { category: ImageSemanticCategory; title: string }[] = [
  { category: "composition", title: "구조적 청사진 · 구도" },
  { category: "lighting", title: "조명" },
  { category: "people", title: "인물" },
  { category: "objects", title: "사물" },
  { category: "actions", title: "행동" },
  { category: "context", title: "맥락" },
];

function PromptCard({ language, original }: { language: "en" | "ko"; original?: string }) {
  const id = useId();
  const [draft, setDraft] = useState(original ?? "");
  const [status, setStatus] = useState("");
  const title = language === "en" ? "마스터 프롬프트 (EN)" : "마스터 프롬프트 (KO)";
  if (!original) return <section className={styles.prompt} aria-label={title}>
    <h5>{title}</h5>
    <p className={styles.note}>Gemini가 이 언어의 프롬프트를 제안하지 않았어요.</p>
  </section>;
  const edited = draft !== original;
  async function copy() {
    try { await navigator.clipboard.writeText(draft); setStatus(`${title}를 복사했어요.`); }
    catch {
      (document.getElementById(`${id}-text`) as HTMLTextAreaElement | null)?.select();
      setStatus("복사하지 못했어요. 선택된 글을 직접 복사해 주세요.");
    }
  }
  return <section className={styles.prompt} aria-labelledby={`${id}-title`}>
    <div className={styles.promptHead}>
      <h5 id={`${id}-title`}>{title}</h5>
      <div className={styles.promptActions}>
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>복사</Button>
        {edited && <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(original); setStatus("제안된 프롬프트로 되돌렸어요."); }}>원래대로</Button>}
      </div>
    </div>
    <label className={styles.srOnly} htmlFor={`${id}-text`}>{title} 내용</label>
    <textarea id={`${id}-text`} rows={5} lang={language} value={draft} aria-describedby={`${id}-hint`}
      onChange={event => { setDraft(event.target.value); setStatus(""); }} />
    <p id={`${id}-hint`} className={styles.note}>{edited ? "고친 내용은 이 화면에서만 써요. 공개 준비에는 Gemini 제안 원문이 들어가요." : "고쳐서 복사할 수 있어요."}</p>
    <p role="status" className={styles.note}>{status}</p>
  </section>;
}

export function StyleDnaReport({ semantic, result, size }: {
  semantic?: ImageSemanticResult; result?: ReadyResult; size?: { width: number; height: number };
}) {
  const measure = wholeImageMeasure(result);
  const ratio = size && nearestAspectRatio(size.width, size.height);
  return <div className={styles.report}>
    {(measure || ratio) && <section className={styles.measured} aria-label="픽셀 측정">
      <h5>미학적 팔레트 <span className={styles.tag}>픽셀 측정</span></h5>
      {ratio && size && <p className={styles.ratio}>원본 비율 <strong>{ratio}</strong> <span className={styles.note}>({size.width}×{size.height}px, 브라우저 측정)</span></p>}
      {measure && <>
        <ul className={styles.palette} aria-label="대표 색상">
          {measure.palette.map(color => <li key={color.bucket}>
            <span className={styles.swatch} style={{ background: color.bucket }} aria-hidden="true" />
            <code>{color.bucket.toUpperCase()}</code>
            <span>{percent(color.visibleShare)}</span>
          </li>)}
        </ul>
        <div className={styles.bars} role="img" aria-label={`밝기 분포: ${measure.luminanceShares.map((share, index) => `${luminanceLabels[index]} ${percent(share)}`).join(", ")}`}>
          {measure.luminanceShares.map((share, index) => <span key={index} data-band={index} style={{ flexGrow: Math.max(share, 0.001) }} />)}
        </div>
        <p className={styles.note}>밝기 분포 · {measure.luminanceShares.map((share, index) => `${luminanceLabels[index]} ${percent(share)}`).join(" · ")}</p>
        <p className={styles.note}>대표 색은 이미지 픽셀을 64색으로 묶어 잰 값이에요(최대 3색).</p>
      </>}
    </section>}
    {semantic?.status === "unavailable" ? <ImageSemanticReport semantic={semantic} /> : semantic && <>
      {semantic.status === "partial" && <p className={styles.note}>일부 항목만 분석했어요.</p>}
      <ul className={styles.cards} aria-label="이미지 의미와 스타일">
        {cardOrder.map(({ category, title }) => {
          const finding = semantic.findings.find(item => item.category === category);
          if (!finding) return null;
          return <li key={category}>
            <h5>{title} <span className={styles.tag} data-certainty={finding.certainty}>{finding.certainty === "estimated" ? "Gemini 추정" : "미확인"}</span></h5>
            {finding.certainty === "estimated" ? <>
              <p>{finding.description}</p>
              <p className={styles.note}>시각 단서 · {finding.basis}</p>
            </> : <p className={styles.note}>이미지에서 확인할 수 없었어요.</p>}
          </li>;
        })}
      </ul>
      <h4 className={styles.promptTitle}>이미지 생성 프롬프트</h4>
      <PromptCard key={`en:${semantic.prompts.en ?? ""}`} language="en" original={semantic.prompts.en} />
      <PromptCard key={`ko:${semantic.prompts.ko ?? ""}`} language="ko" original={semantic.prompts.ko} />
    </>}
  </div>;
}
