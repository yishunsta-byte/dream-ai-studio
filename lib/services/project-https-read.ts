import "server-only";

import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AUTH_MESSAGES } from "../auth/config";
import type { ServerAuthResult } from "../auth/resolve";
import { jsonObject } from "../db/json";
import { projectDisplayState, stageOrder } from "../domain/stages";
import { menuSnapshotSchema } from "../menus/snapshot";
import { projectReadError, projectReadFailure } from "./postgres/project-read-errors";

type Options = Readonly<{
  project: Readonly<{ ref: string; origin: string; profile: string; publicKey: string }>;
  resolveAccess: () => Promise<Readonly<{ auth: ServerAuthResult; accessToken?: string }>>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}>;
type Failure = { status: 400 | 401 | 403 | 404 | 503; body: { error: string; code: string }; headers: typeof headers };
type Reply<T> = { status: 200; body: T; headers: typeof headers } | Failure;
type Target = Options["project"];
type Access = { target: Target; accessToken: string } | { failure: Failure };

const headers = Object.freeze({ "cache-control": "no-store" as const });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compactJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const denied = (status: 401 | 403 | 503, code: string, error: string): Failure => ({ status, body: { error, code }, headers });
const authRequired = () => denied(401, "AUTH_REQUIRED", AUTH_MESSAGES.required);
const authUnavailable = () => denied(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
const readFailure = (error: unknown): Failure => ({ ...projectReadFailure(error), headers });
const noRead = () => projectReadError("PROJECT_READ_UNAVAILABLE");

const id = z.string().regex(uuid);
const timestamp = z.iso.datetime();
const stage = z.object({
  projectId: id, stage: z.enum(stageOrder), status: z.enum(["locked", "todo", "in_progress", "needs_approval", "approved", "failed"]),
  approvedPlanId: id.nullable(), approvedRevision: z.number().int().nonnegative().nullable(), approvedAt: timestamp.nullable(), note: z.string().nullable(),
}).strict();
const listed = z.object({
  id, title: z.string(), menuId: z.string(), menuLabel: z.string(), aspect: z.enum(["9:16", "16:9", "1:1"]),
  lengthSec: z.number().int().positive(), updatedAt: timestamp, states: z.array(stage),
  jobs: z.array(z.enum(["queued", "running", "succeeded", "failed", "canceled"])),
}).strict();
const detailed = z.object({
  id,
  project: z.object({
    id, menuId: z.string(), templateVersion: z.string(), templateSnapshotJson: z.string(), inputsJson: z.string(),
    title: z.string(), goal: z.string(), target: z.string(), aspect: z.enum(["9:16", "16:9", "1:1"]),
    lengthSec: z.number().int().positive(), approvedPlanId: id.nullable(), contentRevision: z.number().int().positive(),
    currentTimelineRevId: id.nullable(), archivedAt: z.null(), createdAt: timestamp, updatedAt: timestamp,
  }).strict(),
  snapshot: menuSnapshotSchema, inputs: jsonObject, states: z.array(stage),
}).strict();

function claims(token: string): Record<string, unknown> | undefined {
  if (token.length > 8192 || !compactJwt.test(token)) return;
  try {
    const value = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { return; }
}

function targetIsBound({ origin, ref, profile, publicKey }: Target) {
  if (!/^[a-z0-9]{20}$/.test(ref) || origin !== `https://${ref}.supabase.co` || !/^[a-z][a-z0-9_]{0,62}$/.test(profile) ||
      ["public", "auth", "dream", "storage", "graphql_public", "information_schema"].includes(profile) || profile.startsWith("pg_")) return false;
  if (/^sb_publishable_[a-zA-Z0-9_-]{16,256}$/.test(publicKey)) return true;
  const legacy = claims(publicKey);
  return legacy?.role === "anon" && legacy.ref === ref;
}

function tokenMatches(token: string, target: Target, subject: string) {
  // These unverified claims only reject tokens. The same token must pass the project's Auth API.
  const value = claims(token);
  return value?.sub === subject && value.iss === `${target.origin}/auth/v1` && value.role === "authenticated" &&
    (value.aud === "authenticated" || (Array.isArray(value.aud) && value.aud.includes("authenticated") &&
      value.aud.every(audience => typeof audience === "string"))) &&
    typeof value.exp === "number" && Number.isSafeInteger(value.exp) && value.exp > Math.floor(Date.now() / 1000);
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel();
    throw noRead();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      received += value.byteLength;
      if (received > limit) throw noRead();
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function checkedStages(states: z.infer<typeof stage>[], projectId: string) {
  if (states.length !== stageOrder.length || states.some(row => row.projectId !== projectId) ||
      new Set(states.map(row => row.stage)).size !== stageOrder.length) throw noRead();
  return states;
}

function requireCompleteRange(range: string | null, length: number) {
  const expected = length ? `0-${length - 1}/${length}` : "*/0";
  if (range !== expected) throw noRead();
}

function listDto(row: z.infer<typeof listed>) {
  const { jobs, states, ...card } = row;
  checkedStages(states, row.id);
  return { ...card, states, status: projectDisplayState(states, jobs),
    nextStage: stageOrder.find(name => states.find(state => state.stage === name)?.status !== "approved") ?? "export" };
}

function detailDto(row: z.infer<typeof detailed>, requested: string) {
  const { project, snapshot, inputs, states } = row;
  if (row.id !== requested || project.id !== row.id || snapshot.menu.id !== project.menuId ||
      snapshot.templateVersion !== project.templateVersion ||
      !isDeepStrictEqual(menuSnapshotSchema.parse(JSON.parse(project.templateSnapshotJson)), snapshot) ||
      !isDeepStrictEqual(jsonObject.parse(JSON.parse(project.inputsJson)), inputs)) throw noRead();
  return { project, snapshot, inputs, states: checkedStages(states, row.id) };
}

const listSelect = "id,title,menuId,menuLabel,aspect,lengthSec,updatedAt,states,jobs";
const detailSelect = "id,project,snapshot,inputs,states";

/** Create once per server request. The caller reads Auth and the token from the same request context. */
export function createProjectHttpsReadRequest(options: Options) {
  const target = { ...options.project };
  const { resolveAccess, signal, fetcher = globalThis.fetch } = options;
  let access: Promise<Access> | undefined;

  async function request(path: string, accessToken: string, data = false) {
    signal?.throwIfAborted();
    const url = new URL(path, target.origin);
    const deadline = AbortSignal.timeout(5000);
    const response = await fetcher(url, {
      method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { accept: "application/json", "cache-control": "no-store", apikey: target.publicKey, authorization: `Bearer ${accessToken}`,
        ...(data && { "accept-profile": target.profile, prefer: "count=exact" }) },
    });
    if (response.redirected || (response.url && response.url !== url.href)) {
      await response.body?.cancel();
      throw noRead();
    }
    return response;
  }

  async function authenticate(): Promise<Access> {
    try {
      signal?.throwIfAborted();
      const { auth, accessToken } = await resolveAccess();
      if (auth?.kind === "denied" && auth.status === 401 && auth.code === "AUTH_REQUIRED") return { failure: authRequired() };
      if (auth?.kind === "denied" && auth.status === 403 && auth.code === "AUTH_FORBIDDEN")
        return { failure: denied(403, auth.code, AUTH_MESSAGES.forbidden) };
      if (auth?.kind !== "verified" || !uuid.test(auth.userId) || !auth.email?.trim()) return { failure: authUnavailable() };
      if (!targetIsBound(target)) return { failure: readFailure(noRead()) };
      const subject = auth.userId.toLowerCase();
      if (!accessToken || !tokenMatches(accessToken, target, subject)) return { failure: authRequired() };
      const response = await request("/auth/v1/user", accessToken);
      if (response.status !== 200) {
        await response.body?.cancel();
        return { failure: response.status === 401 || response.status === 403 ? authRequired() : authUnavailable() };
      }
      const user = z.object({ id, email: z.string() }).parse(await boundedJson(response, 65_536));
      if (user.id.toLowerCase() !== subject || user.email.trim().toLowerCase() !== auth.email.trim().toLowerCase())
        return { failure: authRequired() };
      return { target, accessToken };
    } catch { return { failure: authUnavailable() }; }
  }

  async function rows(path: string, verified: Extract<Access, { accessToken: string }>) {
    const response = await request(path, verified.accessToken, true);
    if (response.status === 401) {
      const failure = await boundedJson(response, 8192);
      const code = z.object({ code: z.string() }).parse(failure).code;
      if (code === "PGRST301" || code === "PGRST303") throw projectReadError("AUTH_REQUIRED");
      throw noRead();
    }
    if (response.status !== 200 || response.headers.get("content-profile") !== verified.target.profile) {
      await response.body?.cancel();
      throw noRead();
    }
    return { data: await boundedJson(response, 4 * 1024 * 1024), range: response.headers.get("content-range") };
  }

  async function execute<T>(operation: (verified: Extract<Access, { accessToken: string }>) => Promise<T>): Promise<Reply<T>> {
    const verified = await (access ??= authenticate());
    if ("failure" in verified) return verified.failure;
    try {
      signal?.throwIfAborted();
      return { status: 200, body: await operation(verified), headers };
    } catch (error) { return readFailure(error); }
  }

  return Object.freeze({
    list: () => execute(async verified => {
      const query = new URLSearchParams({ select: listSelect, order: "updatedAt.desc,id.asc" });
      const { data, range } = await rows(`/rest/v1/project_list?${query}`, verified);
      const projects = z.array(listed).parse(data);
      requireCompleteRange(range, projects.length);
      if (new Set(projects.map(row => row.id)).size !== projects.length) throw noRead();
      return projects.map(listDto);
    }),
    get: (projectId: string | (() => Promise<string>)) => execute(async verified => {
      const requested = typeof projectId === "function" ? await projectId() : projectId;
      if (typeof requested !== "string" || !uuid.test(requested)) throw projectReadError("INVALID_INPUT");
      const normalized = requested.toLowerCase();
      const query = new URLSearchParams({ select: detailSelect, id: `eq.${normalized}` });
      const { data, range } = await rows(`/rest/v1/project_detail?${query}`, verified);
      const projects = z.array(detailed).max(1).parse(data);
      requireCompleteRange(range, projects.length);
      if (!projects.length) throw projectReadError("NOT_FOUND");
      return detailDto(projects[0], normalized);
    }),
  });
}
