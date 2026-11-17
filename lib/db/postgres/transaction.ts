import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { isVerifiedActor, PostgresAccessError, type ActorTransaction, type VerifiedActor } from "./types";

const scope = new AsyncLocalStorage<object>();

export type ActorTransactionOptions = Readonly<{
  mode?: "read-only-repeatable-read";
  // Trusted server policy only. Used only for a callback's own error after a
  // successful rollback, with no failed query/connection or uncertain commit.
  preserveDomainError?: (error: unknown) => error is Error;
}>;

export async function withActorTransaction<T>(pool: Pick<Pool, "connect">, actor: VerifiedActor, operation: (tx: ActorTransaction) => Promise<T> | T, options: ActorTransactionOptions = {}): Promise<T> {
  if (!isVerifiedActor(actor)) throw new PostgresAccessError("ACTOR_REQUIRED");
  if (scope.getStore()) throw new PostgresAccessError("TX_NESTED");
  if ((options.mode !== undefined && options.mode !== "read-only-repeatable-read") ||
    (options.preserveDomainError !== undefined && typeof options.preserveDomainError !== "function")) throw new PostgresAccessError("PG_CONFIG");
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw new PostgresAccessError("PG_UNAVAILABLE"); }
  const token = {};
  let active = false, destroy = false, begun = false, committing = false;
  let queryFailed = false;
  let callbackThrew = false;
  let callbackError: unknown;
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
    await client.query(options.mode === "read-only-repeatable-read" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"); begun = true;
    await client.query("SET LOCAL ROLE dream_api");
    await client.query("SELECT set_config('dream.actor_id', $1, true)", [actor.id]);
    active = true;
    let value: T;
    try { value = await scope.run(token, () => operation(tx)); }
    catch (error) { callbackThrew = true; callbackError = error; throw error; }
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
    if (callbackThrew && error === callbackError && !queryFailed && !destroy && options.preserveDomainError) {
      let safe = false;
      try { safe = options.preserveDomainError(error); } catch { /* A broken classifier cannot expose a driver or callback error. */ }
      if (safe) throw error;
    }
    if (error instanceof PostgresAccessError) throw error;
    throw new PostgresAccessError("PG_TRANSACTION");
  } finally {
    active = false;
    client.release(destroy);
    client.removeListener("error", broken);
  }
}
