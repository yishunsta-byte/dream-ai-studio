// P1-07 오디오 원본(v1.15) 전용 화면 경로. 서버 페이지(app/admin/audio-analysis)와 클라이언트 음악 칸이 함께 쓰므로 지시어 없는 모듈에 둔다
// ("use client" 모듈의 값은 서버에서 클라이언트 참조가 되어 href·redirect에 쓰면 깨진다. P1-06 33ff5a0 참고).
export const audioAnalysisPath = "/admin/audio-analysis";

type Query = Record<string, string | string[] | undefined> | URLSearchParams;

/**
 * 전용 화면 주소. 작업실 문맥(project·scene)이 각각 하나의 문자열로 있을 때만 그 두 값만 옮긴다(다른 값은 버림).
 * 여기서는 형식·소유를 믿지 않는다: 화면의 AdminStudioReturn이 UUIDv7 형식과 소유자 제작 GET으로 다시 확인하고, 아니면 주소에서 지운다.
 */
export function audioAnalysisHref(query?: Query) {
  const read = (name: string) => {
    if (!query) return undefined;
    const values = query instanceof URLSearchParams ? query.getAll(name) : ([] as string[]).concat(query[name] ?? []);
    return values.length === 1 && values[0] ? values[0] : undefined;
  };
  const project = read("project"), scene = read("scene");
  return project && scene ? `${audioAnalysisPath}?${new URLSearchParams({ project, scene })}` : audioAnalysisPath;
}
