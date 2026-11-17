# B36 — schema5 publication, validation and target provenance contract

Status: design ready for independent review. **No publication, source generation, registry change, fuse removal, implementation, SQL parser, database/cluster, browser or deployment was executed.** Only this document is assigned. Every proposed path/API below is future work requiring its own allocation. Runtime remains OFF.

## 1. Decision and inspected implementation

Recommend a separate **runner/manifest/CLI v3 selecting schema5 only**, initially enabled solely for explicitly owned synthetic PostgreSQL18 targets. Preserve v1 and v2 code, source bytes, manifests, descriptors, target profiles, CLI syntax and provisioning template. Do not add `5` to a v2 union or loosen a complete3/4 comparison. Production-capable PG18 publication/attestation is a later explicit profile authorization; the design below defines its necessary binding, not current permission to use it.

| Alternative | Decision |
| --- | --- |
| Append SQL5 to v1/v2 / accept catalog supersets | Reject: breaks closed3/4 behavior; v2 queries omit dream_reservation and its role/ACL/body graph. |
| Generic migration/plugin framework with dynamic descriptor discovery | Reject: unnecessary interface and target-learning authority. |
| Isolated v3, fixed schema5 sources and complete PG18 reference | Recommend: small explicit transition set; old APIs continue rejecting5; one atomic transaction for fresh5. |

Inspected current sources: migration-manifest-v2.ts explicitly accepts `3 | 4`; migration-state-v2.ts:12–51 reads nine categories from only dream/dream_migrations, uses tagged native principal identity and exact frozen complete3/4 comparisons at1440–1484; migration-runner-v2.ts applies under RC/shared advisory lock and preserves a migration outcome; scripts/postgres/migrate-v2.ts rejects all schema arguments except3/4 and emits a closed record. Existing provision-template.ts is complete3-only and creates its login pair under its caller. Existing migration-target.ts supports synthetic and selected managed profiles; technical URL acceptance is not authorization or PG18 compatibility.

Read-only LF SHA256 anchors at design time:

| Existing source | SHA256 |
| --- | --- |
| migration-manifest-v2.ts | `c73a60058c29be29216fd32581a2a1ceccfbd8eca2d73013648ba6eed7578c0a` |
| migration-state-v2.ts | `c51745a4c482732a428374831690ebd1eb5ee310487221cf9a95858465c77f70` |
| migration-runner-v2.ts | `11005c7a0ac75cc11db34dfd5afc88822f0e898acfb87d1e4e218622f5efa431` |
| scripts/postgres/migrate-v2.ts | `36325c91d58270f8389799238ac6b6e93d9c7be076882f569f317423d1c10922` |
| provision-template.ts | `455938349e1790680467f151d62127bb267363b81dd4e13ce53f4a077eafc19a` |
| services/postgres/upload-reservations.ts | `9cc0cd6720604fcb163a896442a91a591a7439737be9fae85b77497619b441b5` |

Adapter baseline is5f97f007abd2272dff265f19d229e14ab609c7c3, code/fault acceptance2afbc3e. B34 actual-service normal native3749241/review862e2fb and B35 actual COMMIT-response lossbc9c107/review10ff95c prove their assigned synthetic adapter scopes. Their clusters used fuse-only derived SQL without a publication runner/history5. They do not establish a published catalog descriptor, production target authentication or migration-tool fault behavior.

## 2. Source identities: draft D, experiment E, publication P

| Identity | Meaning and required handling |
| --- | --- |
| D | Frozen fused draft fbfc48c95264eaf37826f943b5e35e9fe67fa616, `drafts/0005_upload_reservation.sql`, LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`. Remains immutable/unregistered. Current adapter target literal denotes D. |
| E | Historical synthetic derivation: remove exactly the87-character fuse at offset252, preserve all other bytes; SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e`. Authorized only for B28–35 owned tests, never a silently published checksum/history row. |
| P | Future reviewed publication file `lib/db/postgres/0005_upload_reservation.sql`; **bytes/hash are not created or known in B36**. Recommend removal of the fuse plus a narrowly reviewed publication-header/comment update, with executable SQL otherwise identical to E. Its actual new hash is mandatory even for comment-only differences. A changed executable statement instead requires a new SQL security review/reference and new adapter compatibility assessment. |

Future publication evidence must contain exact D→P diff, D/E/P full LF hashes, verified absence of the executable fuse in P and an explicit executable-body comparison with E. Do not replace the draft, fabricate P=D, store E under D, erase the fuse at load time or select files by directory scan. Only CRLF→LF normalization is allowed; BOM/trimming/reformatting is a source change. Verify full P before stripping its one known outer BEGIN/COMMIT for runner-owned execution; bind the extracted-body hash separately. No general SQL splitter.

The v3 manifest contains exactly ordinals1–5. Entries1–4 remain byte/checksum-identical: `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`, `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. Row5 id is `0005_upload_reservation`, checksum **P**, not D/E. No placeholder hash is executable.

At later adapter integration, keep the13-field target's `sql5Sha256` meaning as the selected actual source identity: publication target must carry P and match the frozen publication manifest. The present D literal cannot validate P. A separately reviewed service change must select the fixed published pin and reject D/E for publication mode. Preserve D-based historical fixture behavior on its frozen commit; do not silently relabel B33–35 evidence, repin old harnesses, or claim those runs exercised P. Published-source unit/native fixtures and a new reference must be reviewed even if function bodies are equivalent. An opaque provenance record additionally binds P, descriptor hash and adapter source identity; a hash alone authorizes nothing.

## 3. Complete catalog scope and reference construction

The owned DDL contract covers three namespaces: dream, dream_reservation, dream_migrations. **32 business/companion tables** means30 in dream plus2 in dream_reservation; journal history is a separate33rd table. All32 have ENABLE+FORCE RLS; history has its separate exact non-RLS owner-only contract.

| Set | Exact names |
| --- | --- |
| Original18, dream | activity_log, assets, backups, characters, exports, generations, jobs, plans, project_assets, project_characters, projects, renders, review_items, scene_versions, scenes, settings, stage_states, timeline_revisions |
| SQL4's12, dream | storage_policy_versions, storage_policies, storage_objects, upload_intents, storage_verification_operations, storage_verification_runs, storage_verification_receipts, asset_receipt_state, storage_cleanup_claims, storage_outbox, storage_capability_issues, creation_operations |
| SQL5's2, dream_reservation | upload_policy_versions, upload_requests |

Sanity totals from the fixed source: policies43+14=57; noninternal triggers18 guard_row +12 storage_guard +6 deferred storage constraint triggers +2 immutable_history =38. There are9 functions in dream and9 new functions in dream_reservation; exactly2 new SECURITY DEFINER entries and zero other definers. Counts supplement exact rows; they never replace definitions or allow extra objects.

The nine new signatures are canonical_json_v1(json,integer), parse_wire_v1(text), client_v1(text), policy_v1(text), epoch_ms_v1(bigint), immutable_guard_v1(), replay_v1(uuid,uuid,text), read_upload_seed_v1(uuid,text), reserve_upload_v1(uuid,text,text), all in dream_reservation. Seven are invoker; only the two public entries are definer, VOLATILE, owner issuer, exact `search_path=pg_catalog, pg_temp` / `row_security=on`. Six invoker helpers receive issuer EXECUTE; immutable_guard_v1 does not get that extra grant. The unchanged SQL1–4 functions/domains/definitions are included in the full reference, with SQL5's explicit existing-object ACL/constraint deltas applied.

Build the expected artifact later on a **different owned PG18.7 UTF8/C reference cluster**, from checksum-verified P and fixed SQL1–4 plus the exact journal/provisioning recipe. Record commands/source/environment/hashes/role creation order, inventory and teardown. Independently inspect it and freeze explicit expected rows + descriptor schema/normalization version + renderer/server build + source manifest hash. The runtime target cannot generate, update, repair or choose its expected descriptor. A matching count or SQL5's bounded `$inventory$` block is not complete5. No expected5 artifact was materialized in B36; absence of its approved hash is a hard implementation/execute gate.

Use explicit known no-login and provisioned-pair principal profiles, not an arbitrary list of allowed logins. Full expected catalog content is fixed; per-deployment native OIDs are separate facts bound to known slots after trusted creation/validation. Learning those validated OID bindings does not permit learning expected function bodies, ACLs, constraints or policy expressions from the target.

The reference artifact's closed envelope is `{referenceVersion:1, serverMajor:18, publicationSha256:P, normalizerSha256, profiles:{none:Catalog5, pair:Catalog5}}`, with exactly those two profiles. Hash the complete artifact and each chosen profile canonically; action/attestation binds the chosen profile hash as well as the artifact hash. A pair may not downgrade to none during verification to avoid checking unexpected login edges. Native reference generation must record both separately authorized setup stages; profile variants are explicit source artifacts, not target-generated exceptions.

## 4. Fully typed descriptor/decoder contract

New reader queries all three namespaces using fixed pg_catalog statements and strict result decoders. Do not carry v2's `Record<string,unknown>` descriptor type into the new acceptance boundary. The following are required row fields (named fields, all readonly); optional native values use explicit null, not omitted/undefined/coerced values. Unknown keys, duplicate row keys, unsafe OIDs/counters, malformed arrays and NULL booleans fail before comparison.

```ts
type Principal =
  | { kind: "migration-owner" } | { kind: "bootstrap" } | { kind: "public" }
  | { kind: "reserved-role"; name: "dream_api" | "dream_worker" |
      "dream_upload_reserver" | "dream_api_login" | "dream_worker_login" };
type Acl = { grantor: Principal; grantee: Principal;
  privilege: "CREATE" | "USAGE" | "EXECUTE" | "SELECT" | "INSERT" | "UPDATE" |
    "DELETE" | "TRUNCATE" | "REFERENCES" | "TRIGGER" | "MAINTAIN";
  grantable: boolean };
type ObjectRef = { schema: "dream" | "dream_reservation" | "dream_migrations";
  name: string }; // compared with the exact frozen named inventory, never a wildcard
type SchemaRow = { name: ObjectRef["schema"]; owner: Principal; acl: readonly Acl[] };
type RelationRow = ObjectRef & { kind: "r"; owner: Principal; rls: boolean;
  forceRls: boolean; persistence: "p"; replicaIdentity: string;
  isPartition: false; options: readonly string[] | null; acl: readonly Acl[] };
type ColumnRow = { relation: ObjectRef; ordinal: number; name: string; type: string;
  notNull: boolean; identity: string; generated: string; dropped: boolean;
  defaultExpression: string | null; collation: string | null; acl: readonly Acl[] };
type ConstraintRow = { relationOrDomain: ObjectRef; name: string;
  kind: "p" | "u" | "f" | "c" | "n"; deferrable: boolean; initiallyDeferred: boolean;
  validated: boolean; local: boolean; inheritedCount: number; noInherit: boolean;
  parent: ObjectRef | null; definition: string };
type IndexRow = { relation: ObjectRef; name: string; unique: boolean; primary: boolean;
  valid: boolean; ready: boolean; live: boolean; immediate: boolean;
  nullsNotDistinct: boolean; accessMethod: string; keyColumns: readonly number[];
  includeColumns: readonly number[]; opclasses: readonly string[];
  collations: readonly (string | null)[]; options: readonly number[];
  expressions: string | null; predicate: string | null; definition: string };
type PolicyRow = { relation: ObjectRef; name: string; permissive: boolean;
  command: "*" | "r" | "a" | "w" | "d"; roles: readonly Principal[];
  usingExpression: string | null; checkExpression: string | null };
type TriggerRow = { relation: ObjectRef; name: string; enabled: string; typeBits: number;
  deferrable: boolean; initiallyDeferred: boolean; functionSignature: string;
  columns: readonly number[]; argsHex: string; whenExpression: string | null;
  oldTransitionTable: string | null; newTransitionTable: string | null; definition: string };
type FunctionRow = ObjectRef & { identityArgs: string; declaredArgs: string; result: string;
  language: "sql" | "plpgsql"; owner: Principal; kind: "f"; securityDefiner: boolean;
  leakproof: boolean; strict: boolean; returnsSet: boolean; volatility: string;
  parallel: string; argumentTypes: readonly string[]; allArgumentTypes: readonly string[] | null;
  argumentModes: readonly string[] | null; argumentNames: readonly string[] | null;
  config: readonly string[] | null; sourceSha256: string; definitionSha256: string;
  acl: readonly Acl[] };
type DomainRow = ObjectRef & { kind: "d"; baseType: string; owner: Principal;
  notNull: boolean; defaultExpression: string | null; acl: readonly Acl[] };
type DefaultAclRow = { owner: Principal; schema: ObjectRef["schema"] | null;
  objectKind: string; acl: readonly Acl[] };
type DependencyRow = { dependent: string; referenced: string;
  dependencyType: string }; // stable qualified identities, never raw OID substitution
type RoleRow = { principal: Exclude<Principal, {kind:"public"}>; login: boolean;
  superuser: boolean; bypassRls: boolean; inherit: boolean; createRole: boolean;
  createDb: boolean; replication: boolean; config: readonly string[] | null };
type MembershipRow = { member: Principal; parent: Principal; grantor: Principal;
  admin: boolean; inherit: boolean; set: boolean };
type Catalog5 = { descriptorVersion: 1; serverMajor: 18; roleProfile: "none" | "pair";
  schemas: readonly SchemaRow[]; relations: readonly RelationRow[];
  columns: readonly ColumnRow[]; constraints: readonly ConstraintRow[];
  indexes: readonly IndexRow[]; policies: readonly PolicyRow[]; triggers: readonly TriggerRow[];
  functions: readonly FunctionRow[]; domains: readonly DomainRow[];
  defaultAcls: readonly DefaultAclRow[]; dependencies: readonly DependencyRow[];
  roles: readonly RoleRow[]; memberships: readonly MembershipRow[] };
```

Implement every decoder with strict shapes/enums/ranges and immutable detached values; type aliases alone are not validation. Expected sets/enums for string fields are the frozen reference's exact values, not arbitrary identifier acceptance. Include table-owned composite type/array dependencies and automatically generated NOT NULL/FK/index/internal-constraint metadata through explicit subordinate inventory; unexpected relations/types/sequences/views/functions fail. Definition/body hashes are exact UTF8/native-rendered reference values; no trimming, whitespace regex, current-target function reserialization or “same signature” substitute. For functions bind owner, language/security/volatility/config/argument identity **and actual prosrc SHA256**, including the two definer bodies. Dependencies may leave the owned schemas only through a reviewed explicit pg_catalog/language/Auth prerequisite allowlist; no new issuer dependency on another user's function/schema is accepted.

Canonicalization: sort row sets by explicit composite keys and ACL sets by complete grantor/grantee/privilege/grantable tuple; reject duplicates rather than deduplicate. Preserve column ordinal, index key/include order, function argument/config order and expression bytes. Resolve principals using native OID equality to independently approved slots, PUBLIC only OID0; unknown owner/grantor/grantee/role is rejected. Never interpret names `owner`, `$owner`, `PUBLIC` or JSON-looking text as tags. When bootstrap performs inspection, migration-owner still means the approved M OID, not current/session_user=root. No unapproved object may define its own owner slot.

Inspect history's native kind/owner/columns/constraints/indexes/ACL/RLS/triggers before reading its rows, excluding a substituted view/function/policy. Exact journal has ordinals1–5/id/checksum(P for5); applied_at must be valid nonnull native timestamptz, but its deployment-specific value is not a golden timestamp. The complete5 descriptor includes journal structure and all owned DDL; it excludes business row contents, statistics/sizes, passwords and irrelevant unrelated namespaces. External auth.users must independently satisfy UUID NOT NULL unqualified unique id/REFERENCES/USAGE and exact required FK dependencies. This is full declared owned-DDL validation, not a promise to detect every arbitrary DBA action forever.

## 5. Roles, ACLs and bounded management exceptions

M=migration owner, B=trusted bootstrap, A=dream_api, W=dream_worker, R=dream_upload_reserver. Bind M/B separately by approved native OIDs and database identity. M is non-superuser/non-BYPASSRLS, NOINHERIT, CREATEROLE with database/schema/Auth prerequisite authority; B is the separately approved actual superuser required by fixed SQL5. Apply session_user/current_user must both be M. No SET ROLE/management credential is available to a request or runtime login.

Final A/W/R flags are NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB, NOCREATEROLE, NOREPLICATION. The narrowly allowed automatic administrative membership is **M→R, grantor B, ADMIN true / INHERIT false / SET false**, exactly one edge touching R after apply. Validate corresponding pre-existing M→A/W administrative edges exactly as the independent reference/provisioning recipe records, rather than v1/v2's broad owner-name exception. Unknown grants/inbound/outbound/transitive paths, wrong grantor or changed options fail. Reference/global graph inspection must include all reachable edges and unknown inbound reserved-role edges; reject a non-superuser login path into M. Trusted superuser administration is not a runtime isolation guarantee.

SQL5 temporarily grants M→R SET (its separate grantor path), grants R CREATE on dream_reservation, transfers only the two entry functions to R, then revokes that temporary grant/CREATE. Verify the final reference has only B's original ADMIN-only edge; no lingering SET/INHERIT, extra ownership or temporary CREATE. These narrowly scoped DDL steps remain inside the single transaction. Do not revoke the final allowed ADMIN edge “for safety”: that changes fixed SQL5 and its reviewed management model. Do not loosen old3/4 graph functions to accommodate5.

R owns exactly the two entry functions, no namespace/table or extra function. dream_reservation is owned by M; its exact four ACL entries are M→M CREATE/USAGE, M→A USAGE, M→R USAGE, all nongrantable. Entry EXECUTE ACL grantor is R and grantees exactly R/A; helpers have their exact M/issuer grants, no PUBLIC/API/worker helper access. Pin inherited/default ACLs as well as explicit grants. R's SELECT is exactly nine tables; INSERT exactly storage_objects/upload_intents/upload_requests; column UPDATE exactly storage_policies.policy_id and storage_objects.id, with their FOR UPDATE lock policies and WITH CHECK false. The14 exact added policies/commands/expressions and all prior policies remain in the full reference. No broad UPDATE, worker grants, grant options, API CREATE or extra definer is accepted.

**Provisioning choice:** schema migration does not create runtime logins or passwords. A separate approved B action, after exact complete5 inspection under the same lock, may create the fixed `dream_api_login` / `dream_worker_login` pair with PASSWORD NULL, all restricted flags and only login→A/W ADMIN false / INHERIT false / SET true, grantor B. A superuser bootstrap creates them so it does not leave M's automatic ADMIN edge into a LOGIN role. The current adapter rejects incoming membership to its session login; treating that incoming ADMIN as harmless would contradict actual identity checking. Existing v1 templates remain unchanged. A known4 login pair is eligible only if it already satisfies the exact new graph, including no incoming login ADMIN edge; otherwise reject, with a separate explicitly reviewed remediation task rather than adoption/revocation here. Existing logins are never auto-altered. Credentials remain out of band; PASSWORD NULL prevents connection until separately authorized secret provisioning.

Catalog5 has two explicit principal profiles: no runtime logins, or the exact pair. Approval binds the intended profile. Runtime provenance requires the pair. Reference content is not an arbitrary allowance for any matching-name/login set. All application table/column/default/function ACLs and their grantors are checked, including implicit defaults resolved by acldefault; global issuer ownership and login object/management ancestry are also inspected.

## 6. Closed state transitions, history and lifecycle

Schema5 eligibility is stronger than merely “v2 returned complete4”: operator M/B identity, actual PG18, UTF8/C reference compatibility, no dream_reservation/R, exact administrative grantors/default ACLs and allowed login profile must also match. A superuser-owned known4 or a pair with extra ADMIN edges is rejected; no silent ownership transfer or role repair. Existing SQL5 fixture objects without history5 are unjournaled drift, including B34/35-style test databases.

| Observed state after shared lock | v3 apply schema5 | v3 dry-run |
| --- | --- | --- |
| Fresh: no dream/dream_reservation/dream_migrations or A/W/R/runtime-login roles; M/B/Auth prerequisites valid | Apply1–5 atomically, applied5/pending0 | pending5, no writes |
| Exact eligible known4, history1–4 | Apply only P, applied1/pending0; preserve rows1–4 | pending1 |
| Exact complete5 P + matching role profile | No DDL/backfill, applied0/pending0 | pending0 |
| Known3 | Reject direct3→5; explicit old-v2 3→4 is a separately approved prior action | Reject |
| Partial/extra/gap/duplicate/unknown/checksum history or substituted journal | Reject; never repair/resume | Reject |
| Catalog5 without history5, history5 without exact catalog, P≠recorded checksum, D/E journal, wrong major/roles/ACL/body/defaults/dependencies | Reject unchanged | Reject unchanged |

Use the **same advisory transaction lock (1725031001,5)** as v1/v2/provisioning; a version-specific new key would allow overlap. Apply BEGIN READ COMMITTED, fixed pg_catalog search_path, finite statement/lock/idle/attempt/finalization/cleanup limits, then acquire lock **before** decision reads. Reinspect after a prior winner commits. Fresh5 creates the exact journal and executes verified bodies1–5 in one transaction, validating complete3 and complete4 prefixes before P and full complete5/history before COMMIT. No intermediate commit3/4. Known4 executes P only. SQL5's trusted `dream.b27_*` settings are parameterized SET LOCAL values from the validated M/B/actual-major record, not request/environment selectors. No policy fixture INSERTs or operational defaults are part of schema migration.

Before-COMMIT errors roll back all invocation changes; fresh failure returns to fresh, upgrade failure preserves original4 including history/data. Constraint validation or lock timeout may legitimately fail on populated4; never delete/backfill data or relax constraints to pass. A sole original exact ROLLBACK ACK observed before outcome selection preserves not-applied even after wrapper expiry. If rollback cannot be confirmed after DDL may run, outcome is unknown. Query race/rejection is not server-idle proof: no rollback/hygiene/COMMIT is queued onto poisoned or unresolved work. Normal SQL dispatch rechecks cancellation/deadline before sending and before dispatch flags change.

COMMIT dispatch becomes unknown; actual original COMMIT ACK irreversibly becomes committed even if cancellation/cleanup later fails. Preserve original promises/late error ownership, positive client end and pool.end separately with finite cleanup; unresolved original work means cleanup failed. Return a closed `{outcome: not-applied|committed|unknown, cleanup: ok|failed, phase, safeCode, targetHash, actionHash}` and permitted manifest/plan counts; confirmed-commit cleanup failure retains known result. No SQL/DSN/driver error/cause or customer callback in finalization. Do not copy v2's implementation as if B33's stricter query/lease evidence already validated migration v3.

Lost COMMIT response must never trigger DROP/DELETE/automatic retry or mint provenance. A new separately authorized primary inspection verifies exact history5/P + complete descriptor + role graph. Exact complete5 then supports an approved no-op/attestation action; absence/drift is not proof of rollback without appropriate state inspection. Mixed v1/v2/v3 callers share the lock: a v3 waiter can upgrade a preceding exact4; an old3/4 tool encountering committed5 still rejects. Locking covers cooperating tools, not arbitrary DBA DDL.

Dry-run uses READ ONLY REPEATABLE READ and no DDL/history/role/lock mutation. It is a point-in-time plan, cannot reserve a future state and cannot approve apply. Apply always repeats checks under RC/lock. Cleanup/release/socket closure and migration durability are distinct; B35's native reservation ACK-loss proof is not a migration-v3 lost-response test.

## 7. Approval, native facts and internal approved provenance

Separate three authorities: (1) fixed source/descriptor publication; (2) explicit target/action authorization; (3) runtime activation. None implies the next. A human/tool-created fingerprint is not authorization. No self-approval by copying an inspector's hash into another environment variable.

Define a fixed canonical action record, domain `postgres-publication-action:v3`, including runner3/schema5, command/mode (`dry-run`, `apply`, `provision-logins`, `attest`), targetHash, independently approved database-identity hash, expected pre-state/profile, ordered1–5 manifest(full/source-body hashes), descriptor/normalizer version+hash, actual-major18, M/B OID/identity bindings, provisioning recipe hash, finite bounds, approval ID/expiry/nonce. Endpoint targetHash preserves current profile-specific canonicalization and excludes passwords; database identity additionally binds trusted native system identifier/database OID plus the authenticated transport endpoint. M apply and B provisioning use separate actual-login/target/action approvals for the same database identity. Fresh function/R OIDs do not exist at approval time: creation is bound to known slots/recipe, and exact validated assigned OIDs are captured only afterward.

Initial v3 permits only explicit synthetic target, verified owned loopback/dream_test DB; no implicit env target, general DATABASE_URL/PG fallback, URL query/hash, external pool/client/hooks or import-time operation. Future nonlocal PG18 profile needs separately reviewed target/TLS authorization and privileges. Reuse migration-target.ts unchanged for existing canonical target hashes, then apply a stricter v3 profile allowlist and actual-major check before any DDL. Do not expand its old accepted profiles or change old tools to enforce new5 policy. CLI fingerprint performs source verification only; network inspection, apply, provisioning and attestation are separate commands/actions and emit a single closed redacted result.

Proposed exact new CLI grammar (not executed): `fingerprint --schema 5 --mode dry-run|apply|provision-logins|attest`, or one of `dry-run --schema 5`, `apply --schema 5`, `provision-logins --schema 5`, `attest --schema 5`. Extra/repeated flags, schemas3/4/6, missing explicit mode/schema and secret CLI arguments reject preconnect. All network commands require the corresponding independently authorized action; dry-run is read-only validation/plan, never apply approval. Source paths/reference artifacts come only from the frozen v3 module, with no caller-controlled sourceRoot/manifest/catalog override. This creates no package script and does not change migrate-v2 syntax.

Trusted provisioning/verification creates an attestation only after **confirmed** migration/provision COMMIT and a fresh primary full-catalog/graph inspection. Unknown outcomes or failed cleanup produce no usable attestation. Bind at least P, complete descriptor hash, adapter contract/source hash, database identity, target transport hash, approval/action IDs, expiry/revocation generation, policy-record provenance digest and these13 target facts: schemaVersion5, sql5Sha256=P, serverMajor18, loginOid, apiRoleOid, apiMembershipGrantorOid, issuerRoleOid, migrationOwnerOid, bootstrapOid, readSeedFunctionOid, reserveUploadFunctionOid, provenanceId, scope. The two function OIDs map to their exact frozen signatures/bodies; the login edge grantor maps to B. Do not derive a new expected descriptor from those live OIDs.

For cross-process persistence, recommend a small fixed canonical attestation record signed with Node's built-in Ed25519 by the separately trusted bootstrap/verification operator. Private key and signing authorization are out of band; the verifier has a pinned key ID/public key from trusted deployment configuration, never a key supplied by the target/request/record. This is not a new remote trust service. No keys/signatures are generated in B36. Validate signature, closed shape, target/transport/database binding, action/P/descriptor/adapter hashes, scope, expiry, revocation and fresh role/function/native identity checks before use. A checksum/provenanceId/plain JSON signature field is not authentication. Privileged system-identifier/full-catalog collection stays in the authorized management verifier; never grant new pg_control/catalog superuser privileges to the API login merely to attest it.

Inside the server process, successful trusted verification mints an opaque frozen handle registered in a private WeakMap; only the internal resolver can access its immutable13-field facts. Copying/JSON serialization/type assertion cannot mint membership. Reload/restart requires trusted verification again; serialized JSON alone cannot recreate a usable handle. Revalidate at a finite lease/revocation boundary and keep per-attempt actual role/function/actor checks. Signed observations do not guarantee that a trusted DBA never changes state after inspection; unexpected drift/revocation fails closed, never repins an expected OID/body.

Existing owned-synthetic POJO API remains explicitly synthetic; approved-runtime POJO stays DISABLED. A future separate approved factory must require the genuine internal handle, not accept caller-supplied target facts or downgrade failed approval to synthetic. Every approved-runtime path also requires an independently reviewed activation gate, still hard OFF in publication/provenance work. Issuing/verifying an attestation must not itself enable a service, route, signing/provider operation or deployment.

## 8. Environment and runtime readiness gates

Actual PG18 is required, with reference initially PG18.7 UTF8/C. Major18 is necessary but exact descriptor/deparser/build compatibility must still pass; a differing18 patch/locale/executable reference is rejected until reviewed, not normalized into equivalence. The fixed SQL5 requires a trusted actual bootstrap superuser and non-superuser CREATEROLE owner with empty createrole_self_grant. A managed provider may lack those privileges even on18; a future adapted managed recipe is separate SQL/security work.

The supplied Supabase17 context is **unsupported for this schema5 release**, while unchanged3/4 tooling retains its existing16+ behavior. No PG17 descriptor is synthesized or major check bypassed. Reported managed SSL/certificate blocker and Free50MB versus the client's maximum2GiB remain separate unresolved operating constraints, not reasons to stop the owned-PG18 design. They are supplied deployment context, not freshly verified provider specifications. No IP/TLS verification bypass, transaction pooler, tier upgrade or paid action is authorized. A future approved managed check must verify actual major, authority, TLS and real tier/bucket limits rather than infer them from this document.

Publication can leave the new policy-body table empty while old current policy metadata exists: that is structurally complete5 but **runtime not ready**. Separate approval must bind immutable policy body/version/digest, issuer/collector/verifier/manager principals, provider permissions, actual object limits, TTL/preparation windows and finite rate/concurrency/total-byte/storage budgets. Runtime byte caps take the verified minimum of client/policy/provider limits; do not reuse synthetic1MiB/TTL values as operating defaults or claim2GiB is provider permission. Actual Auth principal verification, evolved lifecycle executors, B3 top-level transaction composition and restricted deployment/native verification remain gates. Schema/source/provenance acceptance alone supplies none of these.

Policy body/result/source SHA256 values are unkeyed integrity bindings, not policy-issuer authentication. Require a separately authorized trusted policy publication record (issuer identity, target/action, body/version/digest and current-pointer binding); its authority must be verified by the trusted operator/attestation signer. Provider access and limits need their own authenticated evidence. Neither matching SQL rows nor a synthetically chosen digest proves those permissions. The published-native adapter fixture may use P through the explicit owned-synthetic path; tests of genuine approved handles must still observe the hard-OFF activation gate rather than enable it to obtain a passing native test.

## 9. Concrete later files and acceptance order

These are proposed allocations, **not files created/authorized in B36**. Keep stages small and independently reviewed.

| Stage | Exact proposed files / minimum changes | Completion and independent gate |
| --- | --- | --- |
| Publication/source contract | new lib/db/postgres/0005_upload_reservation.sql; migration-manifest-v3.ts; tests/postgres/schema5-source.test.ts | Freeze actual P/body hashes and exact D/E/P mapping; retain old1–4 and v1/v2 rejection tests. Independent SQL/source diff first; no target apply. |
| Reference/typed state | new lib/db/postgres/migration-catalog-v3.ts; catalog/schema5-pg18.json; migration-state-v3.ts; tests/postgres/schema5-state.test.ts; tests/schema5-reference-native-owned.ts | Separate owned reference creation then freeze/review strict typed expected rows/normalizer/P binding; native mutations for every row category, tag collision, grantor/default/transitive/definer body/RLS/trigger/index/FK fail before journal read. Preserve old3/4 descriptor artifacts. |
| Explicit migration | new lib/db/postgres/migration-runner-v3.ts; scripts/postgres/migrate-v3.ts; tests/postgres/schema5-migrations.test.ts; tests/postgres/schema5-cli.test.ts; tests/schema5-migrations-native-owned.ts | Closed schema5/transition/actions, lock/RC/atomicity/history/unknown/late rollback/lease tests, concurrent real winner/waiter evidence and actual migration COMMIT-response-loss test. Existing target/connection/lock exports reused without editing behavior. |
| Bootstrap pair/attestation | new lib/db/postgres/provision-v3.ts; reservation-provenance.ts; tests/postgres/schema5-provenance.test.ts; tests/schema5-provision-native-owned.ts | Separate approved bootstrap action/password-null pair; full graph/provenance signature/target/action/expiry/revocation/forgery tests; no token on ambiguous commit/drift. Existing provision-template.ts remains3-only. |
| Published adapter compatibility | separately scoped edit lib/services/postgres/upload-reservations.ts and tests/postgres/reservation-attempt.test.ts; new tests/reservation-published-native-owned.ts | Change published pin to P via fixed manifest, genuine internal-handle path while activation OFF; strict wrong-D/E/P/source/OID rejection and new actual P adapter tests. Attempt/client/reply/codec/model modules need no change for header/fuse-only publication unless an independently reviewed mismatch proves otherwise. Historical B34/35 sources and proof identities remain frozen. |

Future migration-native matrix must include fresh→5, eligible4→5 with real existing data, exact5 no-op,3 reject, drifted/unjournaled5 reject, prefix/history failure rollback, temporary-grant failure rollback, retained automatic ADMIN-only edge, bootstrap pair boundary, wrong native major/target/Auth/owner/reference/default ACL, mixed old/new lock serialization, lost COMMIT and explicit same-target reinspection, late ACK/unknown versus cleanup evidence. Source/unit tests precede separately authorized owned native runs; Tester's independent source/reference review precedes independent native acceptance. Only then can Master consider a separately authorized target/environment rollout. No automatic “next version/latest” or old3/4 relaxation is part of the proposal.

## 10. Work actually performed and return

B36 read the named local sources/reviews and computed the listed LF hashes; wrote only this document. No reference generator, SQL parser, tests, PG process, new cluster, packet interception, browser/managed/provider request, config/key/package change, build or deploy was run. Document diff/whitespace and one-path commit checks are the validation for this design. Implementation/native matrices above are **not performed results**.

Copyable return: B36 recommends isolated v3/schema5-only publication/typed full PG18 reference and signed target/action/provenance boundaries, preserving v1/v2 closed3/4. D9d347/E16e5/P-unset identities and current adapter D→futureP compatibility are explicit; 32 business tables plus journal, exact role/grantor/ADMIN/temp privilege graph and bootstrap-only login provisioning are defined. Fresh/eligible4→5/exact5/no-adoption/unknown semantics and exact later paths/test order are specified. No SQL/code/DB/publication/activation performed; request independent one-document design review before any implementation assignment.
