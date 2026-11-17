import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertPlainData, frozen } from "../../storage/uploads/schema";

/** Observations only: no golden catalog, state comparison, approval or executor. */
export class PostgresCatalogObservationErrorV3 extends Error {
  readonly code = "CATALOG_OBSERVATION_INVALID";
  constructor() { super("CATALOG_OBSERVATION_INVALID"); }
}
const namespaces = ["dream", "dream_reservation", "dream_migrations"] as const;
const categories = ["schemas", "relations", "columns", "constraints", "indexes", "policies", "triggers", "functions", "domains", "types", "defaultAcls", "dependencies", "roles", "memberships"] as const;
type Category = typeof categories[number];
const oid = z.string().refine(s => /^[1-9][0-9]{0,9}$/.exec(s)?.[0] === s && BigInt(s) <= 4294967295n);
const oid0 = z.union([oid, z.literal("0")]);
const identifier = z.string().min(1).max(63).refine(s => !s.includes("\0") && Buffer.byteLength(s, "utf8") <= 63);
const text = z.string().max(65536).refine(s => !s.includes("\0"));
const integer = z.number().int().safe().refine(n => !Object.is(n, -0));
const count = integer.min(0).max(65535), attr = integer.min(1).max(32767);
const bool = z.boolean(), hash = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const nativePrincipal = z.strictObject({ principalOid: oid0 });
const qualified = z.strictObject({ nativeOid: oid, catalog: z.enum(["pg_class", "pg_type", "pg_collation"]), schema: identifier, name: identifier });
const relationRef = qualified.extend({ catalog: z.literal("pg_class") });
const typeRef = qualified.extend({ catalog: z.literal("pg_type") });
const ownedRelationRef = relationRef.extend({ schema: z.enum(namespaces) });
const functionRef = z.strictObject({ nativeOid: oid, catalog: z.literal("pg_proc"), schema: identifier, name: identifier, argumentTypes: z.array(typeRef).max(100) });
const operatorRef = z.strictObject({ nativeOid: oid, catalog: z.literal("pg_operator"), schema: identifier, name: identifier, leftType: typeRef.nullable(), rightType: typeRef.nullable() });
const indexRef = z.strictObject({ nativeOid: oid, catalog: z.literal("pg_class"), relation: relationRef, name: identifier });
const constraintRef = z.strictObject({ nativeOid: oid, catalog: z.literal("pg_constraint"), objectKind: z.enum(["relation", "domain"]), object: qualified.extend({ schema: z.enum(namespaces) }), name: identifier });
const privilege = z.enum(["CREATE", "USAGE", "EXECUTE", "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]);
const acl = z.array(z.strictObject({ grantor: nativePrincipal, grantee: nativePrincipal, privilege, grantable: bool })).max(1000);
const stringArray = z.array(text).max(1000), attrs = z.array(attr).max(1600);
const key = { nativeOid: oid, schema: z.enum(namespaces), name: identifier };
const typeProperties = {
  owner: nativePrincipal, defined: bool, preferred: bool, length: integer.min(-2).max(32767), byValue: bool,
  delimiter: z.string().length(1).refine(s => s !== "\0"), alignment: z.enum(["c", "s", "i", "d"]), storage: z.enum(["p", "e", "m", "x"]),
  typeModifier: integer.min(-1).max(2147483647), dimensions: count, collation: qualified.extend({ catalog: z.literal("pg_collation") }).nullable(), arrayType: typeRef.nullable(),
  aclIsNull: bool, acl, input: functionRef, output: functionRef, receive: functionRef.nullable(), send: functionRef.nullable(),
  modifierInput: functionRef.nullable(), modifierOutput: functionRef.nullable(), analyze: functionRef.nullable(), subscript: functionRef.nullable(),
};
const triggerProperties = {
  nativeOid: oid, nativeName: identifier, relation: relationRef, enabled: z.enum(["O", "D", "R", "A"]), typeBits: integer.min(1).max(127),
  deferrable: bool, initiallyDeferred: bool, function: functionRef, constraint: constraintRef.nullable(),
  constraintRelation: relationRef.nullable(), constraintIndex: indexRef.nullable(), parentTriggerOid: oid.nullable(),
  argumentCount: count, columns: attrs, argsHex: z.string().max(65536).refine(s => /^(?:[a-f0-9]{2})*$/.exec(s)?.[0] === s),
  whenExpression: text.nullable(), oldTransitionTable: identifier.nullable(), newTransitionTable: identifier.nullable(),
};
const endpoint = z.strictObject({ class: z.enum(["pg_namespace", "pg_class", "pg_type", "pg_proc", "pg_constraint", "pg_trigger", "pg_policy", "pg_default_acl", "pg_attrdef", "pg_authid", "pg_language", "pg_collation", "pg_operator", "pg_opclass"]), nativeOid: oid, subId: count });
const rawShapes = {
  schemas: z.strictObject({ nativeOid: oid, name: z.enum(namespaces), owner: nativePrincipal, acl }),
  relations: z.strictObject({ ...key, kind: z.literal("r"), owner: nativePrincipal, rls: bool, forceRls: bool,
    persistence: z.literal("p"), replicaIdentity: z.enum(["d", "n", "f", "i"]), isPartition: z.literal(false), rowType: typeRef,
    ofType: typeRef.nullable(), options: stringArray.nullable(), acl, toastNativeOid: oid.nullable(),
    toast: z.strictObject({ nativeOid: oid, indexOid: oid, owner: nativePrincipal, indexOwner: nativePrincipal,
      namespace: z.literal("pg_toast"), relationKind: z.literal("t"), indexKind: z.literal("i"), unique: z.literal(true),
      parents: z.array(oid).length(1), indexParentOid: oid }).nullable() }),
  columns: z.strictObject({ relation: ownedRelationRef, ordinal: attr, name: identifier, type: text,
    notNull: bool, identity: z.enum(["", "a", "d"]), generated: z.enum(["", "s", "v"]), dropped: bool,
    defaultNativeOid: oid.nullable(), defaultExpression: text.nullable(), collation: text.nullable(), acl }),
  constraints: z.strictObject({ nativeOid: oid, identity: constraintRef, kind: z.enum(["p", "u", "f", "c", "n", "t"]),
    deferrable: bool, initiallyDeferred: bool, enforced: bool, validated: bool, local: bool, inheritedCount: count, noInherit: bool, period: bool,
    parentConstraint: constraintRef.nullable(), supportingIndex: indexRef.nullable(), referencedRelation: relationRef.nullable(),
    keyColumns: attrs.nullable(), referencedColumns: attrs.nullable(), updateAction: z.enum([" ", "a", "r", "c", "n", "d"]),
    deleteAction: z.enum([" ", "a", "r", "c", "n", "d"]), matchType: z.enum([" ", "f", "p", "s"]), deleteSetColumns: attrs.nullable(),
    fkPrimaryForeignOperators: z.array(operatorRef).nullable(), fkPrimaryPrimaryOperators: z.array(operatorRef).nullable(),
    fkForeignForeignOperators: z.array(operatorRef).nullable(), exclusionOperators: z.array(operatorRef).nullable(), expression: text.nullable(), definition: text }),
  indexes: z.strictObject({ nativeOid: oid, relation: relationRef, scope: z.enum(["owned", "external-prerequisite"]), name: identifier,
    unique: bool, primary: bool, valid: bool, ready: bool, live: bool, immediate: bool, nullsNotDistinct: bool, accessMethod: identifier,
    keyColumns: z.array(integer.min(0).max(32767)), includeColumns: attrs, opclasses: stringArray, collations: z.array(text.nullable()), options: z.array(integer),
    expressions: text.nullable(), predicate: text.nullable(), definition: text }),
  policies: z.strictObject({ nativeOid: oid, relation: ownedRelationRef, name: identifier, permissive: bool,
    command: z.enum(["*", "r", "a", "w", "d"]), roles: z.array(nativePrincipal).min(1), usingExpression: text.nullable(), checkExpression: text.nullable() }),
  triggers: z.discriminatedUnion("internal", [
    z.strictObject({ ...triggerProperties, internal: z.literal(false), definition: text }),
    z.strictObject({ ...triggerProperties, internal: z.literal(true), constraint: constraintRef, definition: z.null() }),
  ]),
  functions: z.strictObject({ ...key, identityArgs: text, declaredArgs: text, result: text, language: z.enum(["sql", "plpgsql"]),
    owner: nativePrincipal, kind: z.literal("f"), securityDefiner: bool, leakproof: bool, strict: bool, returnsSet: bool,
    volatility: z.enum(["i", "s", "v"]), parallel: z.enum(["s", "r", "u"]), argumentTypes: stringArray,
    argumentTypeRefs: z.array(typeRef), allArgumentTypes: stringArray.nullable(), argumentModes: z.array(z.enum(["i", "o", "b", "v", "t"])).nullable(),
    argumentNames: stringArray.nullable(), config: stringArray.nullable(), sourceSha256: hash, definitionSha256: hash, acl }),
  domains: z.strictObject({ ...key, ...typeProperties, kind: z.literal("d"), category: z.string().length(1), baseType: typeRef, notNull: bool, defaultExpression: text.nullable() }),
  types: z.discriminatedUnion("form", [
    z.strictObject({ ...key, ...typeProperties, form: z.literal("table-composite"), kind: z.literal("c"), category: z.literal("C"), relation: ownedRelationRef,
      element: z.null(), baseType: z.null(), notNull: z.literal(false), defaultExpression: z.null() }),
    z.strictObject({ ...key, ...typeProperties, form: z.literal("generated-array"), kind: z.literal("b"), category: z.literal("A"), relation: z.null(),
      element: typeRef, baseType: z.null(), notNull: z.literal(false), defaultExpression: z.null() }),
  ]),
  defaultAcls: z.strictObject({ nativeOid: oid, owner: nativePrincipal, schema: z.enum(namespaces).nullable(), objectKind: z.enum(["r", "S", "f", "T", "n"]), acl }),
  dependencies: z.strictObject({ dependent: endpoint, referenced: endpoint, dependencyType: z.enum(["n", "a", "i", "e", "P", "S", "o", "r"] ) }),
  roles: z.strictObject({ nativeOid: oid, name: identifier, login: bool, superuser: bool, bypassRls: bool, inherit: bool,
    createRole: bool, createDb: bool, replication: bool, config: stringArray.nullable() }),
  memberships: z.strictObject({ nativeOid: oid, member: nativePrincipal, parent: nativePrincipal, grantor: nativePrincipal, admin: bool, inherit: bool, set: bool }),
} as const;
type RawCatalog = { [K in Category]: z.infer<typeof rawShapes[K]>[] };
type Principal = Readonly<{ kind: "migration-owner" | "bootstrap" }> | Readonly<{ kind: "reserved-role"; name: "dream_api" | "dream_worker" | "dream_upload_reserver" | "dream_api_login" | "dream_worker_login" }> | Readonly<{ kind: "public" }>;
type Normalize<T> = T extends { principalOid: string } ? Principal : T extends readonly (infer V)[] ? readonly Normalize<V>[] : T extends object ? { readonly [K in keyof T as K extends "nativeOid" | "catalog" | "defaultNativeOid" | "argumentTypeRefs" | "toast" | "toastNativeOid" ? never : K]: Normalize<T[K]> } : T;
type Q = Readonly<{ schema: string; name: string }>;
type F = Q & Readonly<{ argumentTypes: readonly Q[] }>;
type I = Readonly<{ relation: Q; name: string }>;
type C = Readonly<{ objectKind: "relation" | "domain"; object: Q; name: string }>;
type TriggerIdentity = Readonly<{ kind: "named"; relation: Q; name: string }> | Readonly<{ kind: "internal-constraint"; constraint: C; relation: Q; function: F; typeBits: number; constraintRelation: Q | null; constraintIndex: I | null }>;
type TriggerCommon = Normalize<Omit<RawCatalog["triggers"][number], "nativeOid" | "nativeName" | "parentTriggerOid" | "definition">> & Readonly<{ parentTrigger: TriggerIdentity | null }>;
export type CatalogTriggerObservationV3 = TriggerCommon & (Readonly<{ identity: Extract<TriggerIdentity,{kind:"named"}>; internal: false; definition: string }> | Readonly<{ identity: Extract<TriggerIdentity,{kind:"internal-constraint"}>; internal: true; constraint: C; structuralVersion: 1; structuralSha256: string }>);
export type CatalogRowsObservationV3 = { readonly [K in Exclude<Category, "triggers" | "roles" | "dependencies">]: Normalize<RawCatalog[K]> } & Readonly<{
  triggers: readonly CatalogTriggerObservationV3[];
  roles: readonly (Normalize<Omit<RawCatalog["roles"][number], "name">> & { readonly principal: Exclude<Principal,{kind:"public"}> })[];
  dependencies: readonly Readonly<{ dependent: string; referenced: string; dependencyType: string }>[];
}>;
const binding = z.strictObject({ nativeOid: oid, name: identifier });
const externalQ = z.strictObject({ schema: z.literal("pg_catalog"), name: identifier });
const authQ = z.strictObject({ schema: z.literal("auth"), name: z.literal("users") });
const externalKey = z.discriminatedUnion("kind", [
  externalQ.extend({ kind: z.literal("type") }), externalQ.extend({ kind: z.literal("collation") }), externalQ.extend({ kind: z.literal("opclass") }),
  externalQ.extend({ kind: z.literal("function"), argumentTypes: z.array(externalQ) }),
  externalQ.extend({ kind: z.literal("operator"), leftType: externalQ.nullable(), rightType: externalQ.nullable() }),
  authQ.extend({ kind: z.literal("relation") }), z.strictObject({ kind: z.literal("index"), relation: authQ, name: identifier }),
  z.strictObject({ kind: z.literal("column"), relation: authQ, ordinal: attr, name: z.literal("id") }),
  z.strictObject({ kind: z.literal("language"), name: z.enum(["sql", "plpgsql", "internal", "c"]) }),
  z.strictObject({ kind: z.literal("schema"), name: z.enum(["pg_catalog", "auth"]) }),
]);
const bindingsShape = z.strictObject({ roleProfile: z.enum(["none", "pair"]), migrationOwner: binding, bootstrap: binding,
  api: binding.extend({ name: z.literal("dream_api") }), worker: binding.extend({ name: z.literal("dream_worker") }),
  issuer: binding.extend({ name: z.literal("dream_upload_reserver") }), apiLogin: binding.extend({ name: z.literal("dream_api_login") }).nullable(),
  workerLogin: binding.extend({ name: z.literal("dream_worker_login") }).nullable(),
  externalFacts: z.array(z.strictObject({ endpoint, identity: externalKey })).max(2000),
});
export type CatalogManagementBindingsV3 = z.input<typeof bindingsShape>;
export type CatalogObservationV3 = Readonly<{ kind: "unvalidated-catalog-observation"; descriptorVersion: 1; serverMajor: 18;
  roleProfile: "none" | "pair"; approval: false; expectedCatalog: false; catalog: CatalogRowsObservationV3; canonicalJson: string; observationSha256: string;
  counts: Readonly<{ namedTriggers: number; internalTriggers: number }> }>;
export type CatalogReadPortV3 = { query(text: string, values: readonly unknown[]): Promise<{ rows: unknown }> };
const fail = (): never => { throw new PostgresCatalogObservationErrorV3(); };
const need = (ok: unknown) => { if (!ok) fail(); };
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value);
}
type Bindings = z.infer<typeof bindingsShape>;
const slots = ["migrationOwner", "bootstrap", "api", "worker", "issuer", "apiLogin", "workerLogin"] as const;
const kindClass = { schema: "pg_namespace", type: "pg_type", collation: "pg_collation", function: "pg_proc", operator: "pg_operator", opclass: "pg_opclass", relation: "pg_class", index: "pg_class", column: "pg_class", language: "pg_language" } as const;
function snapshotBindings(input: unknown): Bindings {
  assertPlainData(input); const b = bindingsShape.parse(input);
  need((b.roleProfile === "none" && b.apiLogin === null && b.workerLogin === null) || (b.roleProfile === "pair" && b.apiLogin !== null && b.workerLogin !== null));
  const present = slots.flatMap(s => b[s] ? [b[s]!] : []);
  need(new Set(present.map(s => s.nativeOid)).size === present.length && new Set(present.map(s => s.name)).size === present.length);
  const seen = new Set<string>(), identities = new Set<string>();
  for (const fact of b.externalFacts) {
    const k = `${fact.endpoint.class}:${fact.endpoint.nativeOid}:${fact.endpoint.subId}`;
    need(fact.endpoint.class === kindClass[fact.identity.kind] && !seen.has(k) && !identities.has(canonical(fact.identity)));
    need(fact.identity.kind === "column" ? fact.endpoint.subId === fact.identity.ordinal : fact.endpoint.subId === 0);
    seen.add(k); identities.add(canonical(fact.identity));
  }
  return frozen(b);
}
const nk = (cls: string, id: string, sub = 0) => `${cls}:${id}:${sub}`;
const q = (r: { schema: string; name: string }): Q => ({ schema: r.schema, name: r.name });
const contextShape = z.strictObject({ server_major: z.literal(18), search_path: z.literal("pg_catalog"), isolation: z.enum(["read committed", "repeatable read"]), read_only: z.enum(["on", "off"]) });
const inspectionContextSql = "SELECT pg_catalog.current_setting('server_version_num') AS server_version,pg_catalog.current_setting('search_path') AS search_path,pg_catalog.current_setting('transaction_isolation') AS isolation,pg_catalog.current_setting('transaction_read_only') AS read_only";
const initialContextShape = z.strictObject({ server_version: z.string().length(6).regex(/^18[0-9]{4}$/), search_path: z.literal("pg_catalog"), isolation: z.enum(["read committed", "repeatable read"]), read_only: z.enum(["on", "off"]) });
function decodeRows(input: unknown) {
  need(input !== null && typeof input === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
  const descriptors = Object.getOwnPropertyDescriptors(input);
  need(Reflect.ownKeys(descriptors).length === categories.length && Reflect.ownKeys(descriptors).every(k => typeof k === "string" && categories.includes(k as Category)));
  for (const category of categories) { const d = descriptors[category]; need(d && Object.hasOwn(d, "value") && d.enumerable); assertPlainData(d.value); }
  const root = z.strictObject(Object.fromEntries(categories.map(k => [k, z.array(z.unknown()).max(10000)]))).parse(input) as Record<Category, unknown[]>;
  const bag: Partial<Record<Category, unknown>> = {};
  let context: z.infer<typeof contextShape> | undefined;
  for (const category of categories) {
    bag[category] = root[category].map(value => {
      const wrapper = contextShape.extend({ catalog_row: z.unknown() }).parse(value);
      const { catalog_row: row, ...meta } = wrapper;
      if (context) need(canonical(context) === canonical(meta)); else context = meta;
      return rawShapes[category].parse(row);
    });
  }
  const raw = bag as RawCatalog;
  need(raw.schemas.length === 3 && new Set(raw.schemas.map(r => r.name)).size === 3 && context !== undefined);
  return { raw, context: context! };
}
function normalize(raw: RawCatalog, bindings: Bindings): CatalogRowsObservationV3 {
  const registry = new Map<string, unknown>(), semantic = new Map<string, string>(), observed = new Set<string>();
  function register(cls: string, id: string, identity: unknown, sub = 0, external = false) {
    const native = nk(cls, id, sub), stable = canonical(identity);
    if (external) need(!registry.has(native));
    else { need(!observed.has(native)); observed.add(native); }
    if (registry.has(native)) need(canonical(registry.get(native)) === stable);
    const other = semantic.get(stable); need(!other || other === native);
    registry.set(native, identity); semantic.set(stable, native);
  }
  for (const fact of bindings.externalFacts) register(fact.endpoint.class, fact.endpoint.nativeOid, fact.identity, fact.endpoint.subId, true);
  const principals = new Map<string, Principal>([["0", { kind: "public" }]]);
  for (const slot of slots) {
    const v = bindings[slot]; if (!v) continue;
    const identity: Principal = slot === "migrationOwner" ? { kind: "migration-owner" } : slot === "bootstrap" ? { kind: "bootstrap" } : { kind: "reserved-role", name: v.name as Extract<Principal, {kind:"reserved-role"}>["name"] };
    principals.set(v.nativeOid, identity); register("pg_authid", v.nativeOid, { kind: "principal", principal: identity });
  }
  const principal = (id: string, allowPublic = false): Principal => { const p = principals.get(id); need(p && (allowPublic || id !== "0")); return p!; };
  for (const row of raw.schemas) register("pg_namespace", row.nativeOid, { kind: "schema", name: row.name });
  for (const row of raw.relations) {
    register("pg_class", row.nativeOid, { kind: "relation", ...q(row) });
    need((row.toastNativeOid === null) === (row.toast === null));
    if (row.toast) {
      need(row.toastNativeOid === row.toast.nativeOid && row.toast.owner.principalOid === bindings.migrationOwner.nativeOid && row.toast.indexOwner.principalOid === bindings.migrationOwner.nativeOid && row.toast.parents[0] === row.nativeOid && row.toast.indexParentOid === row.toast.nativeOid);
      register("pg_class", row.toast.nativeOid, { kind: "table-toast", relation: q(row) });
      register("pg_class", row.toast.indexOid, { kind: "table-toast-index", relation: q(row) });
    }
  }
  for (const row of [...raw.types, ...raw.domains]) register("pg_type", row.nativeOid, { kind: "type", ...q(row) });
  for (const row of raw.indexes) {
    need((row.scope === "owned") === namespaces.includes(row.relation.schema as typeof namespaces[number]));
    if (row.scope === "external-prerequisite") need(registry.has(nk("pg_class", row.nativeOid)) && raw.constraints.some(c => c.kind === "f" && c.supportingIndex?.nativeOid === row.nativeOid));
    register("pg_class", row.nativeOid, { kind: "index", relation: q(row.relation), name: row.name });
  }
  for (const row of raw.functions) register("pg_proc", row.nativeOid, { kind: "function", ...q(row), argumentTypes: row.argumentTypeRefs.map(q) });
  for (const row of raw.constraints) {
    need(row.nativeOid === row.identity.nativeOid && row.identity.object.catalog === (row.identity.objectKind === "domain" ? "pg_type" : "pg_class"));
    register("pg_constraint", row.nativeOid, { kind: "constraint", objectKind: row.identity.objectKind, object: q(row.identity.object), name: row.identity.name });
  }
  const columns = new Set<string>();
  for (const row of raw.columns) {
    const id = nk("pg_class", row.relation.nativeOid, row.ordinal); need(!columns.has(id)); columns.add(id);
    register("pg_class", row.relation.nativeOid, { kind: "column", relation: q(row.relation), ordinal: row.ordinal, name: row.name }, row.ordinal);
    if (row.defaultNativeOid) register("pg_attrdef", row.defaultNativeOid, { kind: "column-default", relation: q(row.relation), ordinal: row.ordinal, name: row.name });
    need((row.defaultNativeOid === null) === (row.defaultExpression === null));
  }
  for (const row of raw.policies) register("pg_policy", row.nativeOid, { kind: "policy", relation: q(row.relation), name: row.name });
  for (const row of raw.defaultAcls) register("pg_default_acl", row.nativeOid, { kind: "default-acl", owner: principal(row.owner.principalOid), schema: row.schema, objectKind: row.objectKind });
  function ref(value: Record<string, unknown>): unknown {
    const native = value.nativeOid as string, cls = value.catalog as string;
    let result: object, identity: object;
    if (cls === "pg_constraint") {
      const object = walk(value.object); result = { objectKind: value.objectKind, object, name: value.name }; identity = { kind: "constraint", ...result };
    } else if (cls === "pg_class" && Object.hasOwn(value, "relation")) {
      result = { relation: walk(value.relation), name: value.name }; identity = { kind: "index", ...result };
    } else if (cls === "pg_proc") {
      result = { schema: value.schema, name: value.name, argumentTypes: walk(value.argumentTypes) }; identity = { kind: "function", ...result };
    } else if (cls === "pg_operator") {
      result = { schema: value.schema, name: value.name, leftType: walk(value.leftType), rightType: walk(value.rightType) }; identity = { kind: "operator", ...result };
    } else {
      result = { schema: value.schema, name: value.name }; identity = { kind: cls === "pg_type" ? "type" : cls === "pg_collation" ? "collation" : "relation", ...result };
    }
    need(registry.has(nk(cls, native)) && canonical(registry.get(nk(cls, native))) === canonical(identity));
    return result;
  }
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== "object") return value;
    const v = value as Record<string, unknown>;
    if (Object.hasOwn(v, "principalOid")) return principal(v.principalOid as string, true);
    if (Object.hasOwn(v, "catalog")) return ref(v);
    const result = Object.fromEntries(Object.entries(v).filter(([k]) => !["nativeOid", "defaultNativeOid", "argumentTypeRefs", "toast", "toastNativeOid"].includes(k)).map(([k, val]) => [k, walk(val)]));
    if (Object.hasOwn(v, "acl")) {
      const source = v.acl as z.infer<typeof acl>, items = source.map(a => ({ ...a, grantor: principal(a.grantor.principalOid), grantee: principal(a.grantee.principalOid, true) }));
      result.acl = sortedUnique(items, item => canonical(item));
    }
    if (Object.hasOwn(v, "owner")) result.owner = principal((v.owner as {principalOid:string}).principalOid);
    if (Object.hasOwn(v, "roles")) result.roles = sortedUnique((v.roles as {principalOid:string}[]).map(v => principal(v.principalOid, true)), canonical);
    return result;
  }
  for (const f of raw.functions) {
    need(f.argumentTypes.length === f.argumentTypeRefs.length);
    for (const argument of f.argumentTypeRefs) walk(argument);
    const allCount = f.allArgumentTypes?.length ?? f.argumentTypes.length;
    need(allCount >= f.argumentTypes.length && (f.argumentNames === null || f.argumentNames.length === allCount) && (f.argumentModes === null || f.argumentModes.length === allCount));
  }
  const byType = new Map([...raw.types, ...raw.domains].map(t => [t.nativeOid, t]));
  const byRelation = new Map(raw.relations.map(r => [r.nativeOid, r]));
  for (const row of raw.relations) {
    const t = byType.get(row.rowType.nativeOid); need(t && "form" in t && t.form === "table-composite" && t.relation?.nativeOid === row.nativeOid);
  }
  for (const t of byType.values()) {
    if ("form" in t && t.form === "generated-array") {
      const element = byType.get(t.element.nativeOid); need(element && element.arrayType?.nativeOid === t.nativeOid);
    } else {
      need(t.arrayType !== null); const array = byType.get(t.arrayType!.nativeOid);
      need(array && "form" in array && array.form === "generated-array" && array.element.nativeOid === t.nativeOid);
      if ("form" in t) need(byRelation.get(t.relation.nativeOid)?.rowType.nativeOid === t.nativeOid);
    }
  }
  const constraintMap = new Map(raw.constraints.map(c => [c.nativeOid, c]));
  const indexRows = new Map(raw.indexes.map(i => [i.nativeOid, i]));
  noParentCycles(raw.constraints, c => c.nativeOid, c => c.parentConstraint?.nativeOid ?? null);
  for (const c of raw.constraints) {
    need(c.parentConstraint === null); // Current nonpartitioned publication contract.
    if (c.supportingIndex) {
      const index = indexRows.get(c.supportingIndex.nativeOid); need(index);
      need(index!.relation.nativeOid === (c.kind === "f" ? c.referencedRelation?.nativeOid : c.identity.object.nativeOid));
    }
    if (c.kind === "f") need(c.referencedRelation && c.supportingIndex && c.keyColumns?.length && c.referencedColumns?.length === c.keyColumns.length && c.fkPrimaryForeignOperators?.length === c.keyColumns.length && c.fkPrimaryPrimaryOperators?.length === c.keyColumns.length && c.fkForeignForeignOperators?.length === c.keyColumns.length);
    if (c.kind === "p" || c.kind === "u") need(c.supportingIndex && c.keyColumns?.length);
  }
  const triggerMap = new Map(raw.triggers.map(t => [t.nativeOid, t]));
  need(triggerMap.size === raw.triggers.length);
  noParentCycles(raw.triggers, t => t.nativeOid, t => t.parentTriggerOid);
  const identities = new Map<string, TriggerIdentity>();
  for (const t of raw.triggers) {
    need(t.parentTriggerOid === null);
    const parent = t.constraint ? constraintMap.get(t.constraint.nativeOid) : undefined;
    if (t.internal) need(parent?.kind === "f");
    else {
      need(namespaces.includes(t.relation.schema as typeof namespaces[number]));
      if (t.constraint) need(parent?.kind === "t" && parent.identity.name === t.nativeName && parent.identity.object.nativeOid === t.relation.nativeOid);
    }
    const argumentBytes = Buffer.from(t.argsHex, "hex");
    need(argumentBytes.filter(byte => byte === 0).length === t.argumentCount && (t.argumentCount === 0 ? argumentBytes.length === 0 : argumentBytes.at(-1) === 0));
    const identity: TriggerIdentity = t.internal ? { kind: "internal-constraint", constraint: walk(t.constraint) as C, relation: walk(t.relation) as Q,
      function: walk(t.function) as F, typeBits: t.typeBits, constraintRelation: walk(t.constraintRelation) as Q | null, constraintIndex: walk(t.constraintIndex) as I | null }
      : { kind: "named", relation: walk(t.relation) as Q, name: t.nativeName };
    identities.set(t.nativeOid, identity); register("pg_trigger", t.nativeOid, { kind: "trigger", identity });
  }
  for (const c of raw.constraints) {
    if (c.kind === "t") need(raw.triggers.filter(t => !t.internal && t.constraint?.nativeOid === c.nativeOid).length === 1);
    if (c.kind === "f") {
      const children = raw.triggers.filter(t => t.internal && t.constraint.nativeOid === c.nativeOid);
      need(children.length === 4);
      for (const name of ["RI_FKey_check_ins", "RI_FKey_check_upd"]) need(children.filter(t => t.function.schema === "pg_catalog" && t.function.name === name && t.relation.nativeOid === c.identity.object.nativeOid).length === 1);
      const actions = { a: "noaction", r: "restrict", c: "cascade", n: "setnull", d: "setdefault" } as const;
      const deletion = actions[c.deleteAction as keyof typeof actions], update = actions[c.updateAction as keyof typeof actions]; need(deletion && update);
      for (const [name, relation, other, bits] of [
        ["RI_FKey_check_ins", c.identity.object.nativeOid, c.referencedRelation!.nativeOid, 5],
        ["RI_FKey_check_upd", c.identity.object.nativeOid, c.referencedRelation!.nativeOid, 17],
        [`RI_FKey_${deletion}_del`, c.referencedRelation!.nativeOid, c.identity.object.nativeOid, 9],
        [`RI_FKey_${update}_upd`, c.referencedRelation!.nativeOid, c.identity.object.nativeOid, 17],
      ] as const) need(children.filter(t => t.function.schema === "pg_catalog" && t.function.name === name && t.relation.nativeOid === relation && t.constraintRelation?.nativeOid === other && t.constraintIndex?.nativeOid === c.supportingIndex!.nativeOid && t.typeBits === bits).length === 1);
    }
  }
  checkRoles(raw, bindings);
  const output: Partial<Record<Category, unknown>> = {};
  for (const category of categories) {
    if (category === "triggers") {
      output.triggers = raw.triggers.map(t => {
        const { nativeOid: id, nativeName: _name, parentTriggerOid: _parent, definition, ...properties } = t;
        void _name; void _parent;
        const common = { ...walk(properties) as object, parentTrigger: null, identity: identities.get(id)! };
        return t.internal ? { ...common, structuralVersion: 1, structuralSha256: sha("internal-trigger:v1\n" + canonical({ ...common, structuralVersion: 1 })) } : { ...common, definition };
      });
    } else if (category === "roles") output.roles = raw.roles.map(({ nativeOid: id, name: _name, ...flags }) => { void _name; return { ...flags, principal: principal(id) }; });
    else if (category === "dependencies") output.dependencies = raw.dependencies.map(d => {
      const resolve = (e: z.infer<typeof endpoint>) => { const identity = registry.get(nk(e.class, e.nativeOid, e.subId)); need(identity); return canonical(identity); };
      return { dependent: resolve(d.dependent), referenced: resolve(d.referenced), dependencyType: d.dependencyType };
    });
    else output[category] = raw[category].map(walk);
    output[category] = sortedUnique(output[category] as unknown[], canonical);
  }
  return output as CatalogRowsObservationV3;
}
function sortedUnique<T>(rows: T[], key: (row: T) => string): T[] {
  const keys = rows.map(key); need(new Set(keys).size === keys.length);
  return rows.map((row, i) => ({ row, key: keys[i] })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(r => r.row);
}
function noParentCycles<T>(rows: T[], id: (r: T) => string, parent: (r: T) => string | null) {
  const map = new Map(rows.map(r => [id(r), r])); need(map.size === rows.length);
  for (const row of rows) { const visited = new Set<string>(); let next: T | undefined = row;
    while (next !== undefined) { const key = id(next); need(!visited.has(key)); visited.add(key); const p = parent(next); if (p === null) break; need(map.has(p)); next = map.get(p); }
  }
}
function checkRoles(raw: RawCatalog, b: Bindings) {
  const present = slots.flatMap(s => b[s] ? [{ slot: s, value: b[s]! }] : []);
  need(raw.roles.length === present.length && new Set(raw.roles.map(r => r.nativeOid)).size === present.length);
  for (const { slot, value } of present) {
    const r = raw.roles.find(r => r.nativeOid === value.nativeOid); need(r && r.name === value.name);
    if (slot === "bootstrap") need(r!.superuser && r!.login);
    else if (slot === "migrationOwner") need(r!.login && r!.createRole && !r!.superuser && !r!.bypassRls && !r!.inherit && !r!.replication);
    else need(!r!.superuser && !r!.bypassRls && !r!.inherit && !r!.createRole && !r!.createDb && !r!.replication && r!.login === (slot === "apiLogin" || slot === "workerLogin"));
  }
  need(new Set(raw.memberships.map(r => r.nativeOid)).size === raw.memberships.length);
  const expected = [b.api, b.worker, b.issuer].map(r => [b.migrationOwner.nativeOid, r.nativeOid, b.bootstrap.nativeOid, true, false, false]);
  if (b.roleProfile === "pair") expected.push([b.apiLogin!.nativeOid, b.api.nativeOid, b.bootstrap.nativeOid, false, false, true], [b.workerLogin!.nativeOid, b.worker.nativeOid, b.bootstrap.nativeOid, false, false, true]);
  need(canonical(raw.memberships.map(r => canonical([r.member.principalOid, r.parent.principalOid, r.grantor.principalOid, r.admin, r.inherit, r.set])).sort()) === canonical(expected.map(canonical).sort()));
  const definers = raw.functions.filter(r => r.securityDefiner);
  need(definers.length === 2);
  for (const name of ["read_upload_seed_v1", "reserve_upload_v1"]) {
    const f = definers.find(f => f.schema === "dream_reservation" && f.name === name); need(f && f.owner.principalOid === b.issuer.nativeOid && f.volatility === "v" && canonical(f.config) === '["search_path=pg_catalog, pg_temp","row_security=on"]');
  }
  need(raw.functions.filter(f => f.owner.principalOid === b.issuer.nativeOid).length === 2);
  for (const row of [...raw.schemas, ...raw.relations, ...raw.types, ...raw.domains]) need(row.owner.principalOid === b.migrationOwner.nativeOid);
  for (const f of raw.functions) {
    if (!f.securityDefiner) need(f.owner.principalOid === b.migrationOwner.nativeOid);
    const owner = f.securityDefiner ? b.issuer.nativeOid : b.migrationOwner.nativeOid;
    for (const a of f.acl) need(a.grantor.principalOid === owner && a.privilege === "EXECUTE");
    if (f.securityDefiner) {
      need(canonical(f.argumentTypeRefs.map(t => q(t))) === canonical((f.name === "read_upload_seed_v1" ? ["uuid", "text"] : ["uuid", "text", "text"]).map(name => ({ schema: "pg_catalog", name }))));
      need(f.acl.some(a => a.grantee.principalOid === b.api.nativeOid) && f.acl.every(a => [b.issuer.nativeOid, b.api.nativeOid].includes(a.grantee.principalOid) && (!a.grantable || a.grantee.principalOid === owner)));
    }
  }
  for (const row of [...raw.schemas, ...raw.relations, ...raw.columns, ...raw.types, ...raw.domains]) for (const a of row.acl) need(a.grantor.principalOid === b.migrationOwner.nativeOid);
}
/** Pure strict observation decoder. It never constructs an expected descriptor. */
export function decodePostgresCatalogObservationV3(input: unknown, managementBindings: unknown): CatalogObservationV3 {
  try {
    const b = snapshotBindings(managementBindings), { raw } = decodeRows(input), catalog = normalize(raw, b);
    const canonicalJson = canonical({ descriptorVersion: 1, serverMajor: 18, roleProfile: b.roleProfile, ...catalog });
    return frozen({ kind: "unvalidated-catalog-observation", descriptorVersion: 1, serverMajor: 18, roleProfile: b.roleProfile,
      approval: false, expectedCatalog: false, catalog, canonicalJson, observationSha256: sha("catalog-observation:v3\n" + canonicalJson),
      counts: { namedTriggers: raw.triggers.filter(t => !t.internal).length, internalTriggers: raw.triggers.filter(t => t.internal).length } });
  } catch { throw new PostgresCatalogObservationErrorV3(); }
}
// Pure fixed SQL construction, not a public SQL builder or execution callback.
let alias = 0;
const scopeSql = "('dream','dream_reservation','dream_migrations')";
const jsonSql = (fields: Record<string, string>) => "pg_catalog.jsonb_build_object(" + Object.entries(fields).map(([key, value]) => `'${key}',${value}`).join(",") + ")";
const principalSql = (expr: string) => jsonSql({ principalOid: `(${expr})::text` });
function qualifiedSql(expr: string, kind: "pg_class" | "pg_type" | "pg_collation") {
  const a = `q${++alias}`, n = `n${alias}`, prefix = kind === "pg_class" ? "rel" : kind === "pg_type" ? "typ" : "coll";
  return `(SELECT ${jsonSql({ nativeOid: `${a}.oid::text`, catalog: `'${kind}'`, schema: `${n}.nspname`, name: `${a}.${prefix}name` })} FROM pg_catalog.${kind} ${a} JOIN pg_catalog.pg_namespace ${n} ON ${n}.oid=${a}.${prefix}namespace WHERE ${a}.oid=(${expr}))`;
}
const qr = (expr: string) => qualifiedSql(expr, "pg_class"), qt = (expr: string) => qualifiedSql(expr, "pg_type"), qc = (expr: string) => qualifiedSql(expr, "pg_collation");
function functionSql(expr: string) {
  const a = `f${++alias}`, n = `n${alias}`, arg = `a${alias}`;
  const args = `(SELECT coalesce(jsonb_agg(${qt(`${arg}.id`)} ORDER BY ${arg}.ord),'[]'::jsonb) FROM unnest(${a}.proargtypes::oid[]) WITH ORDINALITY ${arg}(id,ord))`;
  return `(SELECT ${jsonSql({ nativeOid: `${a}.oid::text`, catalog: "'pg_proc'", schema: `${n}.nspname`, name: `${a}.proname`, argumentTypes: args })} FROM pg_catalog.pg_proc ${a} JOIN pg_catalog.pg_namespace ${n} ON ${n}.oid=${a}.pronamespace WHERE ${a}.oid=(${expr}))`;
}
function operatorSql(expr: string) {
  const a = `o${++alias}`, n = `n${alias}`;
  return `(SELECT ${jsonSql({ nativeOid: `${a}.oid::text`, catalog: "'pg_operator'", schema: `${n}.nspname`, name: `${a}.oprname`, leftType: qt(`${a}.oprleft`), rightType: qt(`${a}.oprright`) })} FROM pg_catalog.pg_operator ${a} JOIN pg_catalog.pg_namespace ${n} ON ${n}.oid=${a}.oprnamespace WHERE ${a}.oid=(${expr}))`;
}
function indexSql(expr: string) {
  const a = `i${++alias}`, x = `x${alias}`;
  return `(SELECT ${jsonSql({ nativeOid: `${a}.oid::text`, catalog: "'pg_class'", relation: qr(`${x}.indrelid`), name: `${a}.relname` })} FROM pg_catalog.pg_class ${a} JOIN pg_catalog.pg_index ${x} ON ${x}.indexrelid=${a}.oid WHERE ${a}.oid=(${expr}))`;
}
function constraintSql(expr: string) {
  const a = `k${++alias}`;
  return `(SELECT ${jsonSql({ nativeOid: `${a}.oid::text`, catalog: "'pg_constraint'", objectKind: `CASE WHEN ${a}.conrelid=0 THEN 'domain' ELSE 'relation' END`, object: `CASE WHEN ${a}.conrelid=0 THEN ${qt(`${a}.contypid`)} ELSE ${qr(`${a}.conrelid`)} END`, name: `${a}.conname` })} FROM pg_catalog.pg_constraint ${a} WHERE ${a}.oid=(${expr}))`;
}
function aclSql(expr: string, fallback = "'{}'::aclitem[]") {
  const a = `a${++alias}`;
  return `(SELECT coalesce(jsonb_agg(${jsonSql({ grantor: principalSql(`${a}.grantor`), grantee: principalSql(`${a}.grantee`), privilege: `${a}.privilege_type`, grantable: `${a}.is_grantable` })}),'[]'::jsonb) FROM pg_catalog.aclexplode(coalesce(${expr},${fallback})) ${a})`;
}
function refArray(expr: string, render: (v: string) => string) {
  const a = `v${++alias}`;
  return `CASE WHEN ${expr} IS NULL THEN NULL ELSE (SELECT coalesce(jsonb_agg(${render(`${a}.id`)} ORDER BY ${a}.ord),'[]'::jsonb) FROM unnest(${expr}) WITH ORDINALITY ${a}(id,ord)) END`;
}
const primitiveArgs = (expr: string) => `CASE WHEN ${expr} IS NULL THEN NULL ELSE ARRAY(SELECT pg_catalog.format_type(a,NULL) FROM unnest(${expr}) a) END`;
// Bind all three immutable OID arrays even for a projection needing no filter.
const selectSql = (fields: Record<string, string>, from: string) => `SELECT (SELECT current_setting('server_version_num')::integer/10000 WHERE $1::oid[] IS NOT NULL AND $2::oid[] IS NOT NULL AND $3::oid[] IS NOT NULL) AS server_major,current_setting('search_path') AS search_path,current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only,${jsonSql(fields)} AS catalog_row ${from}`;
const scopeObjects = `WITH owned_rel AS(SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${scopeSql}),
 owned_con AS(SELECT k.* FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN ${scopeSql}),
 scoped_triggers AS(SELECT t.* FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN(SELECT oid FROM owned_rel) OR t.tgconstraint IN(SELECT oid FROM owned_con)),
 scoped_indexes AS(SELECT x.* FROM pg_catalog.pg_index x WHERE x.indrelid IN(SELECT oid FROM owned_rel) OR x.indexrelid=ANY($3::oid[]))`;
const membershipGraph = `WITH RECURSIVE reachable(oid) AS(SELECT unnest($1::oid[]) UNION SELECT m.roleid FROM pg_catalog.pg_auth_members m JOIN reachable r ON r.oid=m.member) SELECT m.* FROM pg_catalog.pg_auth_members m WHERE m.member IN(SELECT oid FROM reachable) OR m.roleid=ANY($1::oid[])`;
const typeFields = {
  nativeOid: "t.oid::text", schema: "n.nspname", name: "t.typname", owner: principalSql("t.typowner"), defined: "t.typisdefined", preferred: "t.typispreferred",
  length: "t.typlen", byValue: "t.typbyval", delimiter: "t.typdelim", alignment: "t.typalign", storage: "t.typstorage", typeModifier: "t.typtypmod", dimensions: "t.typndims",
  collation: qc("t.typcollation"), arrayType: qt("t.typarray"), aclIsNull: "t.typacl IS NULL", acl: aclSql("t.typacl", "pg_catalog.acldefault('T',t.typowner)"),
  input: functionSql("t.typinput"), output: functionSql("t.typoutput"), receive: functionSql("t.typreceive"), send: functionSql("t.typsend"),
  modifierInput: functionSql("t.typmodin"), modifierOutput: functionSql("t.typmodout"), analyze: functionSql("t.typanalyze"), subscript: functionSql("t.typsubscript"),
  kind: "t.typtype", category: "t.typcategory", baseType: qt("t.typbasetype"), notNull: "t.typnotnull", defaultExpression: "t.typdefault",
};
const endpointSql = (cls: string, obj: string, sub: string) => jsonSql({ class: `(${cls})::regclass::text`, nativeOid: `(${obj})::text`, subId: sub });
export const postgresCatalogQueriesV3 = Object.freeze({
  schemas: selectSql({ nativeOid: "n.oid::text", name: "n.nspname", owner: principalSql("n.nspowner"), acl: aclSql("n.nspacl", "pg_catalog.acldefault('n',n.nspowner)") }, `FROM pg_catalog.pg_namespace n WHERE n.nspname IN ${scopeSql}`),
  relations: selectSql({ nativeOid: "c.oid::text", schema: "n.nspname", name: "c.relname", kind: "c.relkind", owner: principalSql("c.relowner"), rls: "c.relrowsecurity", forceRls: "c.relforcerowsecurity", persistence: "c.relpersistence", replicaIdentity: "c.relreplident", isPartition: "c.relispartition", rowType: qt("c.reltype"), ofType: qt("c.reloftype"), options: "c.reloptions", acl: aclSql("c.relacl", "pg_catalog.acldefault('r',c.relowner)"),
    toastNativeOid: "nullif(c.reltoastrelid,0)::text",
    toast: `(SELECT ${jsonSql({ nativeOid: "tc.oid::text", indexOid: "ti.indexrelid::text", owner: principalSql("tc.relowner"), indexOwner: principalSql("ic.relowner"), namespace: "tn.nspname", relationKind: "tc.relkind", indexKind: "ic.relkind", unique: "ti.indisunique", parents: "ARRAY(SELECT d.refobjid::text FROM pg_catalog.pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=tc.oid AND d.refclassid='pg_class'::regclass AND d.deptype='i')", indexParentOid: "ti.indrelid::text" })} FROM pg_catalog.pg_class tc JOIN pg_catalog.pg_namespace tn ON tn.oid=tc.relnamespace JOIN pg_catalog.pg_index ti ON ti.indrelid=tc.oid JOIN pg_catalog.pg_class ic ON ic.oid=ti.indexrelid WHERE tc.oid=c.reltoastrelid)` },
  `FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${scopeSql} AND c.relkind NOT IN('i','I','t')`),
  columns: selectSql({ relation: qr("a.attrelid"), ordinal: "a.attnum", name: "a.attname", type: "pg_catalog.format_type(a.atttypid,a.atttypmod)", notNull: "a.attnotnull", identity: "a.attidentity", generated: "a.attgenerated", dropped: "a.attisdropped", defaultNativeOid: "d.oid::text", defaultExpression: "pg_catalog.pg_get_expr(d.adbin,d.adrelid,false)", collation: "CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END", acl: aclSql("a.attacl") },
  `FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname IN ${scopeSql} AND c.relkind NOT IN('i','I','t') AND a.attnum>0`),
  constraints: selectSql({ nativeOid: "k.oid::text", identity: constraintSql("k.oid"), kind: "k.contype", deferrable: "k.condeferrable", initiallyDeferred: "k.condeferred", enforced: "k.conenforced", validated: "k.convalidated", local: "k.conislocal", inheritedCount: "k.coninhcount", noInherit: "k.connoinherit", period: "k.conperiod", parentConstraint: constraintSql("k.conparentid"), supportingIndex: indexSql("k.conindid"), referencedRelation: qr("k.confrelid"), keyColumns: "k.conkey", referencedColumns: "k.confkey", updateAction: "k.confupdtype", deleteAction: "k.confdeltype", matchType: "k.confmatchtype", deleteSetColumns: "k.confdelsetcols", fkPrimaryForeignOperators: refArray("k.conpfeqop", operatorSql), fkPrimaryPrimaryOperators: refArray("k.conppeqop", operatorSql), fkForeignForeignOperators: refArray("k.conffeqop", operatorSql), exclusionOperators: refArray("k.conexclop", operatorSql), expression: "pg_catalog.pg_get_expr(k.conbin,k.conrelid,false)", definition: "pg_catalog.pg_get_constraintdef(k.oid,false)" },
  `FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN ${scopeSql}`),
  indexes: selectSql({ nativeOid: "i.oid::text", relation: qr("x.indrelid"), scope: `CASE WHEN n.nspname IN ${scopeSql} THEN 'owned' ELSE 'external-prerequisite' END`, name: "i.relname", unique: "x.indisunique", primary: "x.indisprimary", valid: "x.indisvalid", ready: "x.indisready", live: "x.indislive", immediate: "x.indimmediate", nullsNotDistinct: "x.indnullsnotdistinct", accessMethod: "am.amname", keyColumns: "ARRAY(SELECT k.id FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(id,ord) WHERE k.ord<=x.indnkeyatts ORDER BY k.ord)", includeColumns: "ARRAY(SELECT k.id FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(id,ord) WHERE k.ord>x.indnkeyatts ORDER BY k.ord)", opclasses: "ARRAY(SELECT ns.nspname||'.'||o.opcname FROM unnest(x.indclass::oid[]) WITH ORDINALITY k(id,ord) JOIN pg_catalog.pg_opclass o ON o.oid=k.id JOIN pg_catalog.pg_namespace ns ON ns.oid=o.opcnamespace ORDER BY k.ord)", collations: "ARRAY(SELECT CASE WHEN k.id=0 THEN NULL ELSE k.id::regcollation::text END FROM unnest(x.indcollation::oid[]) WITH ORDINALITY k(id,ord) ORDER BY k.ord)", options: "x.indoption::smallint[]", expressions: "pg_catalog.pg_get_expr(x.indexprs,x.indrelid,false)", predicate: "pg_catalog.pg_get_expr(x.indpred,x.indrelid,false)", definition: "pg_catalog.pg_get_indexdef(i.oid,0,false)" },
  `FROM (${scopeObjects} SELECT * FROM scoped_indexes) x JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_class c ON c.oid=x.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_am am ON am.oid=i.relam`),
  policies: selectSql({ nativeOid: "p.oid::text", relation: qr("p.polrelid"), name: "p.polname", permissive: "p.polpermissive", command: "p.polcmd", roles: `(SELECT jsonb_agg(${principalSql("r.id")}) FROM unnest(p.polroles) r(id))`, usingExpression: "pg_catalog.pg_get_expr(p.polqual,p.polrelid,false)", checkExpression: "pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,false)" },
  `FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${scopeSql}`),
  triggers: selectSql({ nativeOid: "t.oid::text", nativeName: "t.tgname", relation: qr("t.tgrelid"), enabled: "t.tgenabled", typeBits: "t.tgtype", deferrable: "t.tgdeferrable", initiallyDeferred: "t.tginitdeferred", function: functionSql("t.tgfoid"), constraint: constraintSql("t.tgconstraint"), constraintRelation: qr("t.tgconstrrelid"), constraintIndex: indexSql("t.tgconstrindid"), parentTriggerOid: "nullif(t.tgparentid,0)::text", argumentCount: "t.tgnargs", columns: "t.tgattr::smallint[]", argsHex: "encode(t.tgargs,'hex')", whenExpression: "pg_catalog.pg_get_expr(t.tgqual,t.tgrelid,false)", oldTransitionTable: "t.tgoldtable", newTransitionTable: "t.tgnewtable", internal: "t.tgisinternal", definition: "CASE WHEN t.tgisinternal THEN NULL ELSE pg_catalog.pg_get_triggerdef(t.oid,false) END" },
  `FROM (${scopeObjects} SELECT * FROM scoped_triggers) t`),
  functions: selectSql({ nativeOid: "p.oid::text", schema: "n.nspname", name: "p.proname", identityArgs: "pg_catalog.pg_get_function_identity_arguments(p.oid)", declaredArgs: "pg_catalog.pg_get_function_arguments(p.oid)", result: "pg_catalog.pg_get_function_result(p.oid)", language: "l.lanname", owner: principalSql("p.proowner"), kind: "p.prokind", securityDefiner: "p.prosecdef", leakproof: "p.proleakproof", strict: "p.proisstrict", returnsSet: "p.proretset", volatility: "p.provolatile", parallel: "p.proparallel", argumentTypes: primitiveArgs("p.proargtypes::oid[]"), argumentTypeRefs: refArray("p.proargtypes::oid[]", qt), allArgumentTypes: primitiveArgs("p.proallargtypes"), argumentModes: "p.proargmodes", argumentNames: "p.proargnames", config: "p.proconfig", sourceSha256: "encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')", definitionSha256: "encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')", acl: aclSql("p.proacl", "pg_catalog.acldefault('f',p.proowner)") },
  `FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname IN ${scopeSql}`),
  domains: selectSql(typeFields, `FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ${scopeSql} AND t.typtype='d'`),
  types: selectSql({ ...typeFields, form: "CASE WHEN t.typtype='c' THEN 'table-composite' WHEN t.typtype='b' AND t.typcategory='A' THEN 'generated-array' ELSE 'unsupported' END", relation: qr("t.typrelid"), element: qt("t.typelem") },
  `FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ${scopeSql} AND t.typtype<>'d'`),
  defaultAcls: selectSql({ nativeOid: "d.oid::text", owner: principalSql("d.defaclrole"), schema: "n.nspname", objectKind: "d.defaclobjtype", acl: aclSql("d.defaclacl") },
  `FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclrole=ANY($1::oid[]) OR n.nspname IN ${scopeSql}`),
  dependencies: selectSql({ dependent: endpointSql("d.classid", "d.objid", "d.objsubid"), referenced: endpointSql("d.refclassid", "d.refobjid", "d.refobjsubid"), dependencyType: "d.deptype" },
  `FROM (${scopeObjects}, obj(classid,id) AS(
    SELECT 'pg_namespace'::regclass,n.oid FROM pg_catalog.pg_namespace n WHERE n.nspname IN ${scopeSql}
    UNION SELECT 'pg_class'::regclass,oid FROM owned_rel
    UNION SELECT 'pg_class'::regclass,reltoastrelid FROM owned_rel WHERE reltoastrelid<>0
    UNION SELECT 'pg_class'::regclass,x.indexrelid FROM pg_catalog.pg_index x WHERE x.indrelid IN(SELECT reltoastrelid FROM owned_rel WHERE reltoastrelid<>0)
    UNION SELECT 'pg_class'::regclass,indexrelid FROM scoped_indexes
    UNION SELECT 'pg_type'::regclass,t.oid FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ${scopeSql}
    UNION SELECT 'pg_proc'::regclass,p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ${scopeSql}
    UNION SELECT 'pg_constraint'::regclass,oid FROM owned_con UNION SELECT 'pg_trigger'::regclass,oid FROM scoped_triggers
    UNION SELECT 'pg_policy'::regclass,p.oid FROM pg_catalog.pg_policy p WHERE p.polrelid IN(SELECT oid FROM owned_rel)
    UNION SELECT 'pg_attrdef'::regclass,a.oid FROM pg_catalog.pg_attrdef a WHERE a.adrelid IN(SELECT oid FROM owned_rel)
    UNION SELECT 'pg_default_acl'::regclass,d.oid FROM pg_catalog.pg_default_acl d WHERE d.defaclrole=ANY($1::oid[]) OR d.defaclnamespace IN(SELECT oid FROM pg_catalog.pg_namespace WHERE nspname IN ${scopeSql})
  ) SELECT d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype FROM pg_catalog.pg_depend d WHERE EXISTS(SELECT 1 FROM obj o WHERE (o.classid=d.classid AND o.id=d.objid) OR(o.classid=d.refclassid AND o.id=d.refobjid))
    UNION ALL SELECT d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,0,d.deptype FROM pg_catalog.pg_shdepend d WHERE d.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND EXISTS(SELECT 1 FROM obj o WHERE o.classid=d.classid AND o.id=d.objid)) d`),
  roles: selectSql({ nativeOid: "r.oid::text", name: "r.rolname", login: "r.rolcanlogin", superuser: "r.rolsuper", bypassRls: "r.rolbypassrls", inherit: "r.rolinherit", createRole: "r.rolcreaterole", createDb: "r.rolcreatedb", replication: "r.rolreplication", config: "r.rolconfig" },
  `FROM pg_catalog.pg_roles r WHERE r.oid=ANY($1::oid[]) OR r.oid IN(SELECT unnest(ARRAY[m.member,m.roleid,m.grantor]) FROM (${membershipGraph}) m)`),
  memberships: selectSql({ nativeOid: "m.oid::text", member: principalSql("m.member"), parent: principalSql("m.roleid"), grantor: principalSql("m.grantor"), admin: "m.admin_option", inherit: "m.inherit_option", set: "m.set_option" }, `FROM (${membershipGraph}) m`),
});
/** Caller owns the approved connection/inspection transaction and its cleanup. */
export async function readPostgresCatalogV3(port: CatalogReadPortV3, managementBindings: unknown): Promise<CatalogObservationV3> {
  try {
    const b = snapshotBindings(managementBindings);
    let object: object | null = port, method: PropertyDescriptor | undefined;
    for (let depth = 0; object && depth < 10; depth++, object = Object.getPrototypeOf(object)) {
      method = Object.getOwnPropertyDescriptor(object, "query"); if (method) break;
    }
    need(method && Object.hasOwn(method, "value") && typeof method.value === "function");
    const query = method!.value.bind(port) as CatalogReadPortV3["query"];
    const values = frozen([slots.flatMap(s => b[s] ? [b[s]!.nativeOid] : []),
      b.externalFacts.filter(f => f.identity.kind === "relation").map(f => f.endpoint.nativeOid),
      b.externalFacts.filter(f => f.identity.kind === "index").map(f => f.endpoint.nativeOid)]);
    const rowsOf = (response: {rows:unknown}) => { const rows = Object.getOwnPropertyDescriptor(response, "rows"); need(rows && Object.hasOwn(rows, "value")); assertPlainData(rows!.value); return rows!.value as unknown; };
    // Validate context first using only explicitly qualified read-only builtins,
    // before any deparser/operator lookup in the catalog projections. The caller
    // must exclusively own this port/transaction; this module never sets it up.
    const initial = z.array(initialContextShape).length(1).parse(rowsOf(await query(inspectionContextSql, frozen([]))))[0];
    const result: Partial<Record<Category, unknown>> = {};
    for (const category of categories) {
      const batch = z.array(contextShape.extend({ catalog_row: rawShapes[category] })).max(10000).parse(rowsOf(await query(postgresCatalogQueriesV3[category], values)));
      need(batch.every(row => row.isolation === initial.isolation && row.read_only === initial.read_only));
      result[category] = frozen(batch);
    }
    return decodePostgresCatalogObservationV3(result, b);
  } catch { throw new PostgresCatalogObservationErrorV3(); }
}
