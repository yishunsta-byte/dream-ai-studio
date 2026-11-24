import "server-only";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import type { AdminPublicationStore } from "../../lib/public-showcase/admin-publication-service";
import { openIsolatedPublicationPublicReader } from "../../lib/public-showcase/publication-public-reader";
import { createT306PublicationStore } from "./t306-publication-e2e-store";

// T306 격리 사본 전용 주입 모듈(커밋된 시험 fixture). 제품 파일은 이 모듈을 import하지 않는다.
// 격리 사본에서만 세 자리를 이 모듈로 바꾼다:
//   lib/auth/resolve.ts → t306Auth, admin-publication-http productionPublicationStore → t306AdminStore,
//   publication-showcase-connection → createPublicationShowcaseConnection(t306OpenReaders).
// 연결 정보는 네이티브 실행기가 임시 폴더에 쓴 T306_CONFIG 파일에서만 읽는다(같은 루프백 PG17 하나).
export type T306Config = Readonly<{
  port: number; database: string; timeoutMs: number;
  actors: Readonly<Record<"A" | "B", Readonly<{ id: string; user: string; password: string; email: string }>>>;
  list: string; file: string; imageBase64: string; sha: string;
}>;
const g = globalThis as unknown as { __t306?: { config: T306Config; store?: AdminPublicationStore } };

function state() {
  if (!g.__t306) {
    const path = process.env.T306_CONFIG;
    if (!path) throw new Error("T306_CONFIG missing");
    g.__t306 = { config: JSON.parse(readFileSync(path, "utf8")) as T306Config };
  }
  return g.__t306;
}

/** 합성 계정: 쿠키 t306-actor=A|B|X. 없으면 401. (격리 사본의 resolveServerAuth 대체) */
export async function t306Auth(): Promise<ServerAuthResult> {
  const { cookies } = await import("next/headers");
  const who = (await cookies()).get("t306-actor")?.value;
  const { actors } = state().config;
  if (who === "A" || who === "B") return { kind: "verified", userId: actors[who].id, email: actors[who].email };
  if (who === "X") return { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" };
  return { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
}

/** 관리자 게시 저장소: 계정별 PG 로그인(t293_actor_a/b)으로만 연결한다. */
export function t306AdminStore(): AdminPublicationStore {
  const current = state();
  if (current.store) return current.store;
  const { port, database, actors } = current.config;
  const pool = (user: string, password: string) => {
    const created = new Pool({ host: "127.0.0.1", port, database, user, password, ssl: false, max: 4,
      connectionTimeoutMillis: 5000, statement_timeout: 12_000, application_name: `t306-${user}` });
    created.on("error", () => undefined);
    return created;
  };
  current.store = createT306PublicationStore({
    [actors.A.id]: pool(actors.A.user, actors.A.password),
    [actors.B.id]: pool(actors.B.user, actors.B.password),
  });
  return current.store;
}

/** 공개 홈·표지 리더: T298 어댑터를 같은 DB의 T295 목록·표지 전용 로그인으로 연다. 비공개 표지 바이트는 합성 이미지. */
export function t306OpenReaders() {
  const { port, database, list, file, timeoutMs, imageBase64, sha } = state().config;
  const bytes = Buffer.from(imageBase64, "base64");
  const key = new RegExp(`^[a-z0-9-]+/[1-9][0-9]*/${sha}\\.webp$`);
  return openIsolatedPublicationPublicReader({
    profile: "t295-loopback-fixture", database, port, listPassword: list, filePassword: file, timeoutMs,
    async readPrivateCover(objectKey, { maxBytes }) {
      if (!key.test(objectKey) || bytes.byteLength > maxBytes) throw new Error("T306 private cover not found");
      return Uint8Array.from(bytes);
    },
  });
}
