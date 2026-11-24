import "server-only";

import type { Pool, QueryResultRow } from "pg";
import { isVerifiedActor, type ActorTransaction, type VerifiedActor } from "../../db/postgres/types";
import { menuSnapshotSchema } from "../../menus/snapshot";
import type { PrivateObjectReader } from "../../storage/supabase/reader";
import { postgresProjectCreateWithStorage } from "./project-create-storage";
import type { ProjectCreateHooks } from "./project-create";

const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = (message: string) => Object.assign(new Error("INVALID_INPUT"), {
  code: "INVALID_INPUT", status: 400, errors: { productAssets: message },
});

// The actor and registrar are authenticated server identities, and the menu
// snapshot comes from the server's menu configuration. No HTTP path uses this
// fixture. The existing creation adapter owns the physical transaction.
export function createOwnedPrivateImageProject(
  pool: Pick<Pool, "connect">,
  reader: PrivateObjectReader,
  registrar: VerifiedActor,
  serverSnapshot: unknown,
) {
  if (!isVerifiedActor(registrar)) throw new Error("PROJECT_CREATE_UNAVAILABLE");
  const snapshot = menuSnapshotSchema.parse(serverSnapshot);
  if (snapshot.menu.id !== "shopping-shorts") throw new Error("PROJECT_CREATE_UNAVAILABLE");
  const assetFields = [...snapshot.commonInputs, ...snapshot.menu.inputs].filter(field => field.type === "assets");

  async function candidateQuery<Row extends QueryResultRow>(tx: ActorTransaction, sql: string, args: unknown[]) {
    await tx.query("SET LOCAL ROLE t368_create_runtime");
    const result = await tx.query<Row>(sql, args);
    await tx.query("SET LOCAL ROLE dream_api");
    return result.rows[0];
  }
  async function identity(tx: ActorTransaction) {
    const { rows } = await tx.query<{ allowed: boolean }>(`SELECT
      current_database()='dream_test_t367' AND inet_server_addr()='127.0.0.1'::inet
      AND current_setting('server_version_num')::int/10000=17
      AND current_user='dream_api' AND pg_has_role(session_user,'t368_create_runtime','SET')
      AND NOT p.rolsuper AND NOT p.rolbypassrls AND NOT p.rolcreaterole AND NOT p.rolcreatedb
      AND NOT pg_has_role(session_user,'t368_create_guard','MEMBER')
      AND NOT pg_has_role(session_user,'dream_worker','MEMBER') AS allowed
      FROM pg_roles p WHERE p.rolname=session_user`);
    if (!rows[0]?.allowed) throw new Error("PROJECT_CREATE_UNAVAILABLE");
  }

  return Object.freeze({
    async create(actor: VerifiedActor, requestId: string, inputs: unknown, signal?: AbortSignal) {
      if (!isVerifiedActor(actor) || actor.id === registrar.id || typeof requestId !== "string" || !uuid7.test(requestId)) {
        throw invalid("생성 요청과 파일을 확인해 주세요.");
      }
      const hooks: ProjectCreateHooks = {
        async before(tx, input) {
          await identity(tx);
          const normalized = JSON.parse(input.inputsJson);
          const images = normalized.productAssets;
          if (!Array.isArray(images) || images.length !== 1 || typeof images[0] !== "string" || !uuid7.test(images[0]) ||
              assetFields.some(field => field.id !== "productAssets" && normalized[field.id]?.length)) {
            return { kind: "asset-not-verified" };
          }
          const asset = images[0];
          const client = JSON.stringify({ candidate: "t368", menuId: input.menuId, assetId: asset, inputs: normalized });
          const row = await candidateQuery<{ reply: { status: string; projectId?: string } }>(tx,
            "SELECT private_image_create_v1.begin_create($1,$2,$3,$4) AS reply",
            [requestId, asset, client, input.snapshotJson]);
          const result = row?.reply;
          if (result?.status === "new") return { kind: "create" };
          if (result?.status === "conflict") return { kind: "conflict" };
          if (result?.status === "not_verified") return { kind: "asset-not-verified" };
          if (result?.status === "replayed" && typeof result.projectId === "string" && uuid7.test(result.projectId)) {
            return { kind: "replay", projectId: result.projectId };
          }
          throw new Error("PROJECT_CREATE_UNAVAILABLE");
        },
        async after(tx, projectId) {
          await candidateQuery(tx, "SELECT private_image_create_v1.finish_create($1,$2,$3)", [requestId, projectId, registrar.id]);
        },
      };
      return postgresProjectCreateWithStorage(pool, reader, { ioTimeoutMs: 8_000, hooks })
        .create(actor, snapshot.menu.id, inputs, snapshot, signal);
    },
  });
}
