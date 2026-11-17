import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { isVerifiedActor, PostgresAccessError, type ActorTransaction, type VerifiedActor } from "./types";

const scope = new AsyncLocalStorage<object>();

export async function withActorTransaction<T>(pool: Pick<Pool, "connect">, actor: VerifiedActor, operation: (tx: ActorTransaction) => Promise<T> | T): Promise<T> {
  if (!isVerifiedActor(actor)) throw new PostgresAccessError("ACTOR_REQUIRED");
  if (scope.getStore()) throw new PostgresAccessError("TX_NESTED");
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw new PostgresAccessError("PG_UNAVAILABLE"); }
  const token = {};
  let active = false, destroy = false, begun = false, committing = false;
  let queryFailed = false;
  const pending = new Set<Promise<unknown>>();
  const broken = () => { destroy = true; queryFailed = true; };
  client.on("error", broken);
  const tx: ActorTransaction = Object.freeze({
    actorId: actor.id,
    query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<Row>> {
      if (!active || scope.getStore() !== token) {
        const rejected = Promise.reject<QueryResult<Row>>(new PostgresAccessError("TX_CLOSED"));
        // Also handles a caller's deliberately unawaited escaped operation.
        void rejected.catch(() => {});
        return rejected;
      }
      const result = client.query<Row>(text, [...values]).catch(() => {
        queryFailed = true;
        throw new PostgresAccessError("PG_TRANSACTION");
      });
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    },
  });
  try {
    await client.query("BEGIN"); begun = true;
    await client.query("SET LOCAL ROLE dream_api");
    await client.query("SELECT set_config('dream.actor_id', $1, true)", [actor.id]);
    active = true;
    let value: T;
    try { value = await scope.run(token, () => operation(tx)); }
    finally { active = false; }
    // A callback cannot launch a write without awaiting it and have COMMIT race it.
    await Promise.allSettled([...pending]);
    if (queryFailed) throw new PostgresAccessError("PG_TRANSACTION");
    committing = true;
    const committed = await client.query("COMMIT");
    if (committed.command !== "COMMIT") throw new PostgresAccessError("PG_TRANSACTION");
    begun = false;
    return value;
  } catch (error) {
    active = false;
    await Promise.allSettled([...pending]);
    if (!begun || committing) destroy = true;
    if (begun) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    if (error instanceof PostgresAccessError) throw error;
    throw new PostgresAccessError("PG_TRANSACTION");
  } finally {
    active = false;
    client.release(destroy);
    client.removeListener("error", broken);
  }
}
