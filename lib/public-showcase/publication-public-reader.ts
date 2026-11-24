import "server-only";
import { addAbortListener } from "node:events";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { isCoverGeneration, isCoverSlug, type CoverAddress } from "./cover-path";
import { COVER_MAX_BYTES, COVER_SOURCE, type CoverRow, type CoverSource, type CoverStore } from "./cover-source";
import { readApprovedSnapshot, SHOWCASE_SOURCE, ShowcaseSourceError, type ShowcaseListStore, type ShowcaseSource } from "./showcase-source";

type Options = Readonly<{
  profile: "t295-loopback-fixture";
  database: string;
  port: number;
  listPassword: string;
  filePassword: string;
  timeoutMs: number;
  readPrivateCover: CoverStore["readObject"];
}>;

type Readers = Readonly<{ showcaseSource: ShowcaseSource; coverSource: CoverSource; close(): Promise<void> }>;
type Role = "t295_read_list" | "t295_read_file";
const unavailable = (): Readers => ({ showcaseSource: SHOWCASE_SOURCE, coverSource: COVER_SOURCE, close: async () => {} });
const coverKey = /^([^/]+)\/([^/]+)\/([a-f0-9]{64})\.webp$/;
const listSql = "SELECT t295.list_approved() AS value";
const fileSql = "SELECT object_key,mime,size_bytes,sha FROM t295.find_cover($1::text,$2::bigint)";
const capabilitySql = `SELECT current_user AS role, session_user AS login, current_database() AS db,
  host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('server_version_num') AS version,
  has_function_privilege(to_regprocedure('t295.list_approved()'),'EXECUTE') AS list,
  has_function_privilege(to_regprocedure('t295.find_cover(text,bigint)'),'EXECUTE') AS cover,
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='t253_showcase' AND p.proname IN ('list_approved','find_cover','apply_command')
      AND has_function_privilege(p.oid,'EXECUTE')) AS legacy`;

function queryFailure(error: unknown) {
  if (error instanceof ShowcaseSourceError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "57014") return new ShowcaseSourceError("timeout");
  return new ShowcaseSourceError(code === "42501" || code === "28000" || code === "28P01" ? "permission" : "query");
}

async function bounded<T>(run: () => Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  const cancelled = new ShowcaseSourceError("timeout");
  if (signal.aborted) throw cancelled;
  const pending = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => { pending.reject(cancelled); onAbort?.(); });
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw cancelled;
      return run();
    }), pending.promise]);
    if (signal.aborted) throw cancelled;
    return result;
  } catch (error) { throw queryFailure(error); }
  finally { listener[Symbol.dispose](); }
}

async function freshQuery<Row extends QueryResultRow>(pool: Pool, sql: string, args: string[], signal: AbortSignal) {
  let leased: PoolClient | undefined;
  const release = (destroy: boolean) => {
    const client = leased;
    leased = undefined;
    if (!client) return;
    try { client.release(destroy); }
    catch (error) {
      void client.end().catch(() => {});
      if (!destroy) throw error;
    }
  };
  return bounded(async () => {
    const client = await pool.connect();
    leased = client;
    let reusable = false;
    try {
      // A single autocommit statement gets a fresh DB snapshot. A dirty lease is never queried or reused.
      if (signal.aborted) throw new ShowcaseSourceError("timeout");
      if (client.getTransactionStatus() !== "I") throw new ShowcaseSourceError("query");
      const { rows } = await client.query<Row>(sql, args);
      if (signal.aborted) throw new ShowcaseSourceError("timeout");
      if (client.getTransactionStatus() !== "I") throw new ShowcaseSourceError("query");
      reusable = true;
      return rows;
    } finally { release(!reusable); }
  }, signal, () => release(true));
}

function coverRow(row: QueryResultRow, address: CoverAddress): CoverRow {
  const { object_key: objectKey, mime, size_bytes: sizeBytes, sha } = row;
  if (typeof sha !== "string" || !/^[a-f0-9]{64}$/.test(sha) || objectKey !== `${address.slug}/${address.generation}/${sha}.webp` ||
    mime !== "image/webp" || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > COVER_MAX_BYTES) throw new ShowcaseSourceError("contract");
  return { objectKey, mime, sizeBytes, sha };
}

/** Connect the two existing public store contracts only to the explicit, owned T295 fixture. */
export async function openIsolatedPublicationPublicReader(options?: Options): Promise<Readers> {
  if (!options) return unavailable();
  const { profile, database, port, listPassword, filePassword, timeoutMs, readPrivateCover } = options;
  if (profile !== "t295-loopback-fixture" || !/^t253_[a-f0-9]{32}$/.test(database) || !Number.isInteger(port) || port < 1 || port > 65535 ||
    !listPassword || !filePassword || listPassword === filePassword || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 ||
    typeof readPrivateCover !== "function") return unavailable();

  const makePool = (user: Role, password: string) => new Pool({ host: "127.0.0.1", port, database, user, password, ssl: false,
    options: "-c search_path=pg_catalog -c default_transaction_read_only=on", max: 2, connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs, application_name: `t298-${user}` });
  const listPool = makePool("t295_read_list", listPassword);
  const filePool = makePool("t295_read_file", filePassword);
  for (const pool of [listPool, filePool]) pool.on("error", () => {}); // pg retires failed idle clients.
  let shutdown: Promise<void> | undefined;
  function close() {
    return shutdown ??= Promise.all([listPool.end(), filePool.end()]).then(() => {});
  }

  function signalFor(signal: AbortSignal) {
    if (shutdown) throw new ShowcaseSourceError("config");
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }

  const listStore: ShowcaseListStore = {
    async listApproved(signal) {
      const rows = await freshQuery<{ value: unknown }>(listPool, listSql, [], signalFor(signal));
      if (rows.length !== 1) throw new ShowcaseSourceError("contract");
      return rows[0].value;
    },
  };
  const findCover = async (address: CoverAddress, signal: AbortSignal): Promise<CoverRow | null> => {
    if (!isCoverSlug(address.slug) || !isCoverGeneration(address.generation)) throw new ShowcaseSourceError("contract");
    const rows = await freshQuery(filePool, fileSql, [address.slug, address.generation], signal);
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new ShowcaseSourceError("contract");
    return coverRow(rows[0], address);
  };
  const fileStore: CoverStore = {
    findCover: (address, signal) => findCover(address, signalFor(signal)),
    async confirmCover(address, expected, signal) {
      const current = await findCover(address, signalFor(signal));
      return current !== null && current.objectKey === expected.objectKey && current.mime === expected.mime &&
        current.sizeBytes === expected.sizeBytes && current.sha === expected.sha;
    },
    async readObject(key, { maxBytes, signal }) {
      const match = coverKey.exec(key);
      if (!match || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > COVER_MAX_BYTES) throw new ShowcaseSourceError("contract");
      const requestSignal = signalFor(signal);
      const row = await findCover({ slug: match[1], generation: match[2] }, requestSignal);
      if (!row || row.objectKey !== key || row.sizeBytes > maxBytes) throw new ShowcaseSourceError("permission");
      const bytes = await bounded(() => readPrivateCover(key, { maxBytes: row.sizeBytes, signal: requestSignal }), requestSignal);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.sizeBytes) throw new ShowcaseSourceError("contract");
      return Uint8Array.from(bytes);
    },
  };

  async function prove(pool: Pool, role: Role) {
    const rows = await freshQuery(pool, capabilitySql, [], AbortSignal.timeout(timeoutMs));
    const row = rows[0];
    if (rows.length !== 1 || row.role !== role || row.login !== role || row.db !== database || row.host !== "127.0.0.1" ||
      row.port !== port || row.version !== "170012" || row.legacy !== false ||
      row.list !== (role === "t295_read_list") || row.cover !== (role === "t295_read_file")) throw new ShowcaseSourceError("permission");
  }

  try {
    const checked = await Promise.allSettled([prove(listPool, "t295_read_list"), prove(filePool, "t295_read_file")]);
    if (checked.some(result => result.status === "rejected")) throw new ShowcaseSourceError("config");
    readApprovedSnapshot(await listStore.listApproved(AbortSignal.timeout(timeoutMs)));
    await fileStore.findCover({ slug: "t298-probe", generation: "1" }, AbortSignal.timeout(timeoutMs));
    return { showcaseSource: { mode: "active", store: listStore }, coverSource: { mode: "active", store: fileStore }, close };
  } catch {
    await close().catch(() => {});
    return unavailable();
  }
}
