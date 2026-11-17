// 미전환 legacy(SQLite·이 PC 파일) 업무 API를 열어도 되는지 판단하는 순수 함수(T-198).
// 환경을 인자로만 받고, 파일·DB·네트워크를 건드리지 않는다.
// 규칙은 Backend의 selectProjectReadBackend와 같은 경계를 쓴다:
// - Vercel(클라우드)에서는 legacy를 열지 않는다(이 PC의 SQLite·파일이 없음).
// - DREAM_PROJECT_READ_BACKEND가 없거나 "sqlite"일 때만 이 PC의 legacy를 연다.
// - "postgres"나 알 수 없는 값이면 legacy를 닫는다(실수로 다른 저장소에 쓰지 않게).
export function legacyDataAvailable(env: Readonly<Record<string, string | undefined>>) {
  if (env.VERCEL) return false;
  const backend = env.DREAM_PROJECT_READ_BACKEND;
  return backend === undefined || backend === "sqlite";
}

export const LEGACY_DATA_UNAVAILABLE = {
  code: "LEGACY_DATA_UNAVAILABLE",
  error: "클라우드 작업실은 아직 준비 중이라 이 기능을 쓸 수 없어요. 내 PC 작업실에서 이용해 주세요.",
} as const;
