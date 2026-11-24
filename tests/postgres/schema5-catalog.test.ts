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
// B40 captured-native-derived input, NOT a Golden or full-catalog fixture.
// Author B39 a6c48bc1 and independent Tester B39 f25ab90b captured this same
// history relation row. Both projection-relations.json files have byte SHA256
// 4aa31bbc9be7d35875795dc9212a3a702c647bcdb8defe80f78b872e97971dc1.
// Full roots/provenance are recorded in B40 handoff; no scratch/runtime I/O.
const capturedB39HistoryRelation: Batch = {
  "server_major": 18,
  "search_path": "pg_catalog",
  "isolation": "repeatable read",
  "read_only": "on",
  "catalog_row": {
    "acl": [
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "INSERT"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "SELECT"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "UPDATE"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "DELETE"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "TRUNCATE"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "REFERENCES"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "TRIGGER"
      },
      {
        "grantee": {
          "principalOid": "16389"
        },
        "grantor": {
          "principalOid": "16389"
        },
        "grantable": false,
        "privilege": "MAINTAIN"
      }
    ],
    "rls": false,
    "kind": "r",
    "name": "history",
    "owner": {
      "principalOid": "16389"
    },
    "toast": {
      "owner": {
        "principalOid": "16389"
      },
      "unique": true,
      "columns": [
        {
          "name": "chunk_id",
          "type": {
            "name": "oid",
            "schema": "pg_catalog",
            "catalog": "pg_type",
            "nativeOid": "26"
          },
          "dropped": false,
          "notNull": false,
          "ordinal": 1,
          "dimensions": 0,
          "typeModifier": -1,
          "relationNativeOid": "16409"
        },
        {
          "name": "chunk_seq",
          "type": {
            "name": "int4",
            "schema": "pg_catalog",
            "catalog": "pg_type",
            "nativeOid": "23"
          },
          "dropped": false,
          "notNull": false,
          "ordinal": 2,
          "dimensions": 0,
          "typeModifier": -1,
          "relationNativeOid": "16409"
        },
        {
          "name": "chunk_data",
          "type": {
            "name": "bytea",
            "schema": "pg_catalog",
            "catalog": "pg_type",
            "nativeOid": "17"
          },
          "dropped": false,
          "notNull": false,
          "ordinal": 3,
          "dimensions": 0,
          "typeModifier": -1,
          "relationNativeOid": "16409"
        }
      ],
      "parents": [
        "16399"
      ],
      "indexOid": "16410",
      "indexKind": "i",
      "namespace": "pg_toast",
      "nativeOid": "16409",
      "indexOwner": {
        "principalOid": "16389"
      },
      "indexColumns": [
        1,
        2
      ],
      "relationKind": "t",
      "indexKeyCount": 2,
      "indexParentOid": "16409",
      "indexAttributeCount": 2
    },
    "ofType": null,
    "schema": "dream_migrations",
    "options": null,
    "rowType": {
      "name": "history",
      "schema": "dream_migrations",
      "catalog": "pg_type",
      "nativeOid": "16401"
    },
    "forceRls": false,
    "nativeOid": "16399",
    "isPartition": false,
    "persistence": "p",
    "toastNativeOid": "16409",
    "replicaIdentity": "d"
  }
};

// B44 newly collected minimal-native input, not old B43 data or a Golden.
// tmp/b44-native-3e334fc5-08b3-463f-9411-979d47d0efb9 projections:
// constraints SHA256 46599f73b52546d4b31ac33b7e1cbc22e8e98ac988396f7cea6d76c5270421c9;
// indexes SHA256 98cc0b4a0ab046c2c7f72e8e12d21b9425ce6a56c18a2f2b83c243544abcd40c.
// The dedicated regression explicitly rekeys these OIDs into a SYNTHETIC graph.
const capturedB44Primary = {
  "constraint": {
    "kind": "p",
    "local": true,
    "scope": "external-prerequisite",
    "period": false,
    "enforced": true,
    "identity": {
      "name": "users_pkey",
      "object": {
        "name": "users",
        "schema": "auth",
        "catalog": "pg_class",
        "nativeOid": "16392"
      },
      "catalog": "pg_constraint",
      "nativeOid": "16397",
      "objectKind": "relation"
    },
    "matchType": " ",
    "nativeOid": "16397",
    "noInherit": true,
    "validated": true,
    "deferrable": false,
    "definition": "PRIMARY KEY (id)",
    "expression": null,
    "keyColumns": [
      1
    ],
    "deleteAction": " ",
    "prerequisite": {
      "index": {
        "name": "users_pkey",
        "catalog": "pg_class",
        "relation": {
          "name": "users",
          "schema": "auth",
          "catalog": "pg_class",
          "nativeOid": "16392"
        },
        "nativeOid": "16396"
      },
      "column": {
        "name": "id",
        "type": {
          "name": "uuid",
          "schema": "pg_catalog",
          "catalog": "pg_type",
          "nativeOid": "2950"
        },
        "dropped": false,
        "notNull": true,
        "ordinal": 1,
        "relation": {
          "name": "users",
          "schema": "auth",
          "catalog": "pg_class",
          "nativeOid": "16392"
        },
        "dimensions": 0,
        "typeModifier": -1
      },
      "indexOwner": {
        "principalOid": "16389"
      },
      "isPartition": false,
      "relationKind": "r",
      "relationOwner": {
        "principalOid": "16389"
      },
      "indexConstraints": [
        {
          "name": "users_pkey",
          "object": {
            "name": "users",
            "schema": "auth",
            "catalog": "pg_class",
            "nativeOid": "16392"
          },
          "catalog": "pg_constraint",
          "nativeOid": "16397",
          "objectKind": "relation"
        }
      ]
    },
    "updateAction": " ",
    "inheritedCount": 0,
    "supportingIndex": {
      "name": "users_pkey",
      "catalog": "pg_class",
      "relation": {
        "name": "users",
        "schema": "auth",
        "catalog": "pg_class",
        "nativeOid": "16392"
      },
      "nativeOid": "16396"
    },
    "deleteSetColumns": null,
    "parentConstraint": null,
    "initiallyDeferred": false,
    "referencedColumns": null,
    "exclusionOperators": null,
    "referencedRelation": null,
    "fkForeignForeignOperators": null,
    "fkPrimaryForeignOperators": null,
    "fkPrimaryPrimaryOperators": null
  },
  "index": {
    "live": true,
    "name": "users_pkey",
    "ready": true,
    "scope": "external-prerequisite",
    "valid": true,
    "unique": true,
    "options": [
      0
    ],
    "primary": true,
    "relation": {
      "name": "users",
      "schema": "auth",
      "catalog": "pg_class",
      "nativeOid": "16392"
    },
    "immediate": true,
    "nativeOid": "16396",
    "opclasses": [
      "pg_catalog.uuid_ops"
    ],
    "predicate": null,
    "collations": [
      null
    ],
    "definition": "CREATE UNIQUE INDEX users_pkey ON auth.users USING btree (id)",
    "keyColumns": [
      1
    ],
    "expressions": null,
    "accessMethod": "btree",
    "includeColumns": [],
    "nullsNotDistinct": false
  },
  "dependency": {
    "class": "pg_class",
    "native_oid": "16396",
    "objsubid": 0,
    "referenced_class": "pg_constraint",
    "referenced_oid": "16397",
    "refobjsubid": 0,
    "deptype": "i"
  }
};

// B46 NEW small-native both_same policy dependency bag (not B45 data).
// Projection SHA256 eb93a53873c33b3c4e1fc8be5b48cc96f9cefa56018b155156bbc31fd751442b.
// No diagnostic ctid is copied; the regression readdresses OIDs into a synthetic graph.
const capturedB46PolicyEdges = [
  {
    "dependent": {
      "class": "pg_policy",
      "subId": 0,
      "nativeOid": "16399"
    },
    "referenced": {
      "class": "pg_class",
      "subId": 0,
      "nativeOid": "16392"
    },
    "dependencyType": "a"
  },
  {
    "dependent": {
      "class": "pg_policy",
      "subId": 0,
      "nativeOid": "16399"
    },
    "referenced": {
      "class": "pg_proc",
      "subId": 0,
      "nativeOid": "16395"
    },
    "dependencyType": "n"
  },
  {
    "dependent": {
      "class": "pg_policy",
      "subId": 0,
      "nativeOid": "16399"
    },
    "referenced": {
      "class": "pg_class",
      "subId": 1,
      "nativeOid": "16392"
    },
    "dependencyType": "n"
  },
  {
    "dependent": {
      "class": "pg_policy",
      "subId": 0,
      "nativeOid": "16399"
    },
    "referenced": {
      "class": "pg_proc",
      "subId": 0,
      "nativeOid": "16395"
    },
    "dependencyType": "n"
  },
  {
    "dependent": {
      "class": "pg_policy",
      "subId": 0,
      "nativeOid": "16399"
    },
    "referenced": {
      "class": "pg_class",
      "subId": 1,
      "nativeOid": "16392"
    },
    "dependencyType": "n"
  }
];

function fixture(offset = 0, pair = false) {
  const id = (n: number) => String(n + offset), p = (n: number) => ({ principalOid: n === 0 ? "0" : id(n) });
  const r = (n: number, name = "projects", schema = "dream") => ({ nativeOid: id(n), catalog: "pg_class", schema, name });
  const t = (n: number, name: string, schema = "dream") => ({ nativeOid: id(n), catalog: "pg_type", schema, name });
  const typUuid = t(9000, "uuid", "pg_catalog"), typText = t(9001, "text", "pg_catalog");
  const fn = (n: number, name: string, args: ReturnType<typeof t>[] = [], schema = "pg_catalog") => ({ nativeOid: id(n), catalog: "pg_proc", schema, name, argumentTypes: args });
  const auth = r(900, "users", "auth"), ix = { nativeOid: id(301), catalog: "pg_class", relation: auth, name: "users_pkey" };
  const con = (n = 500, name = "projects_owner_fk") => ({ nativeOid: id(n), catalog: "pg_constraint", objectKind: "relation", object: r(100), name });
  const authPk = { nativeOid: id(902), catalog: "pg_constraint", objectKind: "relation", object: auth, name: "users_pkey" };
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
      ext("pg_constraint", 902, { kind: "constraint", objectKind: "relation", object: { schema: "auth", name: "users" }, name: "users_pkey" }),
      ...[[9010, "oid"], [9011, "int4"], [9012, "bytea"]].map(([n, name]) => ext("pg_type", Number(n), { kind: "type", schema: "pg_catalog", name })),
      ...[[8000, "fixture_io"], [8101, "RI_FKey_check_ins"], [8102, "RI_FKey_check_upd"], [8103, "RI_FKey_restrict_del"], [8104, "RI_FKey_noaction_upd"]].map(([n, name]) => ext("pg_proc", Number(n), { kind: "function", schema: "pg_catalog", name, argumentTypes: [] })),
    ] };
  const ownerAcl = [{ grantor: p(11), grantee: p(11), privilege: "USAGE", grantable: false }];
  const typeProps = { owner: p(11), defined: true, preferred: false, length: -1, byValue: false, delimiter: ",", alignment: "i", storage: "x", typeModifier: -1,
    dimensions: 0, collation: null, aclIsNull: true, acl: ownerAcl, input: fn(8000, "fixture_io"), output: fn(8000, "fixture_io"), receive: null, send: null, modifierInput: null, modifierOutput: null, analyze: null, subscript: null };
  const constraintBase = { scope: "owned", prerequisite: null, deferrable: false, initiallyDeferred: false, enforced: true, validated: true, local: true, inheritedCount: 0, noInherit: true, period: false,
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
      rowType: t(200, "projects"), ofType: null, options: null, acl: [], toastNativeOid: id(400), toast: { nativeOid: id(400), indexOid: id(401), owner: p(11), indexOwner: p(11), namespace: "pg_toast", relationKind: "t", indexKind: "i", unique: true, parents: [id(100)], indexParentOid: id(400), indexKeyCount: 2, indexAttributeCount: 2, indexColumns: [1, 2], columns: [[1, "chunk_id", 9010, "oid"], [2, "chunk_seq", 9011, "int4"], [3, "chunk_data", 9012, "bytea"]].map(([ordinal, name, typeOid, typeName]) => ({ relationNativeOid: id(400), ordinal, name, type: t(Number(typeOid), String(typeName), "pg_catalog"), notNull: false, dropped: false, typeModifier: -1, dimensions: 0 })) } }],
    columns: [{ relation: r(100), ordinal: 1, name: "owner_id", type: "uuid", notNull: true, identity: "", generated: "", dropped: false, defaultNativeOid: id(402), defaultExpression: "'00000000-0000-4000-8000-000000000001'::uuid", collation: null, acl: [] }],
    constraints: [{ ...constraintBase, nativeOid: id(500), identity: con(), kind: "f", supportingIndex: ix, referencedRelation: auth, keyColumns: [1], referencedColumns: [1], updateAction: "a", deleteAction: "r", matchType: "s", fkPrimaryForeignOperators: [eq], fkPrimaryPrimaryOperators: [eq], fkForeignForeignOperators: [eq] },
      { ...constraintBase, nativeOid: id(503), identity: con(503, "guard_123"), kind: "t", deferrable: true, initiallyDeferred: true },
      { ...constraintBase, scope: "external-prerequisite", nativeOid: id(902), identity: authPk, kind: "p", keyColumns: [1], supportingIndex: ix,
        prerequisite: { relationOwner: p(11), indexOwner: p(11), relationKind: "r", isPartition: false,
          column: { relation: auth, ordinal: 1, name: "id", type: typUuid, notNull: true, dropped: false, typeModifier: -1, dimensions: 0 }, index: ix, indexConstraints: [authPk] } }],
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
    dependencies: [dep("pg_class", 100, "pg_namespace", 1), dep("pg_type", 200, "pg_class", 100), dep("pg_type", 201, "pg_type", 200), dep("pg_trigger", 701, "pg_constraint", 500), dep("pg_attrdef", 402, "pg_class", 100, 1), dep("pg_class", 400, "pg_class", 100), dep("pg_class", 401, "pg_class", 400), { ...dep("pg_class", 301, "pg_constraint", 902), dependencyType: "i" }],
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
  it.each(cats.filter(c => c !== "dependencies"))("rejects duplicated %s identity/row", c => { const f = fixture(); f.raw[c].push(structuredClone(f.raw[c][0])); invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings)); });
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
  it("retains unreferenced function semantic arguments and overloads despite identical display text", () => {
    const f = fixture(), base = structuredClone(f.raw.functions[2]);
    Object.assign(base.catalog_row, { nativeOid: "6010", name: "unreferenced_probe", identityArgs: "uuid", declaredArgs: "uuid", argumentTypes: ["uuid"], argumentTypeRefs: [structuredClone((row(f, "functions").argumentTypeRefs as Row[])[0])] });
    f.raw.functions.push(base);
    const before = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(before.descriptorVersion).toBe(4);
    expect(before.catalog.functions.find(x => x.name === "unreferenced_probe")!.argumentTypeRefs).toEqual([{ schema: "pg_catalog", name: "uuid" }]);
    base.catalog_row.argumentTypeRefs = [structuredClone((row(f, "functions").argumentTypeRefs as Row[])[1])];
    const after = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(after.observationSha256).not.toBe(before.observationSha256);
    expect(after.catalog.functions.find(x => x.name === "unreferenced_probe")!.argumentTypeRefs).toEqual([{ schema: "pg_catalog", name: "text" }]);
    const overload = structuredClone(base); overload.catalog_row.nativeOid = "6011";
    overload.catalog_row.argumentTypeRefs = [structuredClone((row(f, "functions").argumentTypeRefs as Row[])[0])];
    f.raw.functions.push(overload);
    expect(decodePostgresCatalogObservationV3(f.raw, f.bindings).catalog.functions.filter(x => x.name === "unreferenced_probe")).toHaveLength(2);
    overload.catalog_row.argumentTypeRefs = structuredClone(base.catalog_row.argumentTypeRefs);
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("keeps argument semantic order distinct while native OID changes alone remain normalized", () => {
    const f = fixture(), base = structuredClone(f.raw.functions[2]);
    Object.assign(base.catalog_row, { nativeOid: "6010", name: "ordered_probe", argumentTypes: ["opaque", "opaque"], argumentTypeRefs: structuredClone(row(f, "functions").argumentTypeRefs) });
    f.raw.functions.push(base);
    const before = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    (base.catalog_row.argumentTypeRefs as Row[]).reverse();
    expect(decodePostgresCatalogObservationV3(f.raw, f.bindings).observationSha256).not.toBe(before.observationSha256);
  });
  it("normalizes shifted native OIDs for an unreferenced semantic signature", () => {
    const observe = (offset: number) => {
      const f = fixture(offset), extra = structuredClone(f.raw.functions[2]);
      Object.assign(extra.catalog_row, { nativeOid: f.id(6010), name: "unreferenced_probe", argumentTypes: ["uuid", "text"], argumentTypeRefs: structuredClone(row(f, "functions").argumentTypeRefs) });
      f.raw.functions.push(extra);
      return decodePostgresCatalogObservationV3(f.raw, f.bindings);
    };
    expect(observe(0).canonicalJson).toBe(observe(20000).canonicalJson);
    expect(observe(0).observationSha256).toBe(observe(20000).observationSha256);
  });
  it("rejects the original fixture shape with all new TOAST proof fields absent", () => {
    const f = fixture(), toast = row(f, "relations").toast as Row;
    for (const field of ["columns", "indexColumns", "indexKeyCount", "indexAttributeCount"]) delete toast[field];
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("represents exact-parent TOAST subcolumn dependencies without adding a business category", () => {
    const f = fixture(), dependency = structuredClone(f.raw.dependencies[6]);
    (dependency.catalog_row.referenced as Row).subId = 1;
    dependency.catalog_row.dependencyType = "a";
    f.raw.dependencies.push(dependency);
    const result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.catalog.dependencies.some(d => d.referenced.includes('"kind":"table-toast-column"') && d.referenced.includes('"name":"chunk_id"'))).toBe(true);
    expect(Object.keys(result.catalog)).toHaveLength(14);
    expect(result.catalog.columns).toHaveLength(1);
    expect(postgresCatalogQueriesV3.relations).toContain("ta.attrelid=tc.oid AND ta.attnum>0");
    expect(postgresCatalogQueriesV3.functions).toContain("WITH ORDINALITY a(id,ord) ORDER BY a.ord");
  });
  it.each(["missing-evidence", "foreign-parent", "duplicate-ordinal", "unknown-ordinal", "wrong-name", "wrong-type", "type-alias", "unproved-type", "dropped", "unexpected-not-null", "index-link", "index-key", "index-count", "index-attributes", "missing-column"])("rejects TOAST column proof fault %s", fault => {
    const f = fixture(), toast = row(f, "relations").toast as Row, columns = toast.columns as Row[];
    if (fault === "missing-evidence") delete toast.columns;
    if (fault === "foreign-parent") columns[0].relationNativeOid = "100";
    if (fault === "duplicate-ordinal") columns[1].ordinal = 1;
    if (fault === "unknown-ordinal") columns[0].ordinal = 4;
    if (fault === "wrong-name") columns[0].name = "foreign";
    if (fault === "wrong-type") columns[0].type = structuredClone(columns[1].type);
    if (fault === "type-alias") (columns[0].type as Row).nativeOid = "9011";
    if (fault === "unproved-type") (columns[0].type as Row).nativeOid = "99999";
    if (fault === "dropped") columns[0].dropped = true;
    if (fault === "unexpected-not-null") columns[0].notNull = true;
    if (fault === "index-link") toast.indexParentOid = "100";
    if (fault === "index-key") toast.indexColumns = [2, 1];
    if (fault === "index-count") toast.indexKeyCount = 1;
    if (fault === "index-attributes") toast.indexAttributeCount = 3;
    if (fault === "missing-column") columns.pop();
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  // Deliberately stop at columns: these tests establish only the raw relations
  // shape boundary. Other category inputs/bindings are synthetic, not native.
  async function rawRelationStage(input: Batch) {
    const f = fixture(); let calls = 0;
    const query = vi.fn(async () => {
      calls++;
      if (calls === 1) return { rows: [{ server_version: "180007", search_path: "pg_catalog", isolation: "repeatable read", read_only: "on" }] };
      if (calls === 2) return { rows: f.raw.schemas };
      if (calls === 3) return { rows: [input] };
      throw Error("B40 deliberate stop before columns; not full observation");
    });
    await expect(readPostgresCatalogV3({ query }, f.bindings)).rejects.toMatchObject({ code: "CATALOG_OBSERVATION_INVALID" });
    return calls;
  }
  it("accepts the independently corroborated captured-native false metadata through raw relations only", async () => {
    const input = structuredClone(capturedB39HistoryRelation);
    expect((input.catalog_row.toast as Row).columns).toEqual(expect.arrayContaining([expect.objectContaining({ ordinal: 1, notNull: false }), expect.objectContaining({ ordinal: 2, notNull: false }), expect.objectContaining({ ordinal: 3, notNull: false })]));
    expect(await rawRelationStage(input)).toBe(4);
  });
  it.each([0, 1, 2])("rejects captured TOAST column %s when changed to true", async ordinal => {
    const input = structuredClone(capturedB39HistoryRelation);
    ((input.catalog_row.toast as Row).columns as Row[])[ordinal].notNull = true;
    expect(await rawRelationStage(input)).toBe(3);
  });
  it.each([["missing", undefined], ["null", null], ["number", 0], ["string", "false"], ["object", {}]])("rejects missing/nonboolean captured TOAST notNull %s", async (kind, value) => {
    const input = structuredClone(capturedB39HistoryRelation), column = ((input.catalog_row.toast as Row).columns as Row[])[0];
    if (kind === "missing") delete column.notNull; else column.notNull = value;
    expect(await rawRelationStage(input)).toBe(3);
  });
  it("retains logical business-column nullability as explicit canonical metadata", () => {
    const f = fixture(), before = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(before.catalog.columns[0].notNull).toBe(true);
    row(f, "columns").notNull = false;
    const after = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(after.catalog.columns[0].notNull).toBe(false);
    expect(after.observationSha256).not.toBe(before.observationSha256);
  });
  it("rejects an uncollected TOAST subcolumn rather than inventing an ordinal identity", () => {
    const f = fixture(); (row(f, "dependencies", 6).referenced as Row).subId = 4;
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
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
  it("integrates exactly the B42 native-tested candidate modulo fixed aliases, parameter binding and cast parentheses", () => {
    const sql = postgresCatalogQueriesV3.columns;
    const actual = sql.slice(sql.indexOf("'acl',") + 6, sql.indexOf(") AS catalog_row"))
      .replace(/\ba[0-9]+\b/g, "a")
      .replaceAll("coalesce(a.attacl,'{}'::aclitem[])", "coalesce($1::aclitem[],$2::aclitem[])")
      .replace(/\(a\.(grantor|grantee)\)::text/g, "a.$1::text");
    // Transcribed from the BEFORE-product-edit native experiment source, not
    // derived from the new helper. These three textual differences are explicit.
    const nativeTuple = "pg_catalog.jsonb_build_object('grantor',pg_catalog.jsonb_build_object('principalOid',a.grantor::text),'grantee',pg_catalog.jsonb_build_object('principalOid',a.grantee::text),'privilege',a.privilege_type,'grantable',a.is_grantable)";
    expect(actual).toBe(`CASE WHEN coalesce(pg_catalog.cardinality(coalesce($1::aclitem[],$2::aclitem[])),0)=0 THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(${nativeTuple}),'[]'::jsonb) FROM pg_catalog.aclexplode(coalesce($1::aclitem[],$2::aclitem[])) a) END`);
  });
  it.each([
    ["schemas", "coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))"],
    ["relations", "coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))"],
    ["columns", "coalesce(a.attacl,'{}'::aclitem[])"],
    ["functions", "coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))"],
    ["domains", "coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))"],
    ["types", "coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))"],
    ["defaultAcls", "coalesce(d.defaclacl,'{}'::aclitem[])"],
  ])("keeps %s effective ACL defaults inside its empty guard and complete expansion", (category, effective) => {
    const sql = postgresCatalogQueriesV3[category as keyof typeof postgresCatalogQueriesV3];
    expect(sql).toContain(`CASE WHEN coalesce(pg_catalog.cardinality(${effective}),0)=0 THEN '[]'::jsonb ELSE `);
    expect(sql).toContain(`pg_catalog.aclexplode(${effective})`);
    if (category === "types" || category === "domains") expect(sql).toContain("'aclIsNull',t.typacl IS NULL");
  });
  it.each(["schemas", "relations", "columns", "functions", "domains", "types", "defaultAcls"] as const)("retains empty expanded tuples in %s observations", category => {
    const f = fixture(), i = category === "functions" ? 2 : 0;
    row(f, category, i).acl = [];
    const result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.catalog[category][0]).toBeDefined();
    expect(result.catalog[category].some(r => r.acl.length === 0)).toBe(true);
  });
  it("preserves column ACL native principals/PUBLIC/privilege/grantability without tuple loss", () => {
    const f = fixture(); row(f, "columns").acl = [
      { grantor: { principalOid: "11" }, grantee: { principalOid: "12" }, privilege: "SELECT", grantable: true },
      { grantor: { principalOid: "11" }, grantee: { principalOid: "0" }, privilege: "UPDATE", grantable: false },
    ];
    const acl = decodePostgresCatalogObservationV3(f.raw, f.bindings).catalog.columns[0].acl;
    expect(acl).toHaveLength(2);
    expect(acl).toContainEqual({ grantor: { kind: "migration-owner" }, grantee: { kind: "reserved-role", name: "dream_api" }, privilege: "SELECT", grantable: true });
    expect(acl).toContainEqual({ grantor: { kind: "migration-owner" }, grantee: { kind: "public" }, privilege: "UPDATE", grantable: false });
  });
  it.each(["public-grantor", "string-grantable", "missing-grantor"])("keeps strict ACL tuple rejection %s", fault => {
    const f = fixture(), acl = { grantor: { principalOid: "11" }, grantee: { principalOid: "0" }, privilege: "UPDATE", grantable: false } as Row;
    if (fault === "public-grantor") acl.grantor = { principalOid: "0" };
    if (fault === "string-grantable") acl.grantable = "false";
    if (fault === "missing-grantor") delete acl.grantor;
    row(f, "columns").acl = [acl]; invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("retains raw type ACL NULL separately from equal effective tuples and explicit empty", () => {
    const f = fixture(), original = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    row(f, "types").aclIsNull = false;
    const notNull = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(notNull.observationSha256).not.toBe(original.observationSha256);
    expect(notNull.catalog.types[0].acl).toEqual(original.catalog.types[0].acl);
    row(f, "types").acl = [];
    expect(decodePostgresCatalogObservationV3(f.raw, f.bindings).observationSha256).not.toBe(notNull.observationSha256);
  });
  it("retains exact repeated native dependency quantity as explicit multiplicity", () => {
    const f = fixture(); f.raw.dependencies.push(structuredClone(f.raw.dependencies[0]));
    const observation = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(observation.catalog.dependencies).toHaveLength(f.raw.dependencies.length - 1);
    expect(observation.catalog.dependencies.filter(d => d.multiplicity === 2)).toHaveLength(1);
    expect(observation.catalog.dependencies.reduce((n, d) => n + d.multiplicity, 0)).toBe(f.raw.dependencies.length);
  });
  it("emits explicit bounded integer count1 for previously unique dependency rows", () => {
    const f = fixture(), result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.descriptorVersion).toBe(4);
    expect(result.catalog.dependencies).toHaveLength(f.raw.dependencies.length);
    expect(result.catalog.dependencies.every(d => Number.isSafeInteger(d.multiplicity) && d.multiplicity === 1)).toBe(true);
  });
  it("distinguishes quantity1 from2 in canonical JSON/hash without losing a native row", () => {
    const f = fixture(), before = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    f.raw.dependencies.push(structuredClone(f.raw.dependencies[0]));
    const after = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(after.catalog.dependencies).toHaveLength(before.catalog.dependencies.length);
    expect(after.canonicalJson).not.toBe(before.canonicalJson); expect(after.observationSha256).not.toBe(before.observationSha256);
    expect(after.approval).toBe(false); expect(after.expectedCatalog).toBe(false);
  });
  it("keeps the same dependency multiset invariant under input order and native OID shifts", () => {
    const observe = (offset: number, reverse: boolean) => {
      const f = fixture(offset); f.raw.dependencies.push(structuredClone(f.raw.dependencies[0]), structuredClone(f.raw.dependencies[7]));
      if (reverse) f.raw.dependencies.reverse();
      return decodePostgresCatalogObservationV3(f.raw, f.bindings);
    };
    const first = observe(0, false), shifted = observe(20000, true);
    expect(shifted.canonicalJson).toBe(first.canonicalJson); expect(shifted.observationSha256).toBe(first.observationSha256);
    expect(first.catalog.dependencies.reduce((sum, d) => sum + d.multiplicity, 0)).toBe(10);
  });
  it("groups only an exact native endpoint/sub-ID/deptype tuple", () => {
    const f = fixture(), original = structuredClone(f.raw.dependencies[0]), column = structuredClone(original), automatic = structuredClone(original), otherRelation = structuredClone(original);
    (column.catalog_row.dependent as Row).subId = 1;
    automatic.catalog_row.dependencyType = "a";
    (otherRelation.catalog_row.dependent as Row).nativeOid = "900";
    f.raw.dependencies.push(original, column, automatic, otherRelation);
    const result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.catalog.dependencies).toHaveLength(f.raw.dependencies.length - 1);
    expect(result.catalog.dependencies.filter(d => d.multiplicity === 2)).toHaveLength(1);
    expect(result.catalog.dependencies.reduce((sum, d) => sum + d.multiplicity, 0)).toBe(f.raw.dependencies.length);
    expect(result.catalog.dependencies.some(d => d.dependent.includes('"kind":"column"') && d.dependencyType === "n")).toBe(true);
    expect(result.catalog.dependencies.some(d => d.dependent.includes('"schema":"auth"') && d.dependencyType === "n")).toBe(true);
  });
  it("keeps catalog classes distinct even when numeric native OIDs coincide", () => {
    const f = fixture();
    f.bindings.externalFacts.push(
      { endpoint: { class: "pg_type", nativeOid: "100", subId: 0 }, identity: { kind: "type", schema: "pg_catalog", name: "fixture_same_oid_type" } },
      { endpoint: { class: "pg_type", nativeOid: "1", subId: 0 }, identity: { kind: "type", schema: "pg_catalog", name: "fixture_same_ref_oid_type" } },
    );
    const dependentClass = structuredClone(f.raw.dependencies[0]), referencedClass = structuredClone(f.raw.dependencies[0]);
    (dependentClass.catalog_row.dependent as Row).class = "pg_type";
    (referencedClass.catalog_row.referenced as Row).class = "pg_type";
    f.raw.dependencies.push(dependentClass, referencedClass);
    const result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.catalog.dependencies).toHaveLength(f.raw.dependencies.length);
    expect(result.catalog.dependencies.every(d => d.multiplicity === 1)).toBe(true);
    expect(result.catalog.dependencies.some(d => d.dependent.includes("fixture_same_oid_type"))).toBe(true);
    expect(result.catalog.dependencies.some(d => d.referenced.includes("fixture_same_ref_oid_type"))).toBe(true);
  });
  it.each([0, -1, 1.5, 2, "2", Infinity])("rejects caller-supplied raw multiplicity %s rather than trusting aggregation", multiplicity => {
    const f = fixture(); row(f, "dependencies").multiplicity = multiplicity;
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
  });
  it("does not hide unresolved endpoints or native-to-semantic aliases behind counts", () => {
    const f = fixture(), unknown = structuredClone(f.raw.dependencies[0]);
    (unknown.catalog_row.referenced as Row).nativeOid = "999999";
    f.raw.dependencies.push(unknown, structuredClone(unknown));
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    const g = fixture(), alias = structuredClone(g.bindings.externalFacts[0]); alias.endpoint.nativeOid = "999999"; g.bindings.externalFacts.push(alias);
    g.raw.dependencies.push(structuredClone(g.raw.dependencies[0]));
    invalid(() => decodePostgresCatalogObservationV3(g.raw, g.bindings));
  });
  it("conserves repeated raw rows within bounds and rejects oversized bags", () => {
    const f = fixture(); f.raw.dependencies.push(...Array.from({ length: 100 }, () => structuredClone(f.raw.dependencies[0])));
    const result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.catalog.dependencies.some(d => d.multiplicity === 101)).toBe(true);
    expect(result.catalog.dependencies.reduce((sum,d) => sum + d.multiplicity, 0)).toBe(f.raw.dependencies.length);
    const g = fixture(); g.raw.dependencies.push(...Array.from({ length: 10001 - g.raw.dependencies.length }, () => structuredClone(g.raw.dependencies[0])));
    invalid(() => decodePostgresCatalogObservationV3(g.raw, g.bindings));
  });
  it("retains one distinct Auth PK owner edge with repeated physical quantity", () => {
    const f = fixture(), before = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    f.raw.dependencies.push(structuredClone(f.raw.dependencies[7]));
    const result = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    expect(result.catalog.dependencies.some(d => d.dependencyType === "i" && d.referenced.includes('"name":"users_pkey"') && d.multiplicity === 2)).toBe(true);
    expect(result.observationSha256).not.toBe(before.observationSha256);
    expect(result.catalog.constraints.find(c => c.scope === "external-prerequisite")!.prerequisite!.indexConstraints).toHaveLength(1);
  });
  it("rejects an additional distinct index owner and keeps other-category/ACL duplicates invalid", () => {
    const f = fixture(), extraOwner = structuredClone(f.raw.dependencies[7]); (extraOwner.catalog_row.referenced as Row).nativeOid = "500";
    f.raw.dependencies.push(extraOwner); invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
    const g = fixture(), grant = { grantor: { principalOid: "11" }, grantee: { principalOid: "12" }, privilege: "SELECT", grantable: false };
    row(g, "columns").acl = [grant, structuredClone(grant)]; g.raw.dependencies.push(structuredClone(g.raw.dependencies[0]));
    invalid(() => decodePostgresCatalogObservationV3(g.raw, g.bindings));
  });
  it("preserves newly captured both_same policy quantity in an explicitly readdressed synthetic graph", () => {
    const observe = (offset: number) => {
      const f = fixture(offset), ids: Record<string, string> = { "16399": f.id(550), "16392": f.id(100), "16395": f.id(6003) };
      for (const edge of capturedB46PolicyEdges) {
        const d = structuredClone(edge); d.dependent.nativeOid = ids[d.dependent.nativeOid]; d.referenced.nativeOid = ids[d.referenced.nativeOid];
        if (!d.dependent.nativeOid || !d.referenced.nativeOid) throw Error("Unmapped captured endpoint");
        f.raw.dependencies.push({ ...structuredClone(f.raw.dependencies[0]), catalog_row: d });
      }
      return { result: decodePostgresCatalogObservationV3(f.raw, f.bindings), rawCount: f.raw.dependencies.length };
    };
    const first = observe(0), shifted = observe(20000);
    expect(first.result.catalog.dependencies.reduce((sum,d)=>sum+d.multiplicity,0)).toBe(first.rawCount);
    expect(first.rawCount).toBe(13); expect(first.result.catalog.dependencies).toHaveLength(11);
    expect(first.result.catalog.dependencies.filter(d => d.multiplicity === 2)).toHaveLength(2);
    expect(shifted.result.canonicalJson).toBe(first.result.canonicalJson);
    expect(first.result.canonicalJson).not.toContain("ctid"); expect(first.result.expectedCatalog).toBe(false);
    // Other objects/names/expressions are synthetic; this is not a native full graph.
  });
  it("observes only the exact M-owned Auth UUID primary prerequisite and preserves its dependency", () => {
    const f = fixture(), observed = decodePostgresCatalogObservationV3(f.raw, f.bindings);
    const primary = observed.catalog.constraints.find(c => c.scope === "external-prerequisite")!;
    expect(observed.descriptorVersion).toBe(4); expect(Object.keys(observed.catalog)).toHaveLength(14);
    expect(primary).toMatchObject({ scope: "external-prerequisite", kind: "p", identity: { objectKind: "relation", object: { schema: "auth", name: "users" }, name: "users_pkey" }, keyColumns: [1],
      prerequisite: { relationOwner: { kind: "migration-owner" }, indexOwner: { kind: "migration-owner" }, column: { ordinal: 1, name: "id", type: { schema: "pg_catalog", name: "uuid" } } } });
    expect(observed.catalog.dependencies).toContainEqual({ dependencyType: "i", multiplicity: 1, dependent: '{"kind":"index","name":"users_pkey","relation":{"name":"users","schema":"auth"}}', referenced: '{"kind":"constraint","name":"users_pkey","object":{"name":"users","schema":"auth"},"objectKind":"relation"}' });
    expect(observed.canonicalJson).not.toContain("nativeOid"); expect(observed.approval).toBe(false); expect(observed.expectedCatalog).toBe(false);
  });
  it("normalizes Auth prerequisite constraint/index/UUID native OID shifts without losing semantics", () => {
    const a = fixture(), b = fixture(20000);
    const first = decodePostgresCatalogObservationV3(a.raw, a.bindings), second = decodePostgresCatalogObservationV3(b.raw, b.bindings);
    expect(second.catalog.constraints).toEqual(first.catalog.constraints); expect(second.observationSha256).toBe(first.observationSha256);
    row(a, "constraints", 2).definition = "changed but unvalidated actual definition";
    const changed = decodePostgresCatalogObservationV3(a.raw, a.bindings);
    expect(changed.observationSha256).not.toBe(first.observationSha256); expect(changed.expectedCatalog).toBe(false);
  });
  it("integrates newly captured B44 prerequisite facts only after explicit OID rekeying into a synthetic graph", () => {
    const observe = (offset: number) => {
      const f = fixture(offset);
      const ids: Record<string, string> = { "16389": f.id(11), "16392": f.id(900), "16396": f.id(301), "16397": f.id(902), "2950": f.id(9000) };
      const rekey = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rekey);
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
          if (key === "nativeOid" || key === "principalOid") {
            if (typeof item !== "string" || !ids[item]) throw Error("Unmapped captured native OID");
            return [key, ids[item]];
          }
          return [key, rekey(item)];
        }));
      };
      f.raw.constraints[2].catalog_row = rekey(capturedB44Primary.constraint) as Row;
      f.raw.indexes[0].catalog_row = rekey(capturedB44Primary.index) as Row;
      const edge = capturedB44Primary.dependency;
      f.raw.dependencies[7].catalog_row = { dependent: { class: edge.class, nativeOid: ids[edge.native_oid], subId: edge.objsubid }, referenced: { class: edge.referenced_class, nativeOid: ids[edge.referenced_oid], subId: edge.refobjsubid }, dependencyType: edge.deptype };
      return decodePostgresCatalogObservationV3(f.raw, f.bindings);
    };
    const first = observe(0), shifted = observe(20000);
    expect(first.catalog.constraints.find(c => c.scope === "external-prerequisite")!.definition).toBe("PRIMARY KEY (id)");
    expect(shifted.canonicalJson).toBe(first.canonicalJson); expect(shifted.observationSha256).toBe(first.observationSha256);
    expect(first.approval).toBe(false); expect(first.expectedCatalog).toBe(false);
    // This is a mixed synthetic graph, not a decoder PASS on a native schema5 batch.
  });
  it.each(["missing-observation", "missing-binding", "duplicate-row", "duplicate-semantic", "foreign-parent", "wrong-kind", "wrong-key", "wrong-index-key", "relation-owner", "index-owner", "index-foreign", "missing-index", "not-primary", "not-unique", "not-valid", "not-ready", "not-live", "deferred", "wrong-opclass", "wrong-type", "type-alias", "nullable-id", "dropped-id", "wrong-ordinal", "wrong-name", "missing-proof", "multiple-owners", "owner-link", "missing-edge", "wrong-edge", "foreign-binding"])("rejects unsupported or unproved Auth primary prerequisite %s", fault => {
    const f = fixture(), c = row(f, "constraints", 2), proof = c.prerequisite as Row, column = proof.column as Row, index = row(f, "indexes");
    if (fault === "missing-observation") f.raw.constraints.pop();
    if (fault === "missing-binding") f.bindings.externalFacts = f.bindings.externalFacts.filter(x => x.identity.kind !== "constraint");
    if (fault === "duplicate-row") f.raw.constraints.push(structuredClone(f.raw.constraints[2]));
    if (fault === "duplicate-semantic") { const extra = structuredClone(f.raw.constraints[2]); extra.catalog_row.nativeOid = "903"; (extra.catalog_row.identity as Row).nativeOid = "903"; f.raw.constraints.push(extra); }
    if (fault === "foreign-parent") ((c.identity as Row).object as Row).name = "other_users";
    if (fault === "wrong-kind") c.kind = "u";
    if (fault === "wrong-key") c.keyColumns = [2];
    if (fault === "wrong-index-key") index.keyColumns = [2];
    if (fault === "relation-owner") proof.relationOwner = { principalOid: "10" };
    if (fault === "index-owner") proof.indexOwner = { principalOid: "14" };
    if (fault === "index-foreign") ((proof.index as Row).relation as Row).schema = "foreign";
    if (fault === "missing-index") f.raw.indexes = [];
    if (fault === "not-primary") index.primary = false;
    if (fault === "not-unique") index.unique = false;
    if (fault === "not-valid") index.valid = false;
    if (fault === "not-ready") index.ready = false;
    if (fault === "not-live") index.live = false;
    if (fault === "deferred") index.immediate = false;
    if (fault === "wrong-opclass") index.opclasses = ["pg_catalog.text_ops"];
    if (fault === "wrong-type") (column.type as Row).name = "text";
    if (fault === "type-alias") (column.type as Row).nativeOid = "9001";
    if (fault === "nullable-id") column.notNull = false;
    if (fault === "dropped-id") column.dropped = true;
    if (fault === "wrong-ordinal") column.ordinal = 2;
    if (fault === "wrong-name") column.name = "other_id";
    if (fault === "missing-proof") c.prerequisite = null;
    if (fault === "multiple-owners") (proof.indexConstraints as unknown[]).push(structuredClone((proof.indexConstraints as unknown[])[0]));
    if (fault === "owner-link") (proof.indexConstraints as Row[])[0].name = "other_constraint";
    if (fault === "missing-edge") f.raw.dependencies.pop();
    if (fault === "wrong-edge") row(f, "dependencies", 7).dependencyType = "n";
    if (fault === "foreign-binding") f.bindings.externalFacts.find(x => x.identity.kind === "constraint")!.identity.object = { schema: "foreign", name: "users" };
    invalid(() => decodePostgresCatalogObservationV3(f.raw, f.bindings));
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
