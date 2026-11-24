import "server-only";
import { addAbortListener } from "node:events";
import { z } from "zod";
import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth, type ServerAuthResult } from "../auth/resolve";
import { actorFromVerifiedUserId, type VerifiedActor } from "../db/postgres/types";

const headers = { "cache-control": "private, no-store" };
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const id = z.guid().transform(value => value.toLowerCase());
const snapshots = z.array(z.strictObject({
  ownerId: id, projectId: id, assetId: id, label: z.string().trim().min(1),
  registration: z.literal("current"), analysisAllowed: z.literal(true), revision: z.hash("sha256", { enc: "hex" }),
}));
type Options = Readonly<{
  resolveAuth?: typeof resolveServerAuth;
  readMaterialSnapshots?: (actor: VerifiedActor, signal: AbortSignal) => Promise<unknown>;
}>;

function denied(auth: Extract<ServerAuthResult, { kind: "denied" }>) {
  const response = authDeniedResponse(auth);
  response.headers.set("cache-control", headers["cache-control"]);
  return response;
}
const required = () => denied({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
const unavailable = () => Response.json({ code: "STUDIO_MATERIALS_UNAVAILABLE" }, { status: 503, headers });

async function whileActive<T>(signal: AbortSignal, run: () => Promise<T>) {
  signal.throwIfAborted();
  const stopped = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => stopped.reject(signal.reason));
  try {
    const result = await Promise.race([stopped.promise, run()]);
    signal.throwIfAborted();
    return result;
  } finally { listener[Symbol.dispose](); }
}

/** Loopback test boundary. Do not mount this handler on a public route. */
export function createIsolatedStudioMaterialsGet({ resolveAuth = resolveServerAuth, readMaterialSnapshots }: Options = {}) {
  return async function getMaterials(request: Request) {
    if (request.method !== "GET") {
      return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { ...headers, allow: "GET" } });
    }
    const url = new URL(request.url);
    if (!loopback.has(url.hostname)) return unavailable();
    const incoming = request.headers;
    if (incoming.has("rsc") || incoming.has("next-router-prefetch") || incoming.has("next-router-segment-prefetch") ||
        /\bprefetch\b/i.test([incoming.get("purpose"), incoming.get("sec-purpose")].join(" "))) {
      return new Response(null, { status: 204, headers });
    }
    const site = incoming.get("sec-fetch-site");
    const origin = incoming.get("origin");
    if ((site && site !== "same-origin") || (origin && origin !== url.origin)) {
      return Response.json({ code: "AUTH_ORIGIN_REJECTED" }, { status: 403, headers });
    }

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3000)]);
    try {
      const auth = await whileActive(signal, resolveAuth);
      if (auth.kind === "denied") return denied(auth);
      if (auth.kind !== "verified" || !auth.email) return required();
      if (!readMaterialSnapshots) return unavailable();
      const actor = actorFromVerifiedUserId(auth.userId);
      const readSnapshots = readMaterialSnapshots;

      async function readCurrent() {
        const rows = snapshots.parse(await whileActive(signal, () => readSnapshots(actor, signal)));
        const unique = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          if (row.ownerId !== actor.id) continue;
          const key = `${row.projectId}/${row.assetId}`;
          if (unique.has(key)) throw new Error("STUDIO_MATERIAL_DUPLICATE");
          unique.set(key, row);
        }
        return unique;
      }

      const initial = await readCurrent();
      const currentAuth = await whileActive(signal, resolveAuth);
      if (currentAuth.kind === "denied") return denied(currentAuth);
      if (currentAuth.kind !== "verified" || !currentAuth.email || actorFromVerifiedUserId(currentAuth.userId).id !== actor.id) {
        return required();
      }
      const current = await readCurrent();
      const materials = [];
      for (const [key, { revision, projectId, assetId, label }] of current) {
        if (initial.get(key)?.revision === revision) materials.push({ projectId, assetId, label });
      }
      return Response.json({ materials }, { headers });
    } catch { return unavailable(); }
  };
}
