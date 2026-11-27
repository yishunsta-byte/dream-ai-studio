import "server-only";
import { openRuntimeStyleDnaGenerationCredentialStore, type StyleDnaGenerationCredentialStore } from "./analysis-credential-store";
import { createFluxAdapter, type FluxGenerator } from "./style-dna-flux-provider";
import { createGptImageAdapter, type GptImageGenerator } from "./style-dna-gpt-image-provider";
import type { StyleDnaGenerationProvider } from "./style-dna-generation-credential-contract";
import { createSeedreamAdapter, type SeedreamCredentials, type SeedreamGenerator } from "./style-dna-seedream-provider";

// 기본 앱의 생성기 연결. 모듈을 읽을 때는 DB·환경 값을 건드리지 않고, 요청마다 생성 키 저장소를 연다.
// - 키 저장소 환경이 없으면 open/metadata가 undefined: 목록에 생성 모델 줄이 없고, 생성 요청은 not_configured(503).
// - 환경이 반쯤만 있거나 0004 미설치·DB 오류면 예외: 목록은 줄 없음, 생성 요청은 storage_unavailable(503).
// - 계정에 BytePlus 키가 등록돼 있을 때만 Seedream 5.5 줄, BFL 키가 등록돼 있을 때만 FLUX.2 pro 줄이 생긴다
//   (공급자 호출은 결과 테스트에서 누를 때만). 두 공급자의 키·버전은 서로 독립이다.
type Dependencies = { store: () => StyleDnaGenerationCredentialStore | null; send: typeof fetch };
const defaults: Dependencies = { store: openRuntimeStyleDnaGenerationCredentialStore, send: (...args) => fetch(...args) };

/** 한 생성 공급자의 저장 키를 생성기 자격으로 잇는다(다른 공급자 키는 읽지 않는다). */
export function runtimeGenerationCredentials(store: Dependencies["store"], provider: StyleDnaGenerationProvider): SeedreamCredentials {
  return {
    async metadata(owner) {
      const saved = (await store()?.metadata(owner))?.[provider];
      return saved && { version: saved.version };
    },
    async open(owner) {
      const saved = await store()?.open(owner, provider);
      return saved && { apiKey: saved.apiKey, version: saved.version };
    },
    async whileCurrent(owner, version, run) {
      const current = store();
      return current ? current.whileCurrent(owner, provider, version, run) : undefined;
    },
  };
}
export const seedreamRuntimeCredentials = (store: Dependencies["store"]) => runtimeGenerationCredentials(store, "byteplus");

export function runtimeImageGenerators(overrides: Partial<Dependencies> = {}): { seedream: SeedreamGenerator; flux: FluxGenerator; gptImage: GptImageGenerator } {
  const deps = { ...defaults, ...overrides };
  return {
    seedream: { adapter: createSeedreamAdapter(deps.send), credentials: runtimeGenerationCredentials(deps.store, "byteplus") },
    flux: { adapter: createFluxAdapter(deps.send), credentials: runtimeGenerationCredentials(deps.store, "bfl") },
    // GPT Image 2.6: 생성 키 표의 openai 행만 쓴다(분석 엔진 openai 키는 읽지 않는다).
    gptImage: { adapter: createGptImageAdapter(deps.send), credentials: runtimeGenerationCredentials(deps.store, "openai") },
  };
}
