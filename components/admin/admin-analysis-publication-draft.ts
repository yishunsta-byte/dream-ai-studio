import type { ImageSemanticResult } from "@/lib/reference-analysis/image-semantic-result";
import type { MusicSemanticReport } from "@/lib/reference-analysis/music-semantic-contract";
import { containsNonPublicText } from "@/lib/reference-analysis/publication-text";
import type { ShortsAnalysisResult } from "@/lib/reference-analysis/shorts-analysis-contract";
import type { PublicationDraft } from "./admin-reference-analysis-model";

function proposal(text?: string | null) {
  return text && !containsNonPublicText(text) ? text : "";
}

export function imagePublicationDraft(result: Exclude<ImageSemanticResult, { status: "unavailable" }>, language: "ko" | "en"): PublicationDraft {
  const summary = result.findings.flatMap(finding => {
    if (finding.certainty !== "estimated" || (finding.category !== "composition" && finding.category !== "lighting")) return [];
    const detail = proposal(finding.description);
    return detail ? [`추정 ${finding.category === "composition" ? "구도" : "조명"} — ${detail}`] : [];
  });
  return { media: "image", title: "Style DNA 분석 결과", summary: summary.join("\n"), prompt: proposal(result.prompts[language]) };
}

export function musicPublicationDraft(report: MusicSemanticReport): PublicationDraft {
  const genre = proposal(report.genre);
  const instruments = report.instruments?.map(proposal).filter(Boolean).join(" · ");
  const sections = report.structure?.map(section => proposal(section.label)).filter(Boolean).join(" · ");
  const summary = [
    genre && `추정 장르 — ${genre}`, instruments && `추정 악기 — ${instruments}`,
    report.tempoBpm !== null && `추정 템포 — ${report.tempoBpm} BPM`, sections && `추정 구간 — ${sections}`,
  ].filter(Boolean).join("\n");
  return { media: "music", title: "음악 분석 결과", summary, prompt: proposal(report.sunoPrompt) };
}

export function shortsPublicationDraft(findings: ShortsAnalysisResult["findings"]): PublicationDraft {
  const summary = proposal(findings.summary);
  return {
    media: "video", title: "쇼츠 분석 결과", summary: summary ? `모델 추정 — ${summary}` : "",
    prompt: proposal(findings.draftPrompt),
  };
}
