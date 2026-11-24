// T-254 공개 커버 이미지. 정규형 /media/public/<slug>/<generation>/cover.webp 의 GET·HEAD만 제공한다.
// 경로 파라미터를 믿지 않고 serveCover가 요청 주소 원문을 공용 파서로 다시 판정한다.
// 그 밖의 메서드는 405(Allow: GET, HEAD). proxy가 인증 전에 먼저 405를 돌려주며, 여기서도 같은 계약을 지킨다.
import { coverStatus, serveCover } from "@/lib/public-showcase/cover-source";
import { getPublicationPublicReaders } from "@/lib/public-showcase/publication-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readCover(request: Request) {
  const { coverSource } = await getPublicationPublicReaders();
  return serveCover(request, coverSource);
}

export const GET = readCover;
export const HEAD = readCover;

export function OPTIONS() {
  return coverStatus(405, "OPTIONS");
}

export function POST() {
  return coverStatus(405, "POST");
}

export function PUT() {
  return coverStatus(405, "PUT");
}

export function PATCH() {
  return coverStatus(405, "PATCH");
}

export function DELETE() {
  return coverStatus(405, "DELETE");
}
