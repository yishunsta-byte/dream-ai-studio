import { describe, expect, it, vi } from "vitest";
const importIo = vi.hoisted(() => ({ file: vi.fn(() => { throw Error("B38 file I/O forbidden"); }), pool: vi.fn(() => { throw Error("B38 native I/O forbidden"); }) }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>(), readFile: importIo.file }));
vi.mock("pg", () => ({ Pool: importIo.pool }));
import { decodePostgresCatalogObservationV3, readPostgresCatalogV3, postgresCatalogQueriesV3 } from "@/lib/db/postgres/migration-catalog-v3";
const cats = ["schemas", "relations", "columns", "constraints", "indexes", "policies", "triggers", "functions", "domains", "types", "defaultAcls", "dependencies", "roles", "memberships"];
type Row = Record<string, unknown>;
type Batch = { server_major: number; search_path: string; isolation: string; read_only: string; catalog_row: Row };
type Raw = Record<string, Batch[]>;
function fixture(offset = 0, pair = false) {
  const id = (n: number) => String(n + offset), p = (n: number) => ({ principalOid: n === 0 ? "0" : id(n) });
  const r = (n: number, name = "projects", schema = "dream") => ({ nativeOid: id(n), catalog: "pg_class", schema, name });
  const t = (n: number, name: string, schema = "dream") => ({ nativeOid: id(n), catalog: "pg_type", schema, name });
  const typUuid = t(9000, "uuid", "pg_catalog"), typText = t(9001, "text", "pg_catalog");
  const fn = (n: number, name: string, args: ReturnType<typeof t>[] = [], schema = "pg_catalog") => ({ nativeOid: id(n), catalog: "pg_proc", schema, name, argumentTypes: args });
  const auth = r(900, "users", "auth"), ix = { nativeOid: id(301), catalog: "pg_class", relation: auth, name: "users_pkey" };
  const con = (n = 500, name = "projects_owner_fk") => ({ nativeOid: id(n), catalog: "pg_constraint", objectKind: "relation", object: r(100), name });
  const eq = { nativeOid: id(9010), catalog: "pg_operator", schema: "pg_catalog", name: "=", leftType: typUuid, rightType: typUuid };
  const ext = (cls: string, n: number, identity: Row, subId = 0) => ({ endpoint: { class: cls, nativeOid: id(n), subId }, identity });
  const bindings = { roleProfile: pair ? "pair" : "none", migrationOwner: { nativeOid: id(11), name: "b38_owner" }, bootstrap: { nativeOid: id(10), name: "b38_bootstrap" },
    api: { nativeOid: id(12), name: "dream_api" }, worker: { nativeOid: id(13), name: "dream_worker" }, issuer: { nativeOid: id(14), name: "dream_upload_reserver" },
    apiLogin: pair ? { nativeOid: id(15), name: "dream_api_login" } : null, workerLogin: pair ? { nativeOid: id(16), name: "dream_worker_login" } : null,
    externalFacts: [ext("pg_class", 900, { kind: "relation", schema: "auth", name: "users" }),
      ext("pg_class", 900, { kind: "column", relation: { schema: "auth", name: "users" }, ordinal: 1, name: "id" }, 1),
      ext("pg_class", 301, { kind: "index", relation: { schema: "auth", name: "users" }, name: "users_pkey" }),
      ext("pg_type", 9000, { kind: "type", schema: "pg_catalog", name: "uuid" }), ext("pg_type", 9001, { kind: "type", schema: "pg_catalog", name: "text" }),
      ext("pg_operator", 9010, { kind: "operator", schema: "pg_catalog", name: "=", leftType: { schema: "pg_catalog", name: "uuid" }, rightType: { schema: "pg_catalog", name: "uuid" } }),
      ...[[8000, "fixture_io"], [8101, "RI_FKey_check_ins"], [8102, "RI_FKey_check_upd"], [8103, "RI_FKey_restrict_del"], [8104, "RI_FKey_noaction_upd"]].map(([n, name]) => ext("pg_proc", Number(n), { kind: "function", schema: "pg_catalog", name, argumentTypes: [] })),
    ] };
  const ownerAcl = [{ grantor: p(11), grantee: p(11), privilege: "USAGE", grantable: false }];
  const typeProps = { owner: p(11), defined: true, preferred: false, length: -1, byValue: false, delimiter: ",", alignment: "i", storage: "x", typeModifier: -1,
    dimensions: 0, collation: null, aclIsNull: true, acl: ownerAcl, input: fn(8000, "fixture_io"), output: fn(8000, "fixture_io"), receive: null, send: null, modifierInput: null, modifierOutput: null, analyze: null, subscript: null };
  const constraintBase = { deferrable: false, initiallyDeferred: false, enforced: true, validated: true, local: true, inheritedCount: 0, noInherit: true, period: false,
    parentConstraint: null, supportingIndex: null, referencedRelation: null, keyColumns: null, referencedColumns: null, updateAction: " ", deleteAction: " ", matchType: " ", deleteSetColumns: null,
    fkPrimaryForeignOperators: null, fkPrimaryPrimaryOperators: null, fkForeignForeignOperators: null, exclusionOperators: null, expression: null, definition: "fixture constraint" };
  const indexBase = { unique: true, primary: true, valid: true, ready: true, live: true, immediate: true, nullsNotDistinct: false, accessMethod: "btree", keyColumns: [1], includeColumns: [], opclasses: ["pg_catalog.uuid_ops"], collations: [null], options: [0], expressions: null, predicate: null, definition: "CREATE UNIQUE INDEX fixture" };
  const func = (n: number, name: string, args: ReturnType<typeof t>[], definer = false) => ({ nativeOid: id(n), schema: "dream_reservation", name,
    identityArgs: args.map(x => x.name).join(", "), declaredArgs: args.map(x => x.name).join(", "), result: definer ? "jsonb" : "trigger", language: "plpgsql", owner: p(definer ? 14 : 11), kind: "f", securityDefiner: definer,
    leakproof: false, strict: false, returnsSet: false, volatility: "v", parallel: "u", argumentTypes: args.map(x => x.name), argumentTypeRefs: args, allArgumentTypes: null, argumentModes: null, argumentNames: null,
    config: definer ? ["search_path=pg_catalog, pg_temp", "row_security=on"] : ["search_path=pg_catalog, pg_temp"], sourceSha256: "a".repeat(64), definitionSha256: "b".repeat(64),
    acl: definer ? [{ grantor: p(14), grantee: p(14), privilege: "EXECUTE", grantable: false }, { grantor: p(14), grantee: p(12), privilege: "EXECUTE", grantable: false }] : [{ grantor: p(11), grantee: p(11), privilege: "EXECUTE", grantable: false }] });
  const trigger = (n: number, functionId: number, functionName: string, relation: ReturnType<typeof r>, other: ReturnType<typeof r>, bits: number) => ({ nativeOid: id(n), nativeName: "RI_ConstraintTrigger_c_" + id(n), relation,
    enabled: "O", typeBits: bits, deferrable: false, initiallyDeferred: false, function: fn(functionId, functionName), constraint: con(), constraintRelation: other, constraintIndex: ix, parentTriggerOid: null, argumentCount: 0,
    columns: [], argsHex: "", whenExpression: null, oldTransitionTable: null, newTransitionTable: null, internal: true, definition: null });
  const flags = { superuser: false, bypassRls: false, inherit: false, createRole: false, createDb: false, replication: false, config: null };
  const role = (n: number, name: string, login = false) => ({ nativeOid: id(n), name, login, ...flags });
  const edge = (n: number, member: number, parent: number, admin = true, set = false) => ({ nativeOid: id(n), member: p(member), parent: p(parent), grantor: p(10), admin, inherit: false, set });
  const dep = (cls: string, n: number, refcls: string, ref: number, subId = 0) => ({ dependent: { class: cls, nativeOid: id(n), subId: 0 }, referenced: { class: refcls, nativeOid: id(ref), subId }, dependencyType: "n" });
  const data = {
    schemas: ["dream", "dream_reservation", "dream_migrations"].map((name, i) => ({ nativeOid: id(1 + i), name, owner: p(11), acl: [] })),
    relations: [{ nativeOid: id(100), schema: "dream", name: "projects", kind: "r", owner: p(11), rls: true, forceRls: true, persistence: "p", replicaIdentity: "d", isPartition: false,
      rowType: t(200, "projects"), ofType: null, options: null, acl: [], toastNativeOid: id(400), toast: { nativeOid: id(400), indexOid: id(401), owner: p(11), indexOwner: p(11), namespace: "pg_toast", relationKind: "t", indexKind: "i", unique: true, parents: [id(100)], indexParentOid: id(400) } }],
    columns: [{ relation: r(100), ordinal: 1, name: "owner_id", type: "uuid", notNull: true, identity: "", generated: "", dropped: false, defaultNativeOid: id(402), defaultExpression: "'00000000-0000-4000-8000-000000000001'::uuid", collation: null, acl: [] }],
    constraints: [{ ...constraintBase, nativeOid: id(500), identity: con(), kind: "f", supportingIndex: ix, referencedRelation: auth, keyColumns: [1], referencedColumns: [1], updateAction: "a", deleteAction: "r", matchType: "s", fkPrimaryForeignOperators: [eq], fkPrimaryPrimaryOperators: [eq], fkForeignForeignOperators: [eq] },
      { ...constraintBase, nativeOid: id(503), identity: con(503, "guard_123"), kind: "t", deferrable: true, initiallyDeferred: true }],
    indexes: [{ ...indexBase, nativeOid: id(301), relation: auth, scope: "external-prerequisite", name: "users_pkey" }],
    policies: [{ nativeOid: id(550), relation: r(100), name: "policy_read", permissive: true, command: "r", roles: [p(12), p(0)], usingExpression: "true", checkExpression: null }],
    triggers: [trigger(701, 8101, "RI_FKey_check_ins", r(100), auth, 5), trigger(702, 8102, "RI_FKey_check_upd", r(100), auth, 17), trigger(703, 8103, "RI_FKey_restrict_del", auth, r(100), 9), trigger(704, 8104, "RI_FKey_noaction_upd", auth, r(100), 17),
      { ...trigger(700, 6003, "fixture_guard", r(100), auth, 21), nativeName: "guard_123", internal: false, function: fn(6003, "fixture_guard", [], "dream_reservation"), constraint: con(503, "guard_123"), constraintRelation: null, constraintIndex: null, deferrable: true, initiallyDeferred: true, definition: "CREATE CONSTRAINT TRIGGER guard_123 fixture" }],
    functions: [func(6001, "read_upload_seed_v1", [typUuid, typText], true), func(6002, "reserve_upload_v1", [typUuid, typText, typText], true), func(6003, "fixture_guard", [])],
    domains: [{ nativeOid: id(202), schema: "dream", name: "safe_uint", ...typeProps, kind: "d", category: "N", baseType: typUuid, notNull: false, defaultExpression: null, arrayType: t(203, "_safe_uint") }],
    types: [{ nativeOid: id(200), schema: "dream", name: "projects", ...typeProps, form: "table-composite", kind: "c", category: "C", relation: r(100), element: null, baseType: null, notNull: false, defaultExpression: null, arrayType: t(201, "_projects") },
      { nativeOid: id(201), schema: "dream", name: "_projects", ...typeProps, form: "generated-array", kind: "b", category: "A", relation: null, element: t(200, "projects"), baseType: null, notNull: false, defaultExpression: null, arrayType: null },
      { nativeOid: id(203), schema: "dream", name: "_safe_uint", ...typeProps, form: "generated-array", kind: "b", category: "A", relation: null, element: t(202, "safe_uint"), baseType: null, notNull: false, defaultExpression: null, arrayType: null }],
    defaultAcls: [{ nativeOid: id(800), owner: p(11), schema: "dream", objectKind: "T", acl: ownerAcl }],
    dependencies: [dep("pg_class", 100, "pg_namespace", 1), dep("pg_type", 200, "pg_class", 100), dep("pg_type", 201, "pg_type", 200), dep("pg_trigger", 701, "pg_constraint", 500), dep("pg_attrdef", 402, "pg_class", 100, 1), dep("pg_class", 400, "pg_class", 100), dep("pg_class", 401, "pg_class", 400)],
    roles: [{ ...role(10, "b38_bootstrap", true), superuser: true, bypassRls: true, inherit: true, createRole: true, createDb: true, replication: true }, { ...role(11, "b38_owner", true), createRole: true }, role(12, "dream_api"), role(13, "dream_worker"), role(14, "dream_upload_reserver"), ...(pair ? [role(15, "dream_api_login", true), role(16, "dream_worker_login", true)] : [])],
    memberships: [edge(1001, 11, 12), edge(1002, 11, 13), edge(1003, 11, 14), ...(pair ? [edge(1004, 15, 12, false, true), edge(1005, 16, 13, false, true)] : [])],
  };
  const raw = Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.map(catalog_row => ({ server_major: 18, search_path: "pg_catalog", isolation: "repeatable read", read_only: "on", catalog_row }))])) as Raw;
  return { raw, bindings, id };
}
const row = (f: ReturnType<typeof fixture>, c: string, i = 0) => f.raw[c][i].catalog_row;
const invalid = (run: () => unknown) => expect(run).toThrowError("CATALOG_OBSERVATION_INVALID");

describe("B38 all14 synthetic observations; NOT native or golden reference", () => {
  it("performs no import filesystem or native connection I/O", () => { expect(importIo.file).not.toHaveBeenCalled(); expect(importIo.pool).not.toHaveBeenCalled(); });
  it.each([false, true])("strictly observes every category with pair profile %s without approving state", pair => {
    const f = fixture(0, pair), result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result).toMatchObject({ kind: "unvalidated-catalog-observation", approval: false, expectedCatalog: false, roleProfile: pair ? "pair" : "none", counts: { namedTriggers: 1, internalTriggers: 4 } });
    expect(Object.keys(result.catalog).sort()).toEqual([...cats].sort());
    for (const c of Object.values(result.catalog)) expect(c.length).toBeGreaterThan(0);
    expect(Object.isFrozen(result.catalog.types[0])).toBe(true); expect(result.canonicalJson).not.toContain("nativeOid");
    expect(result.catalog.policies[0].roles).toContainEqual({ kind: "public" });
    expect(result.catalog.dependencies.some(d => d.dependent.includes("table-toast"))).toBe(true);
  });
  it("normalizes synthetic distinct native assignments/internal generated names without erasing named digits", () => {
    const a = fixture(), b = fixture(20000);
    const first = decodePostgresCatalogObservationV3(a.raw, a.bindings), second = decodePostgresCatalogObservationV3(b.raw, b.bindings);
    expect(first.canonicalJson).toBe(second.canonicalJson); expect(first.observationSha256).toBe(second.observationSha256);
    expect(first.canonicalJson).toContain("guard_123"); expect(first.canonicalJson).not.toContain("RI_ConstraintTrigger");
  });
  it("sorts only declared sets and preserves ordered configuration/column sequences", () => {
    const f = fixture(), original = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    for (const c of cats) f.raw[c].reverse();
    expect(decodePostgresCatalogObservationV3(f.raw, f.bindings).canonicalJson).toBe(original.canonicalJson);
    const g = fixture(); row(g, "functions").config = ["row_security=on", "search_path=pg_catalog, pg_temp"];
    invalid(() => decodePostgresCatalogObservationV3(g.raw, g.bindings));
  });
  it.each(cats)("rejects missing top category %s", c => { const f = fixture(); delete f.raw[c]; invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings)); });
  it.each(cats)("rejects unknown field in %s raw projection", c => { const f = fixture(); row(f, c).extra = true; invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings)); });
  it.each(cats)("rejects missing field in %s raw projection", c => { const f = fixture(); delete row(f, c)[Object.keys(row(f, c))[0]]; invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings)); });
  it.each(cats)("rejects duplicated %s identity/row", c => { const f = fixture(); f.raw[c].push(structuredClone(f.raw[c][0])); invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings)); });
  it.each([0, -1, 1.5, "01", "0", "-1", "4294967296", "1\n", null, undefined])("rejects unsafe/noncanonical OID %s", nativeOid => {
    const f = fixture(); row(f, "types").nativeOid = nativeOid; invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it.each([["relations", "kind", "v"], ["relations", "kind", "S"], ["types", "kind", "e"], ["types", "form", "unknown"], ["constraints", "kind", "x"], ["triggers", "internal", null], ["functions", "language", "c"], ["functions", "sourceSha256", "A".repeat(64)], ["policies", "command", "SELECT"], ["indexes", "valid", null], ["roles", "inherit", "false"], ["columns", "ordinal", -0]])("rejects %s.%s wrong enum/null/type", (c, k, value) => {
    const f = fixture(); row(f, String(c))[String(k)] = value; invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("does not promote well-formed body change to expected/approved state", () => {
    const f = fixture(), before = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    row(f, "functions").sourceSha256 = "c".repeat(64);
    const after = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(after.observationSha256).not.toBe(before.observationSha256); expect(after.approval).toBe(false); expect(after.expectedCatalog).toBe(false);
  });
  it("rejects unknown native function argument references and arity mismatch", () => {
    for (const fault of ["native-reference", "arity"]) {
      const f = fixture();
      if (fault === "native-reference") (row(f, "functions").argumentTypeRefs as Row[])[0].nativeOid = "999999";
      else row(f, "functions").argumentTypes = [];
      invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    }
  });
  it.each(["oid-newline", "hash-newline", "hex-newline"])("rejects complete-lexeme %s without coercion", fault => {
    const f = fixture();
    if (fault === "oid-newline") f.bindings.migrationOwner.nativeOid += "\n";
    if (fault === "hash-newline") row(f, "functions").sourceSha256 = "a".repeat(64) + "\n";
    if (fault === "hex-newline") row(f, "triggers").argsHex = "\n";
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it.each(["$owner", "PUBLIC", '{"kind":"public"}'])("uses native principal identity for marker-like management name %s", name => {
    const f = fixture(); f.bindings.migrationOwner.name = name; row(f, "roles", 1).name = name;
    const observed = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(observed.catalog.schemas[0].owner).toEqual({ kind: "migration-owner" });
    expect(observed.catalog.policies[0].roles).toContainEqual({ kind: "public" });
  });
  it("rejects root/row/management getters without invoking them", () => {
    const f = fixture(); let reads = 0; Object.defineProperty(row(f, "types"), "owner", { enumerable: true, get() { reads++; throw Error("secret"); } });
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    invalid(() => decodePostgresCatalogObservationV3({ get schemas() { reads++; return []; } }, f.bindings));
    invalid(() => decodePostgresCatalogObservationV3(fixture().raw, { get migrationOwner() { reads++; return {}; } })); expect(reads).toBe(0);
  });
  it.each(["array", "class", "element", "missing-array", "unknown-type", "alias-type"])("rejects broken reciprocal %s links", fault => {
    const f = fixture();
    if (fault === "array") row(f, "types").arrayType = null;
    if (fault === "class") row(f, "relations").rowType = (row(f, "types", 2).element);
    if (fault === "element") row(f, "types", 1).element = row(f, "types", 2).element;
    if (fault === "missing-array") f.raw.types.splice(1, 1);
    if (fault === "unknown-type") row(f, "domains").baseType = { nativeOid: "99999", catalog: "pg_type", schema: "pg_catalog", name: "uuid" };
    if (fault === "alias-type") row(f, "types", 1).element = { nativeOid: "200", catalog: "pg_type", schema: "dream", name: "safe_uint" };
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it.each(["parents", "namespace", "relationKind", "indexKind", "owner", "indexOwner", "indexParentOid", "nativeOid"])("rejects malformed or parentless toast auxiliary %s", k => {
    const f = fixture(), toast = row(f, "relations").toast as Row;
    toast[k] = k === "parents" ? ["100", "100"] : k.includes("Owner") || k === "owner" ? { principalOid: "14" } : "unknown";
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("rejects hidden/multiple-parent/name-colliding auxiliary and unknown dependency endpoints", () => {
    for (const fault of ["hidden", "orphan", "collision", "unknown-default", "unknown-endpoint"]) {
      const f = fixture();
      if (fault === "hidden") row(f, "relations").toast = null;
      if (fault === "orphan") (row(f, "relations").toast as Row).parents = ["999"];
      if (fault === "collision") (row(f, "relations").toast as Row).indexOid = "100";
      if (fault === "unknown-default") (row(f, "dependencies", 4).dependent as Row).nativeOid = "999";
      if (fault === "unknown-endpoint") (row(f, "dependencies").referenced as Row).class = "unknown_catalog";
      invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    }
  });
  it.each(["missing-field", "unknown-kind", "duplicate-identity", "duplicate-native", "unknown-subcolumn", "principal-alias"])("rejects malformed trusted external facts %s", fault => {
    const f = fixture();
    if (fault === "missing-field") delete (f.bindings.externalFacts[0] as Row).endpoint;
    if (fault === "unknown-kind") f.bindings.externalFacts[0].identity.kind = "universal_auxiliary";
    if (fault === "duplicate-identity") { const copy = structuredClone(f.bindings.externalFacts[0]); copy.endpoint.nativeOid = "9999"; f.bindings.externalFacts.push(copy); }
    if (fault === "duplicate-native") f.bindings.externalFacts.push(structuredClone(f.bindings.externalFacts[0]));
    if (fault === "unknown-subcolumn") (row(f, "dependencies", 4).referenced as Row).subId = 2;
    if (fault === "principal-alias") row(f, "relations").owner = { kind: "migration-owner" };
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it.each(["constraint-parent", "trigger-parent", "wrong-parent", "missing-internal", "duplicate-structural", "wrong-function", "wrong-bit", "wrong-index", "wrong-related", "args"])("rejects malformed internal/parent %s", fault => {
    const f = fixture();
    if (fault === "constraint-parent") row(f, "constraints").parentConstraint = structuredClone(row(f, "constraints").identity);
    if (fault === "trigger-parent") row(f, "triggers").parentTriggerOid = "701";
    if (fault === "wrong-parent") row(f, "triggers").constraint = row(f, "constraints", 1).identity;
    if (fault === "missing-internal") f.raw.triggers.splice(0, 1);
    if (fault === "duplicate-structural") { const t = structuredClone(f.raw.triggers[0]); t.catalog_row.nativeOid = "799"; t.catalog_row.nativeName = "RI_ConstraintTrigger_different999"; f.raw.triggers.push(t); }
    if (fault === "wrong-function") row(f, "triggers").function = row(f, "triggers", 1).function;
    if (fault === "wrong-bit") row(f, "triggers").typeBits = 9;
    if (fault === "wrong-index") row(f, "triggers").constraintIndex = null;
    if (fault === "wrong-related") row(f, "triggers").constraintRelation = row(f, "triggers").relation;
    if (fault === "args") { row(f, "triggers").argsHex = "a001"; row(f, "triggers").argumentCount = 1; }
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("rejects unobserved/unauthorized external index metadata and unrelated external named triggers", () => {
    for (const fault of ["missing-index", "unauthorized-index", "external-named"]) {
      const f = fixture();
      if (fault === "missing-index") f.raw.indexes = [];
      if (fault === "unauthorized-index") f.bindings.externalFacts = f.bindings.externalFacts.filter(x => x.identity.kind !== "index");
      if (fault === "external-named") { row(f, "triggers", 4).relation = row(f, "triggers", 2).relation; row(f, "triggers", 4).constraint = null; }
      invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    }
  });
  it.each(["grantor", "public-owner", "issuer-owner", "edge", "profile", "slot-alias"])("rejects bad native principal/ACL/profile %s", fault => {
    const f = fixture();
    if (fault === "grantor") ((row(f, "types").acl as Row[])[0]).grantor = { principalOid: "10" };
    if (fault === "public-owner") row(f, "domains").owner = { principalOid: "0" };
    if (fault === "issuer-owner") row(f, "relations").owner = { principalOid: "14" };
    if (fault === "edge") row(f, "memberships").set = true;
    if (fault === "profile") f.bindings.roleProfile = "pair";
    if (fault === "slot-alias") f.bindings.api.nativeOid = f.bindings.issuer.nativeOid;
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("snapshots trusted values, row batches and port before deferred reads", async () => {
    const f = fixture(); let resume!: () => void; const gate = new Promise<void>(r => { resume = r; }); let n = 0;
    const port = { query: vi.fn(async (sql: string, values: readonly unknown[]) => {
      void sql; void values;
      const call = n++;
      if (call === 0) { await gate; return { rows: [{ server_version: "180007", search_path: "pg_catalog", isolation: "repeatable read", read_only: "on" }] }; }
      const category = cats[call - 1];
      if (call === 2) row(f, "schemas").owner = { principalOid: "99999" };
      return { rows: f.raw[category] };
    }) };
    const original = port.query, pending = readPostgresCatalogV3(port, f.bindings);
    f.bindings.migrationOwner.nativeOid = "999"; f.bindings.externalFacts[0].identity.name = "changed";
    port.query = vi.fn(async () => { throw Error("swapped"); }); resume();
    const result = await pending;
    expect(result.approval).toBe(false); expect(original).toHaveBeenCalledTimes(15); expect(port.query).not.toHaveBeenCalled();
    for (const [i, call] of original.mock.calls.entries()) { if (i === 0) expect(call[0]).toMatch(/^SELECT pg_catalog.current_setting/); else expect(call[0]).toBe(Object.values(postgresCatalogQueriesV3)[i - 1]); expect(Object.isFrozen(call[1])).toBe(true); }
  });
  it("rejects accessor port/result rows without executing getters or extra queries", async () => {
    const f = fixture(); let reads = 0;
    await expect(readPostgresCatalogV3({ get query() { reads++; return async () => ({ rows: [] }); } }, f.bindings)).rejects.toMatchObject({ code: "CATALOG_OBSERVATION_INVALID" });
    const query = vi.fn(async () => ({ get rows() { reads++; return []; } }));
    await expect(readPostgresCatalogV3({ query }, f.bindings)).rejects.toMatchObject({ code: "CATALOG_OBSERVATION_INVALID" });
    expect(reads).toBe(0); expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(["major", "version-newline", "path", "context-alias"])("rejects initial %s before deparser/catalog reads", async fault => {
    const f = fixture(), context: Row = { server_version: "180007", search_path: "pg_catalog", isolation: "repeatable read", read_only: "on" };
    if (fault === "major") context.server_version = "170007";
    if (fault === "version-newline") context.server_version = "180007\n";
    if (fault === "path") context.search_path = "foreign,pg_catalog";
    if (fault === "context-alias") context.extra = true;
    const query = vi.fn(async () => ({ rows: [context] }));
    await expect(readPostgresCatalogV3({ query }, f.bindings)).rejects.toMatchObject({ code: "CATALOG_OBSERVATION_INVALID" }); expect(query).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid management facts before the first context query", async () => {
    const f = fixture(); f.bindings.api.nativeOid += "\n"; const query = vi.fn(async () => ({ rows: [] }));
    await expect(readPostgresCatalogV3({ query }, f.bindings)).rejects.toMatchObject({ code: "CATALOG_OBSERVATION_INVALID" }); expect(query).not.toHaveBeenCalled();
  });
  it("exposes only fixed SELECTs, no execution settings/history scan and no native connection", () => {
    expect(Object.keys(postgresCatalogQueriesV3)).toEqual(cats); expect(Object.isFrozen(postgresCatalogQueriesV3)).toBe(true);
    for (const sql of Object.values(postgresCatalogQueriesV3)) {
      expect(sql).toMatch(/^SELECT /); expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK|SET LOCAL|CREATE TABLE|DROP TABLE|INSERT INTO|UPDATE pg_)\b/);
      for (const p of ["$1::oid[]", "$2::oid[]", "$3::oid[]"]) expect(sql).toContain(p);
    }
    expect(postgresCatalogQueriesV3.types).not.toContain("t.typrelid=0"); expect(postgresCatalogQueriesV3.triggers).not.toContain("NOT t.tgisinternal");
    expect(postgresCatalogQueriesV3.dependencies).toContain("pg_shdepend");
  });
  it("closes malformed context/aliases and read-port errors without raw secrets", async () => {
    for (const fault of ["context", "alias"]) {
      const f = fixture(); if (fault === "context") f.raw.types[0].server_major = 17; else Object.assign(f.raw.types[0], { extra_alias: true });
      invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    }
    const f = fixture(), query = vi.fn(async () => { throw Error("secret DSN password"); });
    const error = await readPostgresCatalogV3({ query }, f.bindings).catch(e => e);
    expect(error.message).toBe("CATALOG_OBSERVATION_INVALID"); expect(error.cause).toBeUndefined(); expect(query).toHaveBeenCalledTimes(1);
  });
});
