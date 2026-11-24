import "server-only";
import { appendFileSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import type { AdminPublicationStore } from "../../lib/public-showcase/admin-publication-service";
import { assemblePublicationProviders } from "../../lib/public-showcase/publication-provider-assembly";
import { openIsolatedPublicationPublicReader } from "../../lib/public-showcase/publication-public-reader";
import type { T306Config } from "./t306-publication-e2e-inject";
import { createT306PublicationStore } from "./t306-publication-e2e-store";

// T326 격리 사본 전용 주입 모듈(커밋된 시험 fixture). 제품 파일은 이 모듈을 import하지 않는다.
// T325 assemblePublicationProviders() 한 번의 결과(프로세스 전역 하나)를 관리자 게시 API와 공개 홈·표지 라우트가 함께 쓴다.
// 격리 사본에서만 다음 자리를 바꾼다(커밋하지 않는 패치):
//   instrumentation.ts register → await t326Ready()            (서버가 요청을 받기 전에 조립을 끝낸다)
//   admin-publication-http productionPublicationStore → t326AdminStore()
//   publication-showcase-connection publicationShowcaseConnection → t326PublicReaders()
//   lib/auth/resolve.ts resolveServerAuth → t306Auth (T306 합성 계정 쿠키)
// 입력: T306_CONFIG(T306 네이티브 실행기가 쓴 루프백 PG17 설정), T326_MODE, T326_EVENTS(열기·닫기 기록 파일).
//   T326_MODE = normal | missing(조립 구성 없음) | admin-mismatch(승인 대상이 다른 DB) | cover-mismatch(표지 대상만 다름, 합성)
type Mode = "normal" | "missing" | "admin-mismatch" | "cover-mismatch";
type Assembled = Awaited<ReturnType<typeof assemblePublicationProviders>>;
const g = globalThis as unknown as { __t326?: Promise<Assembled>; __t326Result?: Assembled };

function event(line: string) {
  const path = process.env.T326_EVENTS;
  if (path) appendFileSync(path, `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
}
function config(): T306Config {
  const path = process.env.T306_CONFIG;
  if (!path) throw new Error("T306_CONFIG missing");
  return JSON.parse(readFileSync(path, "utf8")) as T306Config;
}
const targetOf = (host: string, port: number, database: string) => `${host}:${port}/${database}`;

async function verifiedTarget(pool: Pool) {
  const { rows } = await pool.query<{ host: string; port: number; db: string }>(
    "SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_database() AS db");
  if (rows.length !== 1) throw new Error("T326 target probe failed");
  return targetOf(rows[0].host, rows[0].port, rows[0].db);
}

async function assemble(): Promise<Assembled> {
  const mode = (process.env.T326_MODE ?? "normal") as Mode;
  event(`assemble-start mode=${mode}`);
  let current: T306Config | undefined;
  try { if (mode !== "missing") current = config(); } catch { event("config-unreadable"); }
  if (!current) {
    // 구성이 없거나 읽을 수 없으면(빌드 중 포함) 조립 옵션 없이 호출해 세 공급원을 모두 닫힌 상태로 둔다.
    const result = await assemblePublicationProviders();
    event(`assemble-done mode=${result.mode}`);
    return result;
  }
  const { port, database, actors, list, file, timeoutMs, imageBase64, sha } = current;
  const real = targetOf("127.0.0.1", port, database);
  const approvedTarget = mode === "admin-mismatch" ? targetOf("127.0.0.1", port, `t253_${"0".repeat(32)}`) : real;

  const openAdmin = async () => {
    const pool = (user: string, password: string) => {
      const created = new Pool({ host: "127.0.0.1", port, database, user, password, ssl: false, max: 4,
        connectionTimeoutMillis: 5000, statement_timeout: 12_000, application_name: `t326-${user}` });
      created.on("error", () => undefined);
      return created;
    };
    const pools = { [actors.A.id]: pool(actors.A.user, actors.A.password), [actors.B.id]: pool(actors.B.user, actors.B.password) };
    const all = Object.values(pools);
    try {
      const targets = await Promise.all(all.map(verifiedTarget));
      if (new Set(targets).size !== 1) throw new Error("T326 admin pools disagree");
      const store: AdminPublicationStore = createT306PublicationStore(pools);
      event(`admin-open target=${targets[0]}`);
      return {
        verifiedTarget: targets[0], store,
        async close() {
          await Promise.all(all.map((p) => p.end()));
          event(`admin-close pools=${all.map((p) => p.totalCount).join(",")}`);
        },
      };
    } catch (error) {
      await Promise.allSettled(all.map((p) => p.end()));
      event("admin-open-failed (pools ended)");
      throw error;
    }
  };

  const openPublic = async () => {
    const bytes = Buffer.from(imageBase64, "base64");
    const key = new RegExp(`^[a-z0-9-]+/[1-9][0-9]*/${sha}\\.webp$`);
    const readers = await openIsolatedPublicationPublicReader({
      profile: "t295-loopback-fixture", database, port, listPassword: list, filePassword: file, timeoutMs,
      async readPrivateCover(objectKey, { maxBytes }) {
        if (!key.test(objectKey) || bytes.byteLength > maxBytes) throw new Error("T326 private cover not found");
        return Uint8Array.from(bytes);
      },
    });
    if (!("close" in readers) || readers.showcaseSource.mode !== "active") throw new Error("T326 public readers unavailable");
    // 리더는 두 로그인의 역할·DB·호스트·포트·버전을 실제 연결에서 증명한 뒤에만 active를 돌려준다(T298). 그 증명값이 대상이다.
    const coverTarget = mode === "cover-mismatch" ? `${real}#synthetic-other-cover-target` : real;
    event(`public-open list=${real} cover=${coverTarget}`);
    return {
      ...readers, verifiedListTarget: real, verifiedCoverTarget: coverTarget,
      async close() { await readers.close(); event("public-close"); },
    };
  };

  const result = await assemblePublicationProviders({ approvedTarget, openAdmin, openPublic });
  event(`assemble-done mode=${result.mode}`);
  return result;
}

/** 프로세스 안 조립은 한 번만. instrumentation register에서 기다린다. */
export function t326Ready(): Promise<Assembled> {
  g.__t326 ??= assemble().then((result) => { g.__t326Result = result; return result; });
  return g.__t326;
}

/** admin-publication-http의 productionPublicationStore 대체. 조립이 끝나기 전·비활성이면 null(503 PUBLICATION_UNLINKED). */
export function t326AdminStore(): AdminPublicationStore | null {
  return g.__t326Result?.adminStore ?? null;
}

/** publication-showcase-connection의 publicationShowcaseConnection 대체. 같은 조립 결과의 목록·표지 공급원. */
export async function t326PublicReaders() {
  const { showcaseSource, coverSource } = await t326Ready();
  return { showcaseSource, coverSource };
}
