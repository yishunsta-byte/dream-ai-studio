import "server-only";

import { z } from "zod";
import type { StudioRegisteredAnalysisPageProps } from "@/components/reference-analysis/studio-registered-analysis-page";
import { getRenderAuth } from "../auth/render";
import type { ServerAuthResult } from "../auth/resolve";
import { actorFromVerifiedUserId, type VerifiedActor } from "../db/postgres/types";

const id = z.guid().transform((value) => value.toLowerCase());
const registeredMaterials = z.array(z.object({
  ownerId: id,
  projectId: id,
  assetId: id,
  label: z.string().trim().min(1),
  registration: z.literal("current"),
  analysisAllowed: z.literal(true),
}));

type Dependencies = Readonly<{
  resolveAuth?: typeof getRenderAuth;
  connection?: Readonly<{
    /** True only when the deployed POST uses this same authority for the current registration check. */
    analysisApiConnected: boolean;
    /** Request-scoped proof of current ownership, active registration and eligibility for analysis. */
    listAnalyzableMaterials: (actor: VerifiedActor) => Promise<unknown>;
  }>;
}>;

type PageState = Extract<ServerAuthResult, { kind: "denied" | "local" }> | StudioRegisteredAnalysisPageProps;

export async function loadStudioRegisteredAnalysisPage({ resolveAuth = getRenderAuth, connection }: Dependencies = {}): Promise<PageState> {
  let auth: ServerAuthResult;
  try {
    auth = await resolveAuth();
  } catch {
    return { kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" };
  }
  if (auth.kind !== "verified") return auth;
  if (!connection?.analysisApiConnected) return { kind: "disconnected" };

  try {
    const actor = actorFromVerifiedUserId(auth.userId);
    const list = registeredMaterials.safeParse(await connection.listAnalyzableMaterials(actor));
    if (!list.success || list.data.some(({ ownerId }) => ownerId !== actor.id)) return { kind: "unavailable" };
    const materials = list.data.map(({ label, projectId, assetId }) => ({ label, projectId, assetId }));
    const keys = new Set(materials.map(({ projectId, assetId }) => `${projectId}/${assetId}`));
    if (keys.size !== materials.length) return { kind: "unavailable" };
    return { kind: "connected", materials };
  } catch {
    return { kind: "unavailable" };
  }
}
