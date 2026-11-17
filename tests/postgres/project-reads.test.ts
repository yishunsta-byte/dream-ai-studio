import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withActorTransaction, type ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, type ActorTransaction } from "@/lib/db/postgres/types";
import { postgresProjectReads } from "@/lib/services/postgres/project-reads";
import { isProjectReadError, projectReadError, projectReadFailure } from "@/lib/services/postgres/project-read-errors";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { stageOrder } from "@/lib/domain/stages";
import { A, B, PA, PB, syntheticPostgresFixture } from "./fixture";
vi.mock("server-only", () => ({}));

describe.skipIf(process.env.DREAM_PG_INTEGRATION !== "1")("B4-S actual PostgreSQL read service", () => {
  let fixture: Awaited<ReturnType<typeof syntheticPostgresFixture>>;
  let rawSnapshot: string;
  const rawInputs = ' { "title": "합성 자료", "kept": true } ';
  const actorA = actorFromVerifiedUserId(A), actorB = actorFromVerifiedUserId(B);
  const options = { mode: "read-only-repeatable-read", preserveDomainError: isProjectReadError } as const;
  beforeAll(async () => {
    fixture = await syntheticPostgresFixture();
    const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
    if (!parsed.ok) throw new Error("Synthetic menu configuration invalid");
    const config = parsed.config;
    const menu = config.menus[0];
    rawSnapshot = ` ${JSON.stringify(snapshotForMenu(config, menu))} `;
    for (const [actor, id] of [[actorA, PA], [actorB, PB]] as const) {
      await withActorTransaction(fixture.pool, actor, async tx => {
        await tx.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Original','synthetic','synthetic','9:16',30,'2026-11-17T00:00:00Z','2026-11-17T00:00:00Z')", [actor.id, id, menu.id, config.templateVersion, rawSnapshot, rawInputs]);
        for (const [index, stage] of stageOrder.entries()) await tx.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)", [actor.id, id, stage, index === 0 ? "approved" : index === 1 ? "todo" : "locked"]);
      });
    }
  });
  afterAll(async () => { await fixture?.close(); });
  it("preserves the existing list/get DTO, raw text, number/ISO and owner scope", async () => {
    const service = postgresProjectReads(fixture.pool);
    const list = await service.list(actorA);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: PA, title: "Original", lengthSec: 30, nextStage: "brief", status: "queued", updatedAt: "2026-11-17T00:00:00.000Z" });
    const detail = await service.get(actorA, PA);
    expect(detail.project.templateSnapshotJson).toBe(rawSnapshot);
    expect(detail.project.inputsJson).toBe(rawInputs);
    expect(detail.inputs).toEqual({ title: "합성 자료", kept: true });
    expect(detail.states).toHaveLength(7);
    expect(JSON.stringify(list)).not.toContain("ownerId");
    expect((await service.list(actorB)).map(row => row.id)).toEqual([PB]);
  });
  it("missing and cross-owner IDs have the same public 404 domain error", async () => {
    for (const id of [PB, "00000000-0000-4000-8000-999999999999"]) {
      await expect(postgresProjectReads(fixture.pool).get(actorA, id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
  });
  it("archived projects are absent from get/list", async () => {
    await fixture.admin.query("UPDATE dream.projects SET archived_at=now() WHERE id=$1", [PA]);
    try {
      await expect(postgresProjectReads(fixture.pool).get(actorA, PA)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await postgresProjectReads(fixture.pool).list(actorA)).toEqual([]);
    } finally { await fixture.admin.query("UPDATE dream.projects SET archived_at=NULL WHERE id=$1", [PA]); }
  });
  it("issued callback domain errors survive a healthy rollback; unknown errors do not", async () => {
    const error = projectReadError("NOT_FOUND");
    await expect(withActorTransaction(fixture.one, actorA, () => { throw error; }, options)).rejects.toBe(error);
    await expect(withActorTransaction(fixture.one, actorA, () => { throw { status: 404, message: "private SQL", code: "NOT_FOUND" }; }, options)).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    await withActorTransaction(fixture.one, actorB, async tx => expect((await tx.query("SELECT dream.actor_id() AS id")).rows[0].id).toBe(B), options);
  });
  it("read-only repeatable mode is fixed and prevents writes", async () => {
    await withActorTransaction(fixture.pool, actorA, async tx => {
      const { rows } = await tx.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly");
      expect(rows[0]).toEqual({ isolation: "repeatable read", readonly: "on" });
    }, options);
    await expect(withActorTransaction(fixture.pool, actorA, tx => tx.query("UPDATE dream.projects SET title='forbidden' WHERE id=$1", [PA]), options)).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    const connect = vi.spyOn(fixture.pool, "connect");
    await expect(withActorTransaction(fixture.pool, actorA, () => null, { mode: "READ COMMITTED; DROP SCHEMA dream" } as unknown as ActorTransactionOptions)).rejects.toMatchObject({ code: "PG_CONFIG" });
    expect(connect).not.toHaveBeenCalled(); connect.mockRestore();
  });
  it("service list uses one read snapshot while another connection changes project/stages", async () => {
    let interleaved = false;
    const pool = {
      async connect() {
        const client = await fixture.pool.connect();
        return new Proxy(client, {
          get(target, key) {
            if (key === "query") return async (sql: string, values?: unknown[]) => {
              const result = await target.query(sql, values);
              if (!interleaved && sql.startsWith("SELECT id,menu_id")) {
                interleaved = true;
                await fixture.admin.query("WITH changed AS (UPDATE dream.projects SET title='New snapshot',content_revision=2 WHERE id=$1 RETURNING id) UPDATE dream.stage_states SET status='failed' WHERE project_id IN (SELECT id FROM changed)", [PA]);
              }
              return result;
            };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as PoolClient;
      },
    } as Pick<Pool, "connect">;
    try {
      const rows = await postgresProjectReads(pool).list(actorA);
      expect(interleaved).toBe(true);
      expect(rows[0]).toMatchObject({ title: "Original", status: "queued", nextStage: "brief" });
      expect(rows[0].states.every(state => state.status !== "failed")).toBe(true);
      const next = await postgresProjectReads(fixture.pool).list(actorA);
      expect(next[0]).toMatchObject({ title: "New snapshot", status: "warning", nextStage: "intake" });
    } finally {
      // content_revision cannot decrease; preserve its monotonicity while resetting display data.
      await fixture.admin.query("UPDATE dream.projects SET title='Original' WHERE id=$1", [PA]);
      for (const [index, stage] of stageOrder.entries()) await fixture.admin.query("UPDATE dream.stage_states SET status=$1 WHERE project_id=$2 AND stage=$3", [index === 0 ? "approved" : index === 1 ? "todo" : "locked", PA, stage]);
    }
  });
  it("missing stages and invalid snapshot/inputs fail safely instead of becoming empty data", async () => {
    await fixture.admin.query("UPDATE dream.projects SET template_snapshot_json='{}' WHERE id=$1", [PA]);
    try { await expect(postgresProjectReads(fixture.pool).list(actorA)).rejects.toMatchObject({ code: "PROJECT_READ_UNAVAILABLE", status: 503 }); }
    finally { await fixture.admin.query("UPDATE dream.projects SET template_snapshot_json=$2 WHERE id=$1", [PA, rawSnapshot]); }
    await fixture.admin.query("UPDATE dream.projects SET inputs_json='[]' WHERE id=$1", [PA]);
    try { await expect(postgresProjectReads(fixture.pool).get(actorA, PA)).rejects.toMatchObject({ code: "PROJECT_READ_UNAVAILABLE" }); }
    finally { await fixture.admin.query("UPDATE dream.projects SET inputs_json=$2 WHERE id=$1", [PA, rawInputs]); }
    await fixture.admin.query("DELETE FROM dream.stage_states WHERE project_id=$1 AND stage='export'", [PA]);
    try { await expect(postgresProjectReads(fixture.pool).get(actorA, PA)).rejects.toMatchObject({ code: "PROJECT_READ_UNAVAILABLE" }); }
    finally { await fixture.admin.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,'export','locked')", [A, PA]); }
  });
  it("query failure wins over a callback's claimed domain failure", async () => {
    let failure: unknown;
    try {
      await withActorTransaction(fixture.one, actorA, async tx => {
        try { await tx.query("SELECT * FROM dream.synthetic_missing"); } catch { throw projectReadError("NOT_FOUND"); }
      }, options);
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "PG_TRANSACTION" });
    expect(projectReadFailure(failure)).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" } });
  });
  it("read tx cannot be used after callback completion", async () => {
    let escaped!: ActorTransaction;
    await withActorTransaction(fixture.one, actorA, tx => { escaped = tx; }, options);
    await expect(escaped.query("SELECT * FROM dream.projects")).rejects.toMatchObject({ code: "TX_CLOSED" });
  });
});
