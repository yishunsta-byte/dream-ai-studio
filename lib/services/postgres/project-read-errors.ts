import "server-only";

const definitions = {
  AUTH_REQUIRED: { status: 401, error: "로그인이 필요해요. 다시 로그인해 주세요." },
  AUTH_UNAVAILABLE: { status: 503, error: "로그인 설정이 아직 끝나지 않았어요. 관리자에게 알려 주세요." },
  INVALID_INPUT: { status: 400, error: "프로젝트 주소를 확인해 주세요." },
  NOT_FOUND: { status: 404, error: "프로젝트를 찾을 수 없어요." },
  PROJECT_READ_UNAVAILABLE: { status: 503, error: "프로젝트를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." },
} as const;
export type ProjectReadErrorCode = keyof typeof definitions;
const issued = new WeakSet<object>();

export class ProjectReadError extends Error {
  readonly status: 400 | 401 | 404 | 503;
  private constructor(readonly code: ProjectReadErrorCode) {
    super(definitions[code].error);
    this.name = "ProjectReadError";
    this.status = definitions[code].status;
    issued.add(this);
    Object.freeze(this);
  }
  static create(code: ProjectReadErrorCode): ProjectReadError { return new ProjectReadError(code); }
}
export const projectReadError = (code: ProjectReadErrorCode) => ProjectReadError.create(code);
export function isProjectReadError(error: unknown): error is ProjectReadError {
  return typeof error === "object" && error !== null && issued.has(error);
}
export function projectReadFailure(error: unknown) {
  const safe = isProjectReadError(error) ? error : projectReadError("PROJECT_READ_UNAVAILABLE");
  return { status: safe.status, body: { error: safe.message, code: safe.code }, headers: { "cache-control": "no-store" } };
}
