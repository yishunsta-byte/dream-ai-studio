import "server-only";
import { addAbortListener } from "node:events";
import { z } from "zod";
import { authDeniedResponse } from "../auth/api";
import { rejectCrossSite } from "../auth/config";
import { resolveServerAuth } from "../auth/resolve";
import { actorFromVerifiedUserId, type VerifiedActor } from "../db/postgres/types";
import { analyzeStudioReference } from "./studio-analysis-contract";
import { studioAnalysisResultSchema } from "./studio-analysis-result-dto";

const maxBodyBytes = 1_024;
const deadlineMs = 3_000;
const id = z.guid().transform((value) => value.toLowerCase());
const selectionSchema = z.strictObject({ projectId: id, assetId: id });
type Selection = Readonly<z.infer<typeof selectionSchema>>;
type Options = {
  /** Requires a current, verified registration for the specified actor and selection on every call. */
  resolveRegisteredSource?: (actor: VerifiedActor, selection: Selection, signal: AbortSignal) => Promise<unknown>;
  /** Owns the whole verified-file operation and must bind all authority checks to this actor. */
  analyzeRegisteredSource?: (actor: VerifiedActor, selection: Selection, signal: AbortSignal) => ReturnType<typeof analyzeStudioReference>;
  resolveAuth?: typeof resolveServerAuth;
};

const noStore = { "cache-control": "no-store" };
const unavailable = (reason: "invalid_selection" | "analysis_unavailable" | "cancelled" | "timed_out", status = 200) =>
  Response.json({ schemaVersion: 1, status: "unavailable", reason }, { status, headers: noStore });

async function withinRequest<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const stopped = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => stopped.reject(signal.reason));
  try {
    const result = await Promise.race([stopped.promise, Promise.resolve().then(() => { signal.throwIfAborted(); return run(); })]);
    signal.throwIfAborted();
    return result;
  } finally {
    listener[Symbol.dispose]();
  }
}

class BodyTooLarge extends Error {}

async function readSelection(request: Request, signal: AbortSignal) {
  const sizeHint = request.headers.get("content-length");
  if (sizeHint !== null && !/^\d+$/.test(sizeHint)) throw new TypeError("Invalid body length");
  if (sizeHint !== null && Number(sizeHint) > maxBodyBytes) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("Missing JSON body");
  try {
    const text = await withinRequest(signal, async () => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0;
      let text = "";
      while (true) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) return text + decoder.decode();
        size += value.byteLength;
        if (size > maxBodyBytes) throw new BodyTooLarge();
        text += decoder.decode(value, { stream: true });
      }
    });
    return selectionSchema.safeParse(JSON.parse(text));
  } finally {
    // A stalled producer must not delay the HTTP response while it cancels.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createStudioAnalysisPost({ resolveRegisteredSource, analyzeRegisteredSource, resolveAuth = resolveServerAuth }: Options = {}) {
  const analyze = typeof analyzeRegisteredSource === "function" && resolveRegisteredSource === undefined ? analyzeRegisteredSource : undefined;
  const resolve = typeof resolveRegisteredSource === "function" && analyzeRegisteredSource === undefined ? resolveRegisteredSource : undefined;
  return async function POST(request: Request) {
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = AbortSignal.any([request.signal, deadline]);
    const interruption = () => request.signal.aborted ? unavailable("cancelled") : deadline.aborted ? unavailable("timed_out") : undefined;

    let auth: Awaited<ReturnType<typeof resolveAuth>>;
    try {
      auth = await withinRequest(signal, resolveAuth);
    } catch {
      return interruption() ?? authDeniedResponse({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" });
    }
    if (auth.kind === "denied") return authDeniedResponse(auth);
    if (auth.kind !== "verified") return authDeniedResponse({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });

    const blocked = rejectCrossSite(request, { json: true });
    if (blocked) return blocked;
    const origin = new URL(request.headers.get("origin")!);
    if (origin.host !== request.headers.get("host")?.toLowerCase() || origin.protocol !== new URL(request.url).protocol) {
      return Response.json({ code: "AUTH_ORIGIN_REJECTED" }, { status: 403, headers: noStore });
    }

    let selection: Awaited<ReturnType<typeof readSelection>>;
    try {
      selection = await readSelection(request, signal);
    } catch (error) {
      return interruption() ?? unavailable("invalid_selection", error instanceof BodyTooLarge ? 413 : 400);
    }
    if (!selection.success) return unavailable("invalid_selection");
    try {
      let result: unknown;
      if (analyze) {
        const actor = actorFromVerifiedUserId(auth.userId);
        result = await withinRequest(signal, () => analyze(actor, selection.data, signal));
      } else if (resolve) {
        let initialAuth = true;
        result = await withinRequest(signal, () => analyzeStudioReference(selection.data, {
          signal,
          async resolveAuth() {
            signal.throwIfAborted();
            if (!initialAuth) return resolveAuth();
            initialAuth = false;
            return auth;
          },
          resolveRegisteredSource: (actor, chosen) => resolve(actor, chosen, signal),
        }));
      } else return unavailable("analysis_unavailable", 503);
      const dto = studioAnalysisResultSchema.safeParse(result);
      const stopped = interruption();
      if (stopped) return stopped;
      if (!dto.success) return unavailable("analysis_unavailable", 503);
      return Response.json(dto.data, { headers: noStore });
    } catch {
      return interruption() ?? unavailable("analysis_unavailable", 503);
    }
  };
}
