import "server-only";

import { addAbortListener } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { Client, type ClientConfig } from "pg";
import { revalidateDelegatedPublication, verifyDelegatedPublication, type DelegatedPlan } from "../db/postgres/publication/delegated/probe";
import { PublicationDatabaseUnavailable } from "./publication-db-preflight";
import { createPublicationRuntime } from "./publication-runtime";
import type { PublicationRuntimeOptions } from "./publication-runtime-config";
import { createPublicationServerConfig } from "./publication-server-config";

type ServerOptions = NonNullable<Parameters<typeof createPublicationServerConfig>[0]>;
type Active = Extract<Awaited<ReturnType<ReturnType<typeof createPublicationRuntime>["get"]>>, { mode: "active" }>;
type Options = Readonly<{
  server: ServerOptions;
  plan: DelegatedPlan;
  work: Parameters<typeof verifyDelegatedPublication>[2];
  verifierConnectionString: string;
}>;

const runtimeGroups = { admin: "t293_app", list: "t295_list", cover: "t295_file" } as const;
const runtimeRoles = Object.keys(runtimeGroups) as (keyof typeof runtimeGroups)[];

function verifierConfig(options: Options) {
  const { server: { database, rightsReader }, plan, verifierConnectionString } = options;
  const { host, port, database: name, systemIdentifier } = database.target;
  const url = new URL(verifierConnectionString);
  if (name !== plan.target.database || port !== plan.target.port || systemIdentifier !== plan.target.cluster ||
      (database.approvedDatabaseOid !== undefined && database.approvedDatabaseOid !== plan.target.databaseOid) ||
      rightsReader.schema !== "t295" || rightsReader.name !== "rights_state" ||
      !["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== host || url.port !== String(port) ||
      url.pathname !== `/${name}` || url.search || url.hash || decodeURIComponent(url.username) !== plan.verifier.name || !url.password) return;

  // Use the same logins the plan pins to the approved runtime group OIDs.
  if (!runtimeRoles.every(role => {
    const login = plan.principals.find(principal => principal.name === database.logins[role].name && principal.login);
    const group = plan.principals.find(principal => principal.name === runtimeGroups[role] && !principal.login);
    return login && group && login.oid !== plan.installer.oid && login.oid !== plan.verifier.oid && plan.permanent.some(edge =>
      edge.member === login.oid && edge.parent === group.oid && edge.inherit && !edge.set && !edge.admin);
  })) return;

  return {
    connectionString: verifierConnectionString,
    ssl: { ca: database.ca, rejectUnauthorized: true },
    application_name: "dream-publication-seal",
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 5500,
  };
}

async function withVerifier<T>(connection: ClientConfig, lifetime: AbortSignal, run: (client: Client) => Promise<T>) {
  lifetime.throwIfAborted();
  const client = new Client(connection);
  let failed = false;
  client.on("error", () => { failed = true; });
  let ending: Promise<void> | undefined;
  const end = () => ending ??= client.end();
  let listener: ReturnType<typeof addAbortListener> | undefined;
  let result: T;
  try {
    await client.connect();
    listener = addAbortListener(lifetime, () => { void end().catch(() => undefined); });
    lifetime.throwIfAborted();
    result = await run(client);
  } finally {
    listener?.[Symbol.dispose]();
    await end();
  }
  if (failed || lifetime.aborted) throw new PublicationDatabaseUnavailable();
  return result;
}

async function waitForCheck(check: Promise<boolean>, signal?: AbortSignal) {
  if (!signal) return check;
  const canceled = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => canceled.reject(signal.reason));
  try { return await Promise.race([check, canceled.promise]); }
  finally { listener[Symbol.dispose](); }
}

type VerifiedWork = <T>(operation: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

function guardedProviders(bundle: Active, run: VerifiedWork, close: Active["close"]): Active | undefined {
  const { adminStore, showcaseSource, coverSource } = bundle;
  if (showcaseSource.mode !== "active" || coverSource.mode !== "active" || !showcaseSource.store || !coverSource.store?.confirmCover) return;
  const { listApproved } = showcaseSource.store;
  const { findCover, readObject, confirmCover, media } = coverSource.store;
  return Object.freeze({
    mode: "active" as const,
    close,
    adminStore: Object.freeze({
      transaction: operation => run(() => adminStore.transaction(operation)),
    } satisfies Active["adminStore"]),
    showcaseSource: Object.freeze({
      mode: "active" as const,
      store: Object.freeze({
        listApproved: signal => run(() => listApproved(signal), signal),
      } satisfies NonNullable<typeof showcaseSource.store>),
    }),
    coverSource: Object.freeze({
      mode: "active" as const,
      store: Object.freeze({
        ...(media && { media: {
          findMedia: (address, signal) => run(() => media.findMedia(address, signal), signal),
          readRange: (row, start, end, signal) => run(() => media.readRange(row, start, end, signal), signal),
        } }),
        findCover: (address, signal) => run(() => findCover(address, signal), signal),
        readObject: (key, options) => run(() => readObject(key, options), options.signal),
        confirmCover: (address, expected, signal) => run(() => confirmCover(address, expected, signal), signal),
      } satisfies NonNullable<typeof coverSource.store>),
    }),
  });
}

/** The caller holds the approved T341 work lock through the first get() and owns shutdown. */
export function createSealedPublicationRuntime(options?: Options) {
  let approved: Options | undefined;
  try { if (options) approved = { ...options, server: structuredClone(options.server), plan: structuredClone(options.plan) }; }
  catch { /* An invalid configuration leaves all providers inactive. */ }

  let config: PublicationRuntimeOptions;
  const providers = createPublicationRuntime(() => config);
  const lifetime = new AbortController();
  let active: Active | undefined;
  let startup: Promise<void> | undefined;
  let revalidation: Promise<boolean> | undefined;
  let shutdown: Promise<void> | undefined;

  function deactivate() {
    active = undefined;
    lifetime.abort();
    // Start closing immediately. Admitted operations may still be releasing their leases.
    void providers.close().catch(() => undefined);
  }

  function close() {
    deactivate();
    return shutdown ??= Promise.all([providers.close(), startup, revalidation]).then(() => undefined);
  }

  async function inspect(connection: ClientConfig, approval: Options, installedAt: string) {
    try {
      await withVerifier({ ...connection, application_name: "dream-publication-revalidation" }, lifetime.signal,
        client => revalidateDelegatedPublication(client, approval.plan, approval.work, installedAt));
      return true;
    } catch {
      deactivate();
      return false;
    }
  }

  async function start() {
    try {
      if (!approved) return;
      const approval = approved;
      const connection = verifierConfig(approval);
      if (!connection) return;
      const initialized = await withVerifier(connection, lifetime.signal, async client => {
        const before = await verifyDelegatedPublication(client, approval.plan, approval.work);
        if (before.mode !== "sealed" || lifetime.signal.aborted) return;
        config = createPublicationServerConfig({ ...approval.server,
          database: { ...approval.server.database, approvedDatabaseOid: approval.plan.target.databaseOid } });
        const bundle = await providers.get();
        if (bundle.mode !== "active" || lifetime.signal.aborted) return;
        const after = await verifyDelegatedPublication(client, approval.plan, approval.work);
        if (isDeepStrictEqual(before, after)) return { bundle, installedAt: before.installedAt };
      });
      if (!initialized || lifetime.signal.aborted) return;
      const { bundle, installedAt } = initialized;
      active = guardedProviders(bundle, async (operation, signal) => {
        signal?.throwIfAborted();
        if (lifetime.signal.aborted) throw new PublicationDatabaseUnavailable();
        revalidation ??= inspect(connection, approval, installedAt).finally(() => { revalidation = undefined; });
        const allowed = await waitForCheck(revalidation, signal);
        signal?.throwIfAborted();
        if (!allowed || lifetime.signal.aborted) throw new PublicationDatabaseUnavailable();
        return operation();
      }, close);
    } catch {
      // A verifier/connect/assembly error must leave all three sources unavailable.
    } finally {
      if (!active) await providers.close().catch(() => undefined);
    }
  }

  return Object.freeze({
    async get() {
      if (!lifetime.signal.aborted) await (startup ??= start());
      return active ?? providers.get();
    },
    close,
  });
}
