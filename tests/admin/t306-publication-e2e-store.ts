import "server-only";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import type { AdminPublicationStore, AdminPublicationTransaction, AdminPublicationWork } from "../../lib/public-showcase/admin-publication-service";

// T306 시험 전용 관리자 게시 저장소(운영 저장소 아님). 격리 사본에서만 productionPublicationStore 자리에 주입한다.
// - 구조는 검토된 T293 앱 어댑터(tests/public-showcase/t293-admin-publication-adapter.ts)와 같다:
//   한 트랜잭션 안에서 게시자 확인·소유 작품 잠금(FOR UPDATE)·요청 UUID 원장(advisory lock)·증빙·표지 읽기·저장·감사.
// - 다른 점은 SQL 쓰기 하나뿐이다. T293 어댑터의 t293.apply_t253 대신, 검토된 T295 오버레이의 t295.apply를 부른다.
//   그래야 권리 고정(frozen_manifest)·활성 권리(activation)가 같은 트랜잭션에 남아 T298 공개 리더(만료 적용)에 보인다.
// - 서비스 판정과 SQL 결과가 다르면 예외로 전체를 롤백한다(서비스는 unavailable). 계정별 로그인(t293_actor_a/b)만 쓴다.
// - T306-F1: 결과 DTO만 같아서는 부족하다. 같은 트랜잭션 안에서 SQL이 실제로 고정·활성화한 권리(원본·권리 참조·
//   무기한/시한부·정확한 종료 시각·manifest 전체)를 서비스가 저장하려는 상태와 대조하고, 하나라도 다르면 전부 롤백한다.
//   읽기는 fixture 전용 t306.rights_state(본인 행만, 읽기 전용)로 한다. 종료 시각은 DB에서 numeric(정확한 10진)으로
//   밀리초를 계산해 문자열로 받고, 밀리초 아래 자투리가 있으면 "frac:" 값으로 돌려 반드시 불일치가 되게 한다.
type Entry = NonNullable<Awaited<ReturnType<AdminPublicationTransaction["findRequest"]>>>;
type CandidateEvidence = { cover: { sha: string; sizeBytes: number }; rights: { expiresAtMs: number | null } };
type RightsRow = { rights_ref: string; manifest: Record<string, unknown>; mode: string; expires_ms: string | null };
type RightsState = { frozen: RightsRow | null; activation: (RightsRow & { approved_ms: string }) | null };

/** 권리 대조 실패. 저장소가 던지면 트랜잭션 전체가 롤백되고 서비스는 unavailable을 돌려준다. */
export class T306RightsMismatch extends Error {}
function expect(condition: boolean, what: string): asserts condition {
  if (!condition) throw new T306RightsMismatch(what);
}
/** 서비스 쪽 종료 시각(정수 ms 또는 null)과 SQL 쪽 mode/종료 시각이 정확히 같은지. */
function sameWindow(row: RightsRow, untilMs: number | null) {
  if (untilMs === null) return row.mode === "perpetual" && row.expires_ms === null;
  return Number.isSafeInteger(untilMs) && row.mode === "timed" && row.expires_ms === String(untilMs);
}
function sameJson(left: unknown, right: unknown) {
  try { assert.deepStrictEqual(left, right); return true; } catch { return false; }
}
export type T306Pools = Readonly<Record<string, Pool>>;

export function createT306PublicationStore(pools: T306Pools): AdminPublicationStore {
  return {
    async transaction<T>(operation: (tx: AdminPublicationTransaction) => Promise<T>): Promise<T> {
      let client: PoolClient | undefined;
      let committed = false;
      let actorId: string | undefined;
      let lockedSlug: string | undefined;
      let lockedVersion: string | undefined;
      let currentEvidence: CandidateEvidence | undefined;
      let authorizationChanged = false;

      async function open(actor: string) {
        if (client) { assert.equal(actor, actorId); return client; }
        const pool = Object.prototype.hasOwnProperty.call(pools, actor) ? pools[actor] : undefined;
        if (!pool) throw new Error("T306 unknown actor");
        client = await pool.connect();
        actorId = actor;
        await client.query("BEGIN");
        await client.query("SELECT set_config('t293.actor',$1,true)", [actor]);
        return client;
      }
      const current = () => { assert(client); return client; };
      let preparedManifest: Record<string, unknown> | undefined;
      async function rightsState(slug: string, generation: string) {
        return (await current().query<{ state: RightsState }>("SELECT t306.rights_state($1,$2::bigint) AS state", [slug, generation])).rows[0].state;
      }
      async function requirePublisher() {
        const allowed = (await current().query<{ allowed: boolean }>("SELECT t293.can_publish() AS allowed")).rows[0].allowed;
        if (!allowed) { authorizationChanged = true; throw new Error("T306 publisher grant changed"); }
      }
      async function recordRequest(entry: Entry, manifestGeneration: string | null) {
        assert(actorId && lockedSlug);
        const result = await current().query(`INSERT INTO t293.app_requests(owner_id,request_id,slug,entry,manifest_generation)
          VALUES ($1,$2,$3,$4,$5)`, [actorId, requestKey, lockedSlug, entry, manifestGeneration]);
        assert.equal(result.rowCount, 1);
      }
      let requestKey: string | undefined;

      try {
        const result = await operation({
          async isPublisher(actor) {
            const db = await open(actor.id);
            return (await db.query<{ allowed: boolean }>("SELECT t293.can_publish() AS allowed")).rows[0].allowed;
          },
          async listOwnedWorks(actor) {
            const db = await open(actor.id);
            return (await db.query<{ state: AdminPublicationWork }>("SELECT state FROM t293.works WHERE owner_id=$1 ORDER BY slug", [actor.id]))
              .rows.map((row) => row.state);
          },
          async findOwnedWork(actor, slug) {
            const db = await open(actor.id);
            const found = await db.query<{ state: AdminPublicationWork }>("SELECT state FROM t293.works WHERE owner_id=$1 AND slug=$2 FOR UPDATE", [actor.id, slug]);
            const work = found.rows[0]?.state ?? null;
            if (work) { lockedSlug = work.slug; lockedVersion = work.revision; }
            return work;
          },
          async findRequest(actor, requestId) {
            const db = await open(actor.id);
            requestKey = requestId.toLowerCase();
            await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 293))", [`${actor.id}/${requestKey}`]);
            const { rows: [decision] } = await db.query<{ allowed: boolean; entry: Entry | null }>(`
              WITH grant_state AS MATERIALIZED (SELECT t293.can_publish() AS allowed)
              SELECT allowed, CASE WHEN allowed THEN (SELECT entry FROM t293.app_requests WHERE owner_id=$1 AND request_id=$2) END AS entry
              FROM grant_state`, [actor.id, requestKey]);
            if (!decision.allowed) { authorizationChanged = true; throw new Error("T306 publisher grant changed"); }
            return decision.entry;
          },
          async readEvidence(actor, work) {
            const db = await open(actor.id);
            currentEvidence = (await db.query<{ value: CandidateEvidence }>("SELECT value FROM t293.evidence WHERE owner_id=$1 AND slug=$2",
              [actor.id, work.slug])).rows[0]?.value;
            return currentEvidence; // 시한부 권리도 받는다. 만료 판정은 서비스와 t295.apply가 각각 한다.
          },
          async readCover(actor, key, maxBytes) {
            const db = await open(actor.id);
            const found = await db.query<{ bytes: Buffer | null }>(`SELECT CASE WHEN octet_length(bytes) <= $3 THEN bytes END AS bytes
              FROM t293.cover_objects WHERE owner_id=$1 AND object_key=$2`, [actor.id, key, maxBytes]);
            if (!found.rows.length) return null;
            if (!found.rows[0].bytes) throw new Error("T306 cover size limit");
            return found.rows[0].bytes;
          },
          async saveFailure(actor, requestId, entry) {
            assert.equal(actor.id, actorId);
            assert.equal(requestId, requestKey);
            await requirePublisher();
            await recordRequest(entry, null);
          },
          async save(change) {
            const { work, audit, request } = change;
            assert.equal(work.slug, lockedSlug);
            assert.equal(audit.actorId, actorId);
            assert.equal(audit.requestId, requestKey);
            const command = audit.command;
            const db = current();
            if (command === "prepare") {
              assert(currentEvidence);
              // 앱 원장의 manifest 참조(외래 키)용. 공개 manifest는 t295.apply가 권리 증명(attestation)에서 고정한다.
              const display = Object.fromEntries(Object.entries(work.display as Record<string, unknown>).map(([key, value]) =>
                [key, typeof value === "string" ? value.trim() : value]));
              preparedManifest = {
                sourceId: audit.artifactId, sourceRevision: audit.artifactRevision, sourceSha: work.artifact.sha,
                rightsRef: audit.rightsReference, display, coverSha: currentEvidence.cover.sha, coverBytes: currentEvidence.cover.sizeBytes,
              };
              await db.query("INSERT INTO t293.manifests VALUES ($1,$2,$3,$4)", [actorId, work.slug, audit.generation, preparedManifest]);
            }
            const expectedVersion = String(BigInt(audit.version) - 1n);
            const generation = command === "prepare" ? null : audit.generation;
            const applied = await db.query<{ outcome: Entry["outcome"] }>("SELECT t295.apply($1,$2,$3,$4,$5,$6) AS outcome",
              [requestKey, command, work.slug, expectedVersion, generation, command === "prepare" ? audit.rightsReference : null]);
            // 서비스와 SQL 판정이 다르면 어느 쪽도 남기지 않는다.
            assert.deepEqual(applied.rows[0].outcome, request.outcome);
            let state = work;
            let recorded = audit;
            const rights = await rightsState(work.slug, audit.generation);
            if (command === "prepare") {
              // 최초 고정: SQL이 권리 증명에서 고정한 manifest·참조·기간 == 서비스가 증빙으로 검수한 값
              assert(currentEvidence && preparedManifest);
              expect(rights.frozen !== null && rights.activation === null, "prepare: frozen manifest missing");
              expect(rights.frozen.rights_ref === audit.rightsReference, "prepare: rights reference");
              expect(sameJson(rights.frozen.manifest, preparedManifest), "prepare: manifest");
              expect(sameWindow(rights.frozen, currentEvidence.rights.expiresAtMs), "prepare: rights window");
            }
            if (command === "complete") {
              const clock = await db.query<{ approved_ms: string | null }>("SELECT t293.approved_ms($1,$2) AS approved_ms", [work.slug, audit.generation]);
              const approvedMs = Number(clock.rows[0].approved_ms);
              assert(work.active && Number.isSafeInteger(approvedMs) && approvedMs > 0);
              const appManifest = (await db.query<{ value: unknown }>("SELECT value FROM t293.manifests WHERE owner_id=$1 AND slug=$2 AND generation=$3",
                [actorId, work.slug, audit.generation])).rows[0]?.value;
              // 활성화: 같은 세대의 고정 manifest·활성 권리가 앱 상태(active)와 정확히 같아야 공개 리더와 관리자 화면이 일치한다.
              expect(rights.frozen !== null && rights.activation !== null, "complete: activation missing");
              expect(sameJson(rights.frozen.manifest, appManifest), "complete: manifest");
              for (const row of [rights.frozen, rights.activation]) {
                expect(row.rights_ref === work.active.rightsReference, "complete: rights reference");
                expect(sameWindow(row, work.active.rightsUntilMs), "complete: rights window");
              }
              expect(rights.activation.approved_ms === String(approvedMs), "complete: approval time");
              if (work.active.rightsUntilMs !== null) expect(approvedMs < work.active.rightsUntilMs, "complete: approval after expiry");
              state = { ...work, active: { ...work.active, approvedMs } };
              recorded = { ...audit, atMs: approvedMs };
            }
            if (command === "revoke") {
              const clock = await db.query<{ approved_ms: string | null }>("SELECT t293.approved_ms($1,$2) AS approved_ms", [work.slug, audit.generation]);
              expect(clock.rows[0].approved_ms === null, "revoke: generation still active");
            }
            const updated = await db.query("UPDATE t293.works SET state=$3 WHERE owner_id=$1 AND slug=$2 AND state->>'revision'=$4",
              [actorId, work.slug, state, lockedVersion]);
            assert.equal(updated.rowCount, 1);
            await recordRequest(request, command === "revoke" ? null : audit.generation);
            await db.query("INSERT INTO t293.audit VALUES ($1,$2,$3)", [actorId, requestKey, recorded]);
          },
        });
        if (client) await client.query("COMMIT");
        committed = true;
        return result;
      } catch (error) {
        if (client && !committed) await client.query("ROLLBACK").catch(() => undefined);
        if (authorizationChanged) throw new T306AuthorizationChanged();
        throw error;
      } finally {
        client?.release();
      }
    },
  };
}

/** 트랜잭션 중 게시 권한이 사라짐. 서비스는 이 예외를 unavailable로 돌려준다(원장·감사 없음). */
export class T306AuthorizationChanged extends Error {}
