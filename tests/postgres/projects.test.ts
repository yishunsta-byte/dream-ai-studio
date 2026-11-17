import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, type ActorTransaction, type VerifiedActor } from "@/lib/db/postgres/types";
import { postgresProjectsRepository } from "@/lib/repo/postgres/projects";
import { A, B, PA, PB, raw, syntheticPostgresFixture } from "./fixture";

vi.mock("server-only", () => ({}));
const enabled = process.env.DREAM_PG_INTEGRATION === "1";
describe.skipIf(!enabled)("B3 actual pg driver / isolated PostgreSQL (explicit opt-in)", () => {
  let fixture: Awaited<ReturnType<typeof syntheticPostgresFixture>>;
  const actorA = actorFromVerifiedUserId(A), actorB = actorFromVerifiedUserId(B);
  beforeAll(async () => {
    fixture = await syntheticPostgresFixture();
    for (const [actor, id] of [[actorA, PA], [actorB, PB]] as const) {
      await withActorTransaction(fixture.pool, actor, async tx => {
        await tx.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,'synthetic','1',$3,$3,'Synthetic','test','test','9:16',4,'2026-11-17T00:00:00Z','2026-11-17T00:00:00Z')", [actor.id, id, raw]);
        await tx.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_revision,approved_at) VALUES($1,$2,'intake','approved',1,'2026-11-17T00:00:00Z')", [actor.id, id]);
        await tx.query("INSERT INTO dream.jobs(owner_id,id,kind,input_snapshot_json,status,project_id,ref_type,ref_id,provider,idempotency_key,created_at,updated_at) VALUES($1,$2,'image','{}','queued',$3,'project',$3,'synthetic',$2::uuid::text,'2026-11-17T00:00:00Z','2026-11-17T00:00:00Z')", [actor.id, actor.id === A ? "00000000-0000-4000-8000-000000000030" : "00000000-0000-4000-8000-000000000040", id]);
      });
    }
  });
  afterAll(async () => { await fixture?.close(); });

  it("restricted LOGIN is not owner, superuser or BYPASSRLS; current role/actor are transaction local", async () => {
    await withActorTransaction(fixture.pool, actorA, async tx => {
      const { rows } = await tx.query("SELECT current_user AS role,session_user AS login,dream.actor_id() AS actor,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=session_user");
      expect(rows[0]).toMatchObject({ role: "dream_api", login: "dream_test_api_login", actor: A, rolsuper: false, rolbypassrls: false });
    });
  });
  it("async repository preserves owner isolation, DTO numbers/ISO and raw text", async () => {
    await withActorTransaction(fixture.pool, actorA, async tx => {
      const repo = postgresProjectsRepository(tx);
      const rows = await repo.list();
      expect(rows.map(row => row.id)).toEqual([PA]);
      expect(await repo.get(PB)).toBeUndefined();
      expect(await repo.get(PA)).toMatchObject({ lengthSec: 4, contentRevision: 1, templateSnapshotJson: raw, inputsJson: raw, updatedAt: "2026-11-17T00:00:00.000Z" });
      expect(await repo.stages(PB)).toEqual([]);
      expect(await repo.stages(PA)).toMatchObject([{ projectId: PA, stage: "intake", approvedRevision: 1, approvedAt: "2026-11-17T00:00:00.000Z" }]);
      expect(await repo.jobStates(PA)).toEqual(["queued"]);
      expect(await repo.jobStates(PB)).toEqual([]);
      // Direct query without the repository's owner predicate proves RLS itself.
      expect((await tx.query("SELECT id FROM dream.projects")).rows).toEqual([{ id: PA }]);
      expect((await tx.query("UPDATE dream.projects SET title='forged' WHERE id=$1 RETURNING id", [PB])).rows).toEqual([]);
    });
  });
  it("RLS rejects writes owned by another actor", async () => {
    await expect(withActorTransaction(fixture.pool, actorA, tx => tx.query("INSERT INTO dream.settings(owner_id,key,value_json) VALUES($1,'forged','{}')", [B]))).rejects.toMatchObject({ code: "PG_TRANSACTION" });
  });
  it("rejects absent/unbranded actor before acquiring a client", async () => {
    const connect = vi.spyOn(fixture.pool, "connect");
    await expect(withActorTransaction(fixture.pool, { id: A } as VerifiedActor, () => null)).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    expect(connect).not.toHaveBeenCalled(); connect.mockRestore();
  });
  it("one-client reuse clears actor and role after both COMMIT and ROLLBACK", async () => {
    const pid = await withActorTransaction(fixture.one, actorA, async tx => (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await expect(withActorTransaction(fixture.one, actorA, async tx => {
      await tx.query("UPDATE dream.projects SET title='must roll back' WHERE id=$1", [PA]);
      throw new Error("private callback contents");
    })).rejects.toMatchObject({ code: "PG_TRANSACTION", message: "PG_TRANSACTION" });
    const client = await fixture.one.connect();
    try {
      const { rows } = await client.query("SELECT pg_backend_pid() AS pid,current_user AS role,nullif(current_setting('dream.actor_id',true),'') AS actor");
      expect(rows[0]).toEqual({ pid, role: "dream_test_api_login", actor: null });
      await expect(client.query("SELECT * FROM dream.projects")).rejects.toMatchObject({ code: "42501" });
    } finally { client.release(); }
    await withActorTransaction(fixture.one, actorB, async tx => expect((await postgresProjectsRepository(tx).list()).map(row => row.id)).toEqual([PB]));
    await withActorTransaction(fixture.one, actorA, async tx => expect((await postgresProjectsRepository(tx).get(PA))?.title).toBe("Synthetic"));
  });
  it("actor unset within dream_api sees no rows and cannot write", async () => {
    const client = await fixture.one.connect();
    try {
      await client.query("BEGIN; SET LOCAL ROLE dream_api");
      expect((await client.query("SELECT id FROM dream.projects")).rows).toEqual([]);
      await expect(client.query("INSERT INTO dream.settings VALUES($1,'unset','{}')", [A])).rejects.toMatchObject({ code: "42501" });
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("simultaneous actors remain isolated on different pool connections", async () => {
    const results = await Promise.all([actorA, actorB].map(actor => withActorTransaction(fixture.pool, actor, async tx => {
      await tx.query("SELECT pg_sleep(0.04)");
      return { actor: (await tx.query("SELECT dream.actor_id() AS actor")).rows[0].actor, ids: (await postgresProjectsRepository(tx).list()).map(row => row.id) };
    })));
    expect(results).toEqual([{ actor: A, ids: [PA] }, { actor: B, ids: [PB] }]);
  });
  it("expired transaction cannot be used during a later actor's transaction", async () => {
    let escaped!: ActorTransaction;
    await withActorTransaction(fixture.one, actorA, tx => { escaped = tx; });
    await withActorTransaction(fixture.one, actorB, async tx => {
      await expect(escaped.query("UPDATE dream.projects SET title='escaped'")).rejects.toMatchObject({ code: "TX_CLOSED" });
      expect((await tx.query("SELECT dream.actor_id() AS actor")).rows[0].actor).toBe(B);
    });
  });
  it("nested transactions reject before a size-one pool can deadlock", async () => {
    await withActorTransaction(fixture.one, actorA, async () => {
      await expect(withActorTransaction(fixture.one, actorB, () => null)).rejects.toMatchObject({ code: "TX_NESTED" });
    });
  });
  it("unawaited SQL error poisons the transaction instead of returning success", async () => {
    await expect(withActorTransaction(fixture.one, actorA, tx => { void tx.query("SELECT * FROM dream.no_such_table"); })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
  });
  it("actual deferred-constraint COMMIT failure destroys the client", async () => {
    let failedPid: unknown;
    await expect(withActorTransaction(fixture.one, actorA, async tx => {
      failedPid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await tx.query("CREATE TEMP TABLE b3_commit_failure(id integer UNIQUE DEFERRABLE INITIALLY DEFERRED)");
      await tx.query("INSERT INTO b3_commit_failure VALUES(1),(1)");
    })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    await withActorTransaction(fixture.one, actorB, async tx => {
      expect((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid).not.toBe(failedPid);
      expect((await postgresProjectsRepository(tx).list()).map(row => row.id)).toEqual([PB]);
    });
  });
  it("actual terminated backend makes ROLLBACK fail and is discarded", async () => {
    let terminatedPid: unknown;
    await expect(withActorTransaction(fixture.one, actorA, async tx => {
      terminatedPid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await fixture.admin.query("SELECT pg_terminate_backend($1)", [terminatedPid]);
      await tx.query("SELECT 1");
    })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    await withActorTransaction(fixture.one, actorA, async tx => {
      expect((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid).not.toBe(terminatedPid);
    });
  });
  it("list keeps updatedAt ordering/archive filter and accepts maximum safe integers", async () => {
    let verified = false;
    await expect(withActorTransaction(fixture.one, actorA, async tx => {
      await tx.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at,archived_at) SELECT owner_id,$2,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,9007199254740991,created_at,'2026-11-18T00:00:00Z',NULL FROM dream.projects WHERE id=$1", [PA, "00000000-0000-4000-8000-000000000050"]);
      await tx.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at,archived_at) SELECT owner_id,$2,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at,updated_at FROM dream.projects WHERE id=$1", [PA, "00000000-0000-4000-8000-000000000060"]);
      const rows = await postgresProjectsRepository(tx).list();
      expect(rows.map(row => row.id)).toEqual(["00000000-0000-4000-8000-000000000050", PA]);
      expect(rows[0].lengthSec).toBe(Number.MAX_SAFE_INTEGER);
      expect(await postgresProjectsRepository(tx).get("00000000-0000-4000-8000-000000000060")).toBeUndefined();
      verified = true;
      throw new Error("rollback synthetic ordering data");
    })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    expect(verified).toBe(true);
  });
});
