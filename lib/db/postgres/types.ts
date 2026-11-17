import "server-only";
import type { QueryResult, QueryResultRow } from "pg";

const actorBrand: unique symbol = Symbol("verified-postgres-actor");
export type VerifiedActor = Readonly<{ id: string; [actorBrand]: true }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// This constructor validates shape, not authentication. Only trusted server Auth
// code may call it with getUser().user.id; never pass request-owned identity here.
export function actorFromVerifiedUserId(id: string): VerifiedActor {
  if (typeof id !== "string" || !uuid.test(id)) throw new PostgresAccessError("ACTOR_REQUIRED");
  return Object.freeze({ id: id.toLowerCase(), [actorBrand]: true as const });
}
export function isVerifiedActor(actor: unknown): actor is VerifiedActor {
  return typeof actor === "object" && actor !== null && actorBrand in actor &&
    actor[actorBrand] === true && "id" in actor && typeof actor.id === "string" && uuid.test(actor.id);
}

export class PostgresAccessError extends Error {
  constructor(public readonly code: "ACTOR_REQUIRED" | "PG_CONFIG" | "PG_UNAVAILABLE" | "PG_TRANSACTION" | "TX_CLOSED" | "TX_NESTED" | "PG_DATA") {
    // No driver message, query, parameter, connection string or cause escapes.
    super(code);
    this.name = "PostgresAccessError";
  }
}

export interface ActorTransaction {
  readonly actorId: string;
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}
