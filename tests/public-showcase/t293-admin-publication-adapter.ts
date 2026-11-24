import assert from "node:assert/strict";
import type { Client } from "pg";
import type { PublicationAction } from "../../components/admin/publication-model";
import type { resolveServerAuth } from "../../lib/auth/resolve";
import type { VerifiedActor } from "../../lib/db/postgres/types";
import { createAdminPublicationService, type AdminPublicationStore, type AdminPublicationTransaction,
  type AdminPublicationWork } from "../../lib/public-showcase/admin-publication-service";

type Hooks = { afterWrites?: () => Promise<void>; afterCommit?: () => void; failReadCover?: () => void };
type Entry = NonNullable<Awaited<ReturnType<AdminPublicationTransaction["findRequest"]>>>;
type CandidateEvidence = { rights?: { expiresAtMs?: number | null }; cover: { sha: string; sizeBytes: number } };

/** Test-only. `client` belongs to a single isolated login and each command supplies its own transaction. */
export function applyPgPublication(client: Client, resolveAuth: typeof resolveServerAuth, action: PublicationAction, hooks: Hooks = {}) {
  const requestKey = action.requestId.toLowerCase();
  let authorizationChanged = false;
  const store: AdminPublicationStore = { transaction: async <T>(operation: (tx: AdminPublicationTransaction) => Promise<T>) => {
    await client.query("BEGIN");
    let committed = false;
    try {
      let actorId: string | undefined;
      let lockedSlug: string | undefined;
      let lockedVersion: string | undefined;
      let currentEvidence: CandidateEvidence | undefined;

      async function recordRequest(entry: Entry, manifestGeneration: string | null) {
        assert(actorId && lockedSlug);
        const result = await client.query(`INSERT INTO t293.app_requests(owner_id,request_id,slug,entry,manifest_generation)
          VALUES ($1,$2,$3,$4,$5)`, [actorId, requestKey, lockedSlug, entry, manifestGeneration]);
        assert.equal(result.rowCount, 1);
      }

      function requirePublisher(allowed: boolean) {
        if (allowed) return;
        authorizationChanged = true;
        throw new Error("T293 publisher grant changed");
      }

      const result = await operation({
        async isPublisher(actor) {
          actorId = actor.id;
          await client.query("SELECT set_config('t293.actor',$1,true)", [actor.id]);
          return (await client.query<{ allowed: boolean }>("SELECT t293.can_publish() AS allowed")).rows[0].allowed;
        },
        async listOwnedWorks(actor) {
          return (await client.query<{ state: AdminPublicationWork }>("SELECT state FROM t293.works WHERE owner_id=$1 ORDER BY slug", [actor.id]))
            .rows.map(row => row.state);
        },
        async findOwnedWork(actor, slug) {
          const found = await client.query<{ state: AdminPublicationWork }>(
            "SELECT state FROM t293.works WHERE owner_id=$1 AND slug=$2 FOR UPDATE", [actor.id, slug]);
          const work = found.rows[0]?.state ?? null;
          if (work) { lockedSlug = work.slug; lockedVersion = work.revision; }
          return work;
        },
        async findRequest(actor, requestId) {
          // A UUID may be used against different slugs. Serialize its one decision too.
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 293))", [`${actor.id}/${requestId}`]);
          const { rows: [decision] } = await client.query<{ allowed: boolean; entry: Entry | null }>(`
            WITH grant_state AS MATERIALIZED (SELECT t293.can_publish() AS allowed)
            SELECT allowed, CASE WHEN allowed THEN (SELECT entry FROM t293.app_requests WHERE owner_id=$1 AND request_id=$2) END AS entry
            FROM grant_state`, [actor.id, requestId]);
          requirePublisher(decision.allowed);
          return decision.entry;
        },
        async readEvidence(actor, work) {
          currentEvidence = (await client.query<{ value: CandidateEvidence }>("SELECT value FROM t293.evidence WHERE owner_id=$1 AND slug=$2",
            [actor.id, work.slug])).rows[0]?.value;
          // T253 public readers do not enforce rights expiry. Only explicit-revocation grants can enter this fixture.
          return currentEvidence?.rights?.expiresAtMs === null ? currentEvidence : null;
        },
        async readCover(actor, key, maxBytes) {
          hooks.failReadCover?.();
          const found = await client.query<{ bytes: Buffer | null }>(`SELECT CASE WHEN octet_length(bytes) <= $3 THEN bytes END AS bytes
            FROM t293.cover_objects WHERE owner_id=$1 AND object_key=$2`, [actor.id, key, maxBytes]);
          if (!found.rows.length) return null;
          if (!found.rows[0].bytes) throw new Error("T293 cover size limit");
          return found.rows[0].bytes;
        },
        async saveFailure(actor: VerifiedActor, requestId, entry) {
          assert.equal(actor.id, actorId);
          assert.equal(requestId, requestKey);
          const role = await client.query<{ allowed: boolean }>("SELECT t293.can_publish() AS allowed");
          requirePublisher(role.rows[0].allowed);
          await recordRequest(entry, null);
          await hooks.afterWrites?.();
        },
        async save(change) {
          const { work, audit, request } = change;
          assert.equal(work.slug, lockedSlug);
          assert.equal(audit.actorId, actorId);
          assert.equal(audit.requestId, requestKey);
          assert.equal(audit.command, action.command);
          let manifest: unknown = null;
          if (action.command === "prepare") {
            assert(currentEvidence);
            const display = Object.fromEntries(Object.entries(work.display as Record<string, unknown>).map(([key, value]) =>
              [key, typeof value === "string" ? value.trim() : value]));
            manifest = {
              sourceId: audit.artifactId, sourceRevision: audit.artifactRevision, sourceSha: work.artifact.sha,
              rightsRef: audit.rightsReference, display,
              coverSha: currentEvidence.cover.sha, coverBytes: currentEvidence.cover.sizeBytes,
            };
            await client.query("INSERT INTO t293.manifests VALUES ($1,$2,$3,$4)", [actorId, work.slug, audit.generation, manifest]);
          } else if (action.command === "complete") {
            manifest = (await client.query<{ value: unknown }>("SELECT value FROM t293.manifests WHERE owner_id=$1 AND slug=$2 AND generation=$3",
              [actorId, work.slug, audit.generation])).rows[0]?.value;
            assert(manifest, "Original T253 manifest is missing");
          }

          const applied = await client.query<{ outcome: Entry["outcome"] }>(
            "SELECT t293.apply_t253($1,$2,$3,$4,$5,$6) AS outcome",
            [requestKey, action.command, work.slug, action.expectedVersion, action.generation, manifest]);
          // Dialect/policy drift may not leave either half committed.
          assert.deepEqual(applied.rows[0].outcome, request.outcome);
          let state = work;
          let recorded = audit;
          if (action.command === "complete") {
            const publicClock = await client.query<{ approved_ms: string }>("SELECT t293.approved_ms($1,$2) AS approved_ms", [work.slug, audit.generation]);
            const approvedMs = Number(publicClock.rows[0].approved_ms);
            assert(work.active && Number.isSafeInteger(approvedMs) && approvedMs > 0);
            if (work.active.rightsUntilMs !== null) assert(approvedMs < work.active.rightsUntilMs, "SQL approval exceeded the rights window");
            state = { ...work, active: { ...work.active, approvedMs } };
            recorded = { ...audit, atMs: approvedMs };
          }
          const updated = await client.query("UPDATE t293.works SET state=$3 WHERE owner_id=$1 AND slug=$2 AND state->>'revision'=$4",
            [actorId, work.slug, state, lockedVersion]);
          assert.equal(updated.rowCount, 1);
          await recordRequest(request, action.command === "revoke" ? null : audit.generation);
          await client.query("INSERT INTO t293.audit VALUES ($1,$2,$3)", [actorId, requestKey, recorded]);
          await hooks.afterWrites?.();
        },
      });
      await client.query("COMMIT");
      committed = true;
      hooks.afterCommit?.();
      return result;
    } catch (error) {
      if (!committed) await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } };
  return createAdminPublicationService(store, resolveAuth).apply(action).then(outcome =>
    authorizationChanged ? { status: "denied" as const } : outcome);
}
