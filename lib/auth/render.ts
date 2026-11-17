import "server-only";
import { cache } from "react";
import { resolveServerAuth } from "./resolve";

// 서버 컴포넌트(화면 그리기) 전용 공유 판별(T-191).
// React cache는 한 번의 화면 그리기 안에서만 결과를 나눠 쓰고, 요청이 바뀌면 새로 판별한다(Next 16 문서 authentication.md).
// 라우트 핸들러에서는 효과가 없으니 쓰지 않는다. 라우트는 resolveServerAuth 결과를 직접 넘긴다.
export const getRenderAuth = cache(resolveServerAuth);

// 화면 상단 계정 표시용. 허용·확인된 계정만 이메일을 돌려준다.
export async function currentAccountEmail() {
  const result = await getRenderAuth();
  return result.kind === "verified" ? result.email : null;
}
