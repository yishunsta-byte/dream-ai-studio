import "server-only";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { mkdtemp, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import type { resolveServerAuth } from "../auth/resolve";
import { isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { inspectPcmWav } from "../services/postgres/pcm-wav";
import { analyzeStudioReference } from "./studio-analysis-contract";
import type { createStudioAnalysisPost } from "./studio-analysis-http";

const id = z.guid().transform(value => value.toLowerCase());
const selectionSchema = z.strictObject({ projectId: id, assetId: id });
const generation = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const permissionGeneration = z.string().regex(/^[1-9][0-9]{0,18}$/);
const registrationSchema = z.strictObject({
  status: z.literal("authorized"), ownerId: id, ...selectionSchema.shape, purpose: z.literal("rea-reference"),
  storeId: generation, restoreGeneration: generation, linkGeneration: generation,
  ownerPermissionGeneration: permissionGeneration, scopePermissionGeneration: permissionGeneration,
  registrationGeneration: generation, authorizedRegistrationGeneration: generation,
  mime: z.literal("audio/wav"), sizeBytes: z.number().int().min(46).max(1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.instanceof(Buffer),
});
type Selection = Readonly<z.infer<typeof selectionSchema>>;
type PostOptions = NonNullable<Parameters<typeof createStudioAnalysisPost>[0]>;

type Options = Readonly<{
  profile: "isolated-registered-pcm-wav";
  workRoot: string;
  resolveAuth: typeof resolveServerAuth;
  /** Atomically read the current approval, registration and bytes for this actor and source. */
  readRegistration: (actor: VerifiedActor, selection: Selection, signal: AbortSignal) => Promise<unknown>;
}>;

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const filename = "reference.wav";
const unavailable = (reason: "cancelled" | "source_unavailable") =>
  ({ schemaVersion: 1 as const, status: "unavailable" as const, reason });

async function whileActive<T>(signal: AbortSignal, run: () => Promise<T>) {
  signal.throwIfAborted();
  const stopped = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => stopped.reject(signal.reason));
  try {
    const result = await Promise.race([stopped.promise, Promise.resolve().then(() => {
      signal.throwIfAborted();
      return run();
    })]);
    signal.throwIfAborted();
    return result;
  } finally { listener[Symbol.dispose](); }
}

async function removeWork(work: string) {
  if (relative(work, await realpath(work)) !== "") throw new Error("Invalid PCM workspace");
  await rm(join(work, filename), { force: true });
  await rmdir(work);
}

/** An injected isolated reader only. There is no default provider, upload, or issuance path. */
export function createIsolatedRegisteredPcmWavAnalysis(options?: Options) {
  if (!options || options.profile !== "isolated-registered-pcm-wav" ||
      typeof options.resolveAuth !== "function" || typeof options.readRegistration !== "function") return;
  const { workRoot, resolveAuth, readRegistration } = options;
  if (typeof workRoot !== "string" || !isAbsolute(workRoot) || /^[\\/]{2}/.test(workRoot) ||
      /[\0\r\n]/.test(workRoot) || workRoot.split(/[\\/]/).some(part => part.toLowerCase() === "public")) return;

  return Object.freeze({ resolveAuth, async analyzeRegisteredSource(actor, input, signal) {
    const selected = selectionSchema.safeParse(input);
    if (!selected.success || !isVerifiedActor(actor)) return unavailable("source_unavailable");
    let work: string | undefined;
    let path: string | undefined;
    let currentProof: string | undefined;
    try {
      let result: Awaited<ReturnType<typeof analyzeStudioReference>>;
      try {
        result = await analyzeStudioReference(selected.data, {
          signal, resolveAuth: () => whileActive(signal, resolveAuth),
          async resolveRegisteredSource(viewer, selection) {
            if (viewer.id !== actor.id) return;
            const raw = await whileActive(signal, () => readRegistration(viewer, selection, signal));
            const checked = registrationSchema.safeParse(raw);
            if (!checked.success) return;
            const { bytes: inputBytes, registrationGeneration, authorizedRegistrationGeneration, purpose, ...source } = checked.data;
            if (registrationGeneration !== authorizedRegistrationGeneration || source.ownerId !== viewer.id ||
                source.projectId !== selection.projectId || source.assetId !== selection.assetId ||
                inputBytes.length !== source.sizeBytes) return;
            const bytes = Buffer.from(inputBytes);
            if (hash(bytes) !== source.sha256 || !inspectPcmWav(bytes)) return;
            const sourceGeneration = hash(JSON.stringify([purpose, registrationGeneration, source]));
            if (currentProof !== undefined && currentProof !== sourceGeneration) return;
            if (!path) {
              const canonical = await realpath(workRoot);
              if (relative(workRoot, canonical) !== "") return;
              signal.throwIfAborted();
              work = await mkdtemp(join(canonical, "dream-registered-pcm-"));
              path = join(work, filename);
              await writeFile(path, bytes, { signal, flag: "wx", mode: 0o600 });
              currentProof = sourceGeneration;
            }
            return { ...source, sourceGeneration, path, managedRoot: work, name: filename };
          },
        });
      } finally {
        if (work) await removeWork(work);
      }
      return signal.aborted ? unavailable("cancelled") : result;
    } catch { return unavailable(signal.aborted ? "cancelled" : "source_unavailable"); }
  } } satisfies PostOptions);
}
