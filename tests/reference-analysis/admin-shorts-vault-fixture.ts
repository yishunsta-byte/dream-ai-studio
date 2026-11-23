import { shortsIdeaPhases } from "@/lib/reference-analysis/shorts-ideas-contract";
import type { ShortsVaultProjectDocument, ShortsVaultPromptSetDocument } from "@/lib/reference-analysis/shorts-vault-contract";

// 합성 문서: 영상 ID와 제품이 만든 결과만. 지표·댓글·비밀 없음.
const scenes = [
  { sceneNumber: 1, startSec: 0, endSec: 3 },
  { sceneNumber: 2, startSec: 3, endSec: 10 },
  { sceneNumber: 3, startSec: 10, endSec: 17 },
];
const prompt = (scene: (typeof scenes)[number]) => ({ ...scene, sceneSummary: "화면의 전후 차이를 보여준다.",
  imagePrompt: "Portrait 9:16 close-up, soft window light, plain background.",
  videoPrompt: "Slow dolly in, then hold on the subject profile." });
const bgm = { title: "전후 비교 BGM", genreAndMood: "밝은 일렉트로닉 팝", recommendedBpmRange: { min: 110, max: 124 },
  instrumentation: "신스 베이스, 클랩", dynamicStructure: "훅에서 멈췄다가 다시 올라간다.", audioMixingNotes: "내레이션 아래로 둔다.",
  sunoPrompt: "Instrumental, no vocals, bright electronic pop, 118 BPM." };
const idea = { title: "영상 편집 전후", openingHook: "두 결과를 나란히 봅니다.", hookStrategy: "전후 비교",
  beats: shortsIdeaPhases.map(phase => ({ phase, action: "한 장면씩 비교를 이어간다" })) };

export const promptSetDocument = (): ShortsVaultPromptSetDocument => ({
  title: "전후 비교 프롬프트", ideaTitle: idea.title, hook: idea.openingHook, keyword: "영상 편집",
  videoIds: ["A1b2C3d4E5F"], durationSec: 17, prompts: scenes.map(prompt), bgmPrompt: bgm,
});

export const projectDocument = (step = 6): ShortsVaultProjectDocument => ({
  title: "영상 편집 탐색", keyword: "영상 편집", step, videoIds: ["A1b2C3d4E5F", "Z9y8X7w6V5_"],
  source: { evidence: "youtube_metadata", videoId: "A1b2C3d4E5F", provenance: "client_supplied" },
  context: { evidence: "youtube_metadata", videoId: "A1b2C3d4E5F", summary: "전후 비교형 편집 쇼츠", topics: ["편집"], productionHypotheses: ["전후 대비"] },
  ideas: Array.from({ length: 6 }, (_, index) => ({ ...idea, title: `${idea.title} ${index + 1}`, selectionReason: "비교가 빠르다",
    assessment: { rationale: "모델 추정", potentialScore: 70, expectedRetentionPercent: null, kind: "model_estimate" as const } })),
  selectedIdea: idea, direction: "밝은 톤으로",
  scriptConfig: { durationSec: 17, tone: "친근하게" },
  script: { kind: "creative_script_draft", durationSec: 17, scenes: scenes.map(scene => ({ ...scene, narration: "비교해 보세요.",
    visual: "정면에서 다가간다.", caption: null, sfx: null })) },
  scenePrompts: { kind: "creative_scene_prompts_draft", durationSec: 17, prompts: scenes.map(prompt), bgmPrompt: bgm },
  bgmPrompt: { ...bgm, kind: "creative_bgm_prompt_draft", durationSec: 17 },
});

// P1-08-SHORTS-VAULT-CONTENT-SEARCH-API: 검색 대상 필드만 바꾼 합성 프롬프트 세트. 기본값은 서로 겹치지 않는 중립 글자라 의도한 필드만 맞는다.
export type SearchFields = { title?: string; ideaTitle?: string; hook?: string; keyword?: string; sunoPrompt?: string | null;
  sceneSummary?: string; imagePrompt?: string; videoPrompt?: string; scenes?: number };
export const searchablePromptSet = (fields: SearchFields = {}): ShortsVaultPromptSetDocument => {
  const count = fields.scenes ?? 3;
  return {
    title: fields.title ?? "중립 세트", ideaTitle: fields.ideaTitle ?? "중립 소재", hook: fields.hook ?? "", keyword: fields.keyword ?? "",
    videoIds: ["A1b2C3d4E5F"], durationSec: 17,
    prompts: Array.from({ length: count }, (_, index) => ({ sceneNumber: index + 1, startSec: index, endSec: index + 1,
      sceneSummary: index === count - 1 && fields.sceneSummary ? fields.sceneSummary : "중립 장면",
      imagePrompt: index === count - 1 && fields.imagePrompt ? fields.imagePrompt : "plain frame",
      videoPrompt: index === count - 1 && fields.videoPrompt ? fields.videoPrompt : "static shot" })),
    bgmPrompt: fields.sunoPrompt === null ? null : { ...bgm, title: "중립 BGM", genreAndMood: "중립", instrumentation: "중립", dynamicStructure: "중립",
      audioMixingNotes: "중립", sunoPrompt: fields.sunoPrompt ?? "Instrumental only." },
  };
};
