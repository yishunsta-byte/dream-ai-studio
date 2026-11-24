import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import { isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";
import { withActorTransaction, type ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { postgresProjectsRepository } from "@/lib/repo/postgres/projects";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { jsonObject } from "@/lib/db/json";
import { projectDisplayState, stageOrder, type StageState } from "@/lib/domain/stages";
import { isProjectReadError, projectReadError } from "./project-read-errors";

const projectId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const statuses = new Set(["locked", "todo", "in_progress", "needs_approval", "approved", "failed"]);
const jobStatuses = new Set(["queued", "running", "succeeded", "failed", "canceled"]);
type Repo = ReturnType<typeof postgresProjectsRepository>;
type States = Awaited<ReturnType<Repo["stages"]>>;

function checkedStates(states: States) {
  if (states.length !== stageOrder.length || stageOrder.some(stage => states.filter(row => row.stage === stage).length !== 1) ||
    states.some(row => !statuses.has(row.status))) throw projectReadError("PROJECT_READ_UNAVAILABLE");
  return states as (States[number] & StageState)[];
}
function checkedProject(project: NonNullable<Awaited<ReturnType<Repo["get"]>>>) {
  if (project.contentRevision < 1 || project.lengthSec < 1 || !["9:16", "16:9", "1:1"].includes(project.aspect)) throw projectReadError("PROJECT_READ_UNAVAILABLE");
  const snapshot = menuSnapshotSchema.parse(JSON.parse(project.templateSnapshotJson));
  if (snapshot.menu.id !== project.menuId || snapshot.templateVersion !== project.templateVersion) throw projectReadError("PROJECT_READ_UNAVAILABLE");
  return snapshot;
}

// Unwired backend service: the caller must already hold a verified actor and an
// explicitly provisioned pool. It never resolves Auth or opens SQLite itself.
export function postgresProjectReads(pool: Pick<Pool, "connect">, prepareSession?: ActorTransactionOptions["prepareSession"]) {
  async function read<T>(actor: VerifiedActor, operation: (repo: Repo) => Promise<T>): Promise<T> {
    if (!isVerifiedActor(actor)) throw projectReadError("AUTH_REQUIRED");
    try {
      return await withActorTransaction(pool, actor, tx => operation(postgresProjectsRepository(tx)), {
        mode: "read-only-repeatable-read", preserveDomainError: isProjectReadError, prepareSession,
      });
    } catch (error) {
      if (isProjectReadError(error)) throw error;
      throw projectReadError("PROJECT_READ_UNAVAILABLE");
    }
  }
  async function present<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (isProjectReadError(error)) throw error;
      throw projectReadError("PROJECT_READ_UNAVAILABLE");
    }
  }
  return {
    async list(actor: VerifiedActor) {
      return present(async () => {
        const rows = await read(actor, async repo => {
          const projects = await repo.list();
          const result = [];
          for (const project of projects) result.push({ project, states: await repo.stages(project.id), jobs: await repo.jobStates(project.id) });
          return result;
        });
        return rows.map(({ project, states: rawStates, jobs }) => {
          const snapshot = checkedProject(project);
          const states = checkedStates(rawStates);
          if (jobs.some(status => !jobStatuses.has(status))) throw projectReadError("PROJECT_READ_UNAVAILABLE");
          return { id: project.id, title: project.title, menuId: project.menuId, menuLabel: snapshot.menu.label,
            aspect: project.aspect, lengthSec: project.lengthSec, updatedAt: project.updatedAt,
            status: projectDisplayState(states, jobs), states,
            nextStage: stageOrder.find(stage => states.find(row => row.stage === stage)?.status !== "approved") ?? "export" };
        });
      });
    },
    async get(actor: VerifiedActor, id: string) {
      return present(async () => {
        if (!isVerifiedActor(actor)) throw projectReadError("AUTH_REQUIRED");
        if (!projectId.safeParse(id).success) throw projectReadError("INVALID_INPUT");
        const data = await read(actor, async repo => {
          const project = await repo.get(id);
          return project ? { project, states: await repo.stages(id) } : null;
        });
        // Expected domain errors are created outside the sanitized DB callback.
        if (!data) throw projectReadError("NOT_FOUND");
        return { project: data.project, snapshot: checkedProject(data.project),
          inputs: jsonObject.parse(JSON.parse(data.project.inputsJson)), states: checkedStates(data.states) };
      });
    },
  };
}
