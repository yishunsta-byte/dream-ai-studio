import { Card } from "@/components/ui/primitives";

// 목록만 로딩 화면을 둔다. 단건([id])은 로딩 경계 밖에 두어 없는 프로젝트가 실제 404 상태로 응답되게 한다(T-207).
export default function Loading() {
  return <Card><p role="status">프로젝트를 불러오는 중이에요…</p></Card>;
}
