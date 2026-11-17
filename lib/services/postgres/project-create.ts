import "server-only";
import type { Pool } from "pg";
import { v7 } from "uuid";
import { isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { encodeJson, jsonObject } from "@/lib/db/json";
import { stageOrder } from "@/lib/domain/stages";
import { validateProjectInputs, type ProjectInputErrors } from "@/lib/menus/inputs";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { postgresProjectCreateRepository, type ProjectCreateAsset } from "@/lib/repo/postgres/project-create";

type Code = "AUTH_REQUIRED" | "INVALID_INPUT" | "STAGE_LOCKED" | "PROJECT_CREATE_UNAVAILABLE";
export type ProjectCreateError = Error & Readonly<{ code: Code; status: number; errors?: Readonly<ProjectInputErrors> }>;
const issued = new WeakSet<object>();
function failure(code: Code, errors?: ProjectInputErrors): ProjectCreateError {
  const error = Object.assign(new Error(code), { code, status: code === "AUTH_REQUIRED" ? 401 : code === "INVALID_INPUT" ? 400 : code === "STAGE_LOCKED" ? 409 : 503,
    ...(errors ? { errors: Object.freeze({ ...errors }) } : {}) });
  issued.add(error); return Object.freeze(error);
}
export function isProjectCreateError(error: unknown): error is ProjectCreateError {
  return typeof error === "object" && error !== null && issued.has(error);
}

// Unwired server service. Snapshot comes from validated server menu config, not
// HTTP. Storage existence is an explicit trusted server policy: no legacy fs,
// SQLite, storage provider or Auth resolver is imported on this path.
export function postgresProjectCreate(pool: Pick<Pool, "connect">, dependencies: Readonly<{
  assetAvailable: (asset: ProjectCreateAsset, actor: VerifiedActor) => Promise<boolean> | boolean;
}>) {
  return {
    async create(actor: VerifiedActor, menuId: string, input: unknown, serverSnapshot: unknown): Promise<string> {
      if (!isVerifiedActor(actor)) throw failure("AUTH_REQUIRED");
      const parsed = menuSnapshotSchema.safeParse(serverSnapshot);
      if (!parsed.success || typeof dependencies?.assetAvailable !== "function") throw failure("PROJECT_CREATE_UNAVAILABLE");
      const snapshot = parsed.data;
      if (snapshot.menu.id !== menuId || snapshot.menu.availability !== "active") throw failure("STAGE_LOCKED");
      const validated = validateProjectInputs(snapshot, input);
      if (!validated.ok) throw failure("INVALID_INPUT", validated.errors);
      // Serialize once before any await. Text columns retain these exact bytes;
      // caller mutation cannot change the saved snapshot/normalized inputs.
      const values = validated.values;
      const snapshotJson = encodeJson(menuSnapshotSchema, snapshot), inputsJson = encodeJson(jsonObject, values);
      try {
        return await withActorTransaction(pool, actor, async tx => {
          const repo = postgresProjectCreateRepository(tx);
          const assets: { id: string; purpose: string }[] = [], characters: string[] = [];
          for (const field of [...snapshot.commonInputs, ...snapshot.menu.inputs]) {
            const ids = values[field.id]; if (!Array.isArray(ids)) continue;
            for (const id of ids as string[]) {
              if (field.type === "assets") {
                const asset = await repo.asset(id);
                if (!asset || (field.accept && !field.accept.includes(asset.kind as "image" | "video" | "audio" | "doc")) ||
                  (asset.kind !== "link" && (!asset.objectKey || (await dependencies.assetAvailable(asset, actor)) !== true))) {
                  throw failure("INVALID_INPUT", { [field.id]: "이 자료를 사용할 수 없어요. 보관함에서 자료의 상태와 형식을 확인해 주세요." });
                }
                assets.push({ id, purpose: field.id });
              } else if (field.type === "characters") {
                if (!await repo.character(id)) throw failure("INVALID_INPUT", { [field.id]: "캐릭터를 다시 선택해 주세요." });
                characters.push(id);
              }
            }
          }
          const id = v7(), now = new Date().toISOString();
          await repo.insert({ id, menuId, templateVersion: snapshot.templateVersion, templateSnapshotJson: snapshotJson, inputsJson,
            title: values.title as string, goal: values.goal as string, target: values.target as string, aspect: values.aspect as string, lengthSec: values.lengthSec as number, now });
          for (const [index, stage] of stageOrder.entries()) await repo.stage(id, stage, index === 0 ? "approved" : index === 1 ? "todo" : "locked", index === 0 ? now : null);
          for (const link of assets) await repo.linkAsset(id, link.id, link.purpose);
          for (const character of characters) await repo.linkCharacter(id, character);
          await repo.log(v7(), id, encodeJson(jsonObject, { menuId, templateVersion: snapshot.templateVersion, contentRevision: 1 }), now);
          return id;
        }, { preserveDomainError: isProjectCreateError });
      } catch (error) {
        if (isProjectCreateError(error)) throw error;
        throw failure("PROJECT_CREATE_UNAVAILABLE");
      }
    },
  };
}
