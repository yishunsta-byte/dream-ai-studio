import { z } from "zod";

// 이미지 분석기 결과 테스트의 생성 공급자 키(분석 엔진 키와 따로 저장·버전 관리).
// 모델 ID·크기·가격표는 코드 계약(styleDnaGeneratedModels)에 고정이라 키 행에는 키와 버전만 둔다.
export const styleDnaGenerationCredentialPath = "/api/admin/style-dna/generation-credentials";
// byteplus: Seedream 5.5(BytePlus ModelArk), bfl: FLUX.2 pro(Black Forest Labs, x-key 머리글),
// openai: GPT Image 2.6 sunburst(Authorization: Bearer). openai 생성 키는 분석 엔진 openai 키(engine-credentials)와 다른 표·다른 버전이다.
export const styleDnaGenerationProvider = z.enum(["byteplus", "bfl", "openai"]);
export type StyleDnaGenerationProvider = z.infer<typeof styleDnaGenerationProvider>;

// BytePlus ModelArk API 키: Authorization: Bearer 머리글에 그대로 실리므로 RFC 6750 b64token 문자만 받는다
// (영문·숫자·-._~+/ 1자 이상, 끝에만 = 패딩). 길이는 제품 한도 16~256자. UUID형·새 ark 형식·패딩 키를 받고,
// 공백(앞뒤·개행 포함)·제어 문자·비ASCII·쉼표·중간 패딩·한도 초과는 거절한다. 다듬거나 잘라서 받지 않는다(화면·서버 공통).
// BFL 키도 같은 규칙을 쓴다. 공식 문서(docs.bfl.ml/account_management/organizations_projects)는 "bfl_<random-string>" 형식만
// 밝히고 길이·글자 종류는 밝히지 않는다. bfl_ 접두와 영숫자·밑줄은 이 규칙 안이므로 공급자별 규칙을 추측해 만들지 않는다
// (접두를 강제하지 않는다: 접두 없는 예전 키를 막을 근거가 없다). 키가 틀리면 첫 생성에서 provider_rejected로 드러난다.
// OpenAI 키도 같은 규칙이다(Bearer 머리글에 그대로 실리는 b64token). sk- 같은 접두는 강제하지 않는다.
export const styleDnaGenerationKeyLimits = { min: 16, max: 256 } as const;
export const styleDnaGenerationKey = z.string().min(styleDnaGenerationKeyLimits.min).max(styleDnaGenerationKeyLimits.max)
  .regex(/^[A-Za-z0-9._~+/-]+=*$/);
// 키에 쓸 수 있는 글자만으로 된 문자열인지(붙여 넣는 원문 검사용, 길이·패딩 위치는 보지 않는다).
export const styleDnaGenerationKeyCharacters = (value: string) => /^[A-Za-z0-9._~+/=-]*$/.test(value);
export const acceptsStyleDnaGenerationKey = (value: string) => styleDnaGenerationKey.safeParse(value).success;

// 형식 검사를 분리한다: 모양이 틀리면 400 invalid_input, 키 글자만 틀리면 422 invalid_key(화면 안내와 같은 구분).
export const styleDnaGenerationCredentialWrite = z.strictObject({
  provider: styleDnaGenerationProvider,
  expectedVersion: z.int().min(0).max(2_147_483_646),
  apiKey: z.string().max(4096),
});
export type StyleDnaGenerationCredentialWrite = z.infer<typeof styleDnaGenerationCredentialWrite>;

export type StyleDnaGenerationCredentialMetadata =
  | { configured: true; version: number; updatedAt: string }
  | { configured: false; version: 0; updatedAt: null };
export const unconfiguredGenerationCredential: StyleDnaGenerationCredentialMetadata = { configured: false, version: 0, updatedAt: null };
