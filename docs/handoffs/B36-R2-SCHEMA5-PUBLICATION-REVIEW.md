# B36-R2 — Corrected schema5 publication design review

**Verdict: PASS for the corrected source/design contract. F36-1 is closed at design level.** No new independently substantiated mandatory contradiction was found. This does not accept an implementation, published SQL, reference artifact, database state, cross-cluster normalization result, provenance authority or runtime activation. Master retains final acceptance and allocation authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_a21c8b1e706e`; receipt `msg_e7c0a8290c0c`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen identity and performed checks

Reviewed the exact delta from original contract `0a890f4b494c76a313e8c4d6474bbee70d9ac00a` and final F36-1 review `3154e7b83479453776bf921b9f3510c1ce81aabc` to corrected **5cefa0d83e7ffbe5772346130bc24e24e7c463f4**, plus the complete amended contract. The correction commit changes only `docs/handoffs/B36-SCHEMA5-PUBLICATION-CONTRACT.md`, +92/-15, now296 lines. Independently verified LF SHA256 **c492c3e474446be9c977f7b2881f9c3d33125716083c7bf355644fbd6c20f383** and current document equality to that frozen source.

Read-only evidence included installed PG18.7 static `share/postgres.bki` definitions of pg_type/pg_class/pg_constraint/pg_trigger, unchanged v2 catalog queries/descriptors, and the original review's source/SQL/adapter comparisons. Independently rehashed BKI LF **360718603dc060a1bfefe67c4e898d16eff18580a48b8fa3b6680e8b21de2e05** and state-v2 LF **c51745a4c482732a428374831690ebd1eb5ee310487221cf9a95858465c77f70**. Current43 protected postgres/model/service/repository/CLI/package/config files matched the fixed correction commit; no protected source edit was made by this review.

Performed only text/diff/shape inspection and file hashing, followed by report whitespace/selective-commit checks. No SQL parser, tests, DB connection/process, native/reference run, SQL generation/publication, fuse removal, code/mock/registry/package/env change, provider/browser request, build/deployment or new agent/window/worktree was used.

## F36-1 closure

| Required correction | Frozen source and independent assessment |
| --- | --- |
| Fourteenth category | Contract171–178 explicitly includes `types: readonly NonDomainTypeRow[]`; the closed shape has exactly14 unique arrays. All profiles require it at68; old13-array input, missing fields and empty substitute defaults reject. Domains remain separate. |
| Strict composite/array representation |147–162 define shared owner, kind/category, defined/preferred/layout/default/collation, I/O/subscript function identities and ACL properties. Only table-composite c/C and generated-array b/A variants are permitted; unrelated standalone composite/base/enum/range/pseudo types cannot be adopted. All namespace types must be collected before strict partitioning. |
| Native links and ACL distinction | RelationRow has rowType/ofType; type relation/element/array references are explicit and reciprocal. Section4.1 requires class.reltype↔type.typrelid and element.typarray↔array.typelem checks, not matching names alone. aclIsNull preserves raw NULL versus explicit ACL alongside effective grantor-bearing ACLs; domain arrays and I/O links are covered. |
| Constraint metadata |104–118 include contype t, enforced/period/validation/deferral, relation-or-domain identity, parent/supporting-index/referenced relation, ordered key/operator arrays and actions. The six declared deferred constraint-trigger records are representable; existing v2 descriptors actually contain these t rows at1029/1102–1104/1190/1248. No nonexistent conisinternal field is invented. |
| Named/internal trigger distinction |127–140 separate literal named/internal=false definitions from internal=true structural records. Both carry actual function, typeBits, enabled/deferral, parent constraint/trigger, related relation/index, argument count/bytes, columns, WHEN and transition metadata. All scoped pg_trigger rows must be collected; v2's NOT tgisinternal filter is explicitly rejected. |
| External Auth FK closure |191 includes action-side triggers on external auth.users when their native tgconstraint resolves to an owned FK. Exact reached prerequisite index rows have external-prerequisite scope and full IndexRow properties. This does not adopt unrelated Auth triggers/indexes or allow a different native FK/index merely because UUID uniqueness still holds. |
| Scope/count preservation |The38 count remains named noninternal triggers only, including the six declared constraint triggers. Internal triggers and all required types have separate exact inventories to be frozen later.32 business tables plus history,57 policies,18 functions/two definers remain sanity totals, not replacement comparison criteria. |

The installed static BKI field declarations support these proposed projections: pg_type3434, pg_class3837, pg_constraint3888 and pg_trigger7117. That is evidence of available native fields, not observed correctness of a future decoder, SQL query or reference generator. The original representability gap is resolved without changing SQL or weakening old tools.

## Structural identity and hash boundary

Sections4.1–4.2 now define stable constraint keys by object-kind/qualified relation-or-domain/name and index keys by qualified relation/name. Internal trigger identity resolves actual tgconstraint first, then includes that parent, attached relation, qualified RI function signature, typeBits and constraint relation/index links. It can distinguish check/action-side events without relying on generated names or OID suffixes. Operator references include operand types to preserve overload identity.

Generated internal tgname/native OID are diagnostic only for this explicit internal-trigger variant. Named trigger names/definitions, named constraint/index identities and function source/definition hashes remain exact, including digits. The contract prohibits digit stripping, regex suffix replacement, dropping internal rows, deduplication and target-generated expected identities. Ambiguous/broken/extra links and duplicate structural keys reject.

At201 the structural hash is explicitly domain-separated with `internal-trigger:v1\n`, canonical identity/internal/version and every TriggerProperties field, excluding the hash itself. Reference and observation must use the same independently frozen serializer. Dependency endpoints reuse strictly decoded tagged object keys and column sub-identities; there is no second name-erasing or numeric-OID substitution scheme. This is a bounded typed structural exception for internal triggers, not a general SQL/body normalizer.

The declared reciprocal class/type and element/array links are required relationships, not unexpected ancestry cycles. Implementation must preserve those explicit pairs while rejecting invalid parent/dependency traversal cycles, duplicate keys and unapproved links. No general graph deduplication or cycle suppression can be used to discard facts. This follows the specific reciprocal-link and parent-validation requirements together.

Fourteen-array decoders, query projections, reciprocal/link checks, canonical keys, internal serializer, none/pair profiles and normalizer/reference/action/attestation hash checks are explicitly synchronized at68/203/283. A frozen old hash or old shape cannot silently cover the new fields. The approved expected rows remain independent source artifacts; observed OIDs only resolve declared slots and structural identities.

## Preserved boundaries and unperformed gates

The rest of the amended contract preserves isolated v3/schema5-only, old v1/v2 closed3/4, PG18 reference restrictions, exact D/E/future-P source/body mapping and explicit adapter D→P integration. P and its reference remain absent; B34/B35 cannot be relabeled as publication or migration-runner evidence. Original fused SQL5 remains untouched.

Fresh atomic1–5, eligible4→5, exact5 no-op and drift/unjournaled/3 rejection remain specified. The common advisory lock, RC decision reads after locking, journal structure before rows, prefix/final checks, rollback/COMMIT ACK handling, retained unresolved promises and separate cleanup evidence remain implementation requirements. Prefix3/4 expectations and stronger5 eligibility must be explicitly frozen/bound during that work rather than learned from the target.

Exact M/B grantors and M→issuer ADMIN-only management exception, temporary grant removal, bootstrap-only PASSWORD NULL runtime pair and incompatible existing-pair rejection remain intact. Source publication, explicit target/action authorization, signed post-confirmation attestation/private handle and hard-OFF runtime activation remain separate. Unknown/failed cleanup cannot mint usable provenance. Actual Auth, policy authority/budgets, provider/TLS/major constraints, evolved lifecycle and B3 composition remain gates.

Before any subsequent acceptance, separately assigned work must freeze/review actual P/full-body identities, complete14-array reference/profile rows and the decoder/normalizer/serializer hashes. Section4.2's required tests must then prove missing/extra/wrong type properties, ACL nullness, I/O and reciprocal links; constraint/internal/declared trigger links and operator operands; external FK action/index scope; duplicate/swapped parent keys; and named/internal identity separation. Two authorized native fixtures with deliberately different OIDs/generated internal names must demonstrate equality only when every represented structural fact agrees. Newly represented-property drift must invalidate comparison and profile/reference/action/attestation hashes. None of these tests or cross-cluster observations occurred in this review.

Return: **F36-1 closed at design level; corrected5cefa0d design PASS.** No additional mandatory source-design finding. Report-only delivery authorizes no automatic implementation, reference creation, SQL application, target rollout or activation; Master decides the next bounded allocation.
