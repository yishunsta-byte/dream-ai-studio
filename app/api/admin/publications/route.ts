import { createAdminPublicationHttp } from "@/lib/public-showcase/admin-publication-http";

// T297 관리자 게시 큐 API. 판정은 모두 서버 경계(lib/public-showcase/admin-publication-http.ts)와 T290 서비스가 한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return createAdminPublicationHttp().handleGet();
}

export async function POST(request: Request) {
  return createAdminPublicationHttp().handlePost(request);
}
