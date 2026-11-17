# B27-FIX — UUID grammar and namespace ACL source corrections

Status: **ready_review; source-only correction, not independently accepted or native-tested**. Scope is existing `lib/db/postgres/drafts/0005_upload_reservation.sql` plus this new report only. Master assigned `msg_15a0c25e8a7c`, clarified `msg_04a4fbd49bd8`, and confirmed final-review completion conditions in `msg_11e0a2f1b02a`.

Final independent report **read in full before fixing this return**: `docs/handoffs/B27-R-UPLOAD-RESERVATION-SOURCE-REVIEW.md`, commit `9b8fb17a3d387b97e7f6aa93844e15a5f5f02cac`. It reviewed original B27 `dfb521c5a367a2db0827fdf392f24df6559fce3b`, SQL LF SHA256 `020cf51f38b78c7926cdf696ee2214c8566b13a0c521a2c5f95695cfa49d9bb1`. It identifies exactly **F27-1 and F27-2**, with no additional mandatory gap. The minor omitted POLICY tag is corrected below. Original B27 handoff/review, B26 and accepted B25 remain unchanged; this report does not rewrite their historical verdicts.

Corrected SQL: **543 lines**, LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`. Compared with the original fixed source, the SQL delta is +34/-2 lines. These are source facts, not database acceptance evidence.

## Corrections

| Finding | Source correction | Actual evidence / remaining boundary |
| --- | --- | --- |
| F27-1: broad authority version nibble, missing nil/max | All three policy authority arrays now require a 36-character lowercase UUID with RFC version 1..8 / variant 8,9,a,b **or exact nil/max alternatives**. Pin C collation for the SQL predicate. | Installed Zod 4.6.7 `node_modules/zod/v4/core/regexes.js:25` compared with `lib/storage/uploads/schema.ts:3` lowercase refinement and B25 `request()`'s exact length36 guard. Source-pattern/shared/B25 pure comparisons passed; PostgreSQL policy/envelope execution remains untested. |
| F27-2: namespace inventory missing | Require native namespace owner OID equal trusted migration owner; expand `nspacl` (or native owner default); require exactly four ACL facts and bidirectional EXCEPT equality to the closed typed allowlist. Emit namespace OID/owner/grantee/grantor/privilege/grantability facts. | No role-name marker substitution, no target-learned allowlist, no broad/default-ACL correction. Static inspection only; native ACL negatives and actual owner ACL representation remain required. |

Exact UUID predicate after JSON-string/length checks:

```text
^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$
```

Nil/max acceptance preserves the existing general authority-ID schema; it is not a claim that those IDs correspond to an authenticated or provisioned principal. Actual actor Auth and policy provenance remain separate. Record IDs continue using unchanged UUIDv7 checks. No shared/Zod/B25 implementation changed.

Exact namespace ACL facts, where **M, A and R are native OIDs** for the approved migration owner, existing API and new reserver:

| Grantee OID | Grantor OID | Privilege | is_grantable |
| --- | --- | --- | --- |
| M | M | CREATE | false |
| M | M | USAGE | false |
| A | M | USAGE | false |
| R | M | USAGE | false |

Owner implicit grant capability is not an ACL WITH GRANT OPTION bit. Both unexpected and missing facts fail with `B27_SCHEMA_ACL`; wrong owner fails `B27_SCHEMA_OWNER`. The row-count check also rejects duplicate expanded facts. PUBLIC (OID0), worker, unrelated principals, extra CREATE, grant options and wrong grantors are outside the allowlist. Existing named REVOKEs and forbidden-effective-privilege/management-path checks remain. Unexpected creator defaults must cause full migration rollback, not global/default-setting mutation.

## Source-only vector result and reproduction

Executed on installed dependencies using Node with tsx, **no database, SQL parser, policy function or role execution**. Sixty vectors: 34 accepted (versions1..8 × four variants, nil, max), 26 rejected (versions0/9/a..f, invalid variants0..7/c..f, uppercase/malformed/trailing data). The SQL regex text is extracted from the edited source and evaluated as a JS RegExp; this is not a PostgreSQL-regex test. For each vector, all three authority fields were placed into a whole reservation envelope and passed to the actual existing B19 model/B25 encoder. **180 comparisons matched: 102 accepted, 78 rejected.** The earlier 60 shared/source-only comparisons also matched; these are overlapping evidence, not 240 distinct protocol cases.

Reproduce in repository root with PowerShell, using only existing modules and a stdin script (no new test file):

```powershell
@'
import { id } from './lib/storage/uploads/schema.ts';
import { reserveUpload } from './lib/storage/uploads/state.ts';
import { encodeUploadReservation } from './lib/db/postgres/upload-reservation-codec.ts';
import { readFileSync } from 'node:fs';
const sql=readFileSync('lib/db/postgres/drafts/0005_upload_reservation.sql','utf8');
const match=sql.match(/'\^\(\[0-9a-f\]\{8\}[^\n]+\)\$'/);
if(!match) throw new Error('missing source pattern');
const pattern=new RegExp(match[0].slice(1,-1)), vectors=[];
for(let v=1;v<=8;v++) for(const variant of ['8','9','a','b']) vectors.push([`01890abc-1234-${v}abc-${variant}abc-123456789abc`,true]);
vectors.push(['00000000-0000-0000-0000-000000000000',true],['ffffffff-ffff-ffff-ffff-ffffffffffff',true]);
for(const v of ['0','9','a','b','c','d','e','f']) vectors.push([`01890abc-1234-${v}abc-8abc-123456789abc`,false]);
for(const variant of ['0','1','2','3','4','5','6','7','c','d','e','f']) vectors.push([`01890abc-1234-4abc-${variant}abc-123456789abc`,false]);
vectors.push(['01890ABC-1234-4abc-8abc-123456789abc',false],['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',false],['01890abc12344abc8abc123456789abc',false],['01890abc-1234-4abc-8abc-123456789abg',false],['01890abc-1234-4abc-8abc-123456789abc\n',false],['01890abc-1234-4abc-8abc-123456789abc ',false]);
const owner='00000000-0000-4000-8000-000000000001', worker='00000000-0000-4000-8000-000000000002';
const uid=n=>`019b9000-0000-7000-8000-${n.toString(16).padStart(12,'0')}`;
let cases=0;
for(const [value,expected] of vectors) for(const field of ['verifiers','collectors','policyManagers']) {
 const r={ownerId:owner,objectId:uid(1),assetId:uid(2),intentId:uid(3),intentExpiresAt:3000,issueEnvelopeUntil:2000,maxIssues:3,verifiers:[worker],collectors:[worker],policyManagers:[owner],policyEpoch:7,policyDigest:'b'.repeat(64),incoming:{bucket:'synthetic-incoming',key:`${owner}/incoming/${uid(1)}/${uid(3)}`,providerVersion:null}};
 r[field]=[value]; let codec=false;
 try { const model=reserveUpload(r,{principalId:owner,now:1000,expectedRevision:0}); encodeUploadReservation({model,requestJson:JSON.stringify({codecVersion:1,requestId:uid(4),maxBytes:1024,reservedAt:1000,reservation:r})}); codec=true; } catch {}
 const source=value.length===36&&pattern.test(value), shared=value.length===36&&id.safeParse(value).success;
 if(codec!==expected||source!==expected||shared!==expected) throw new Error(JSON.stringify({value,field,codec,source,shared,expected}));
 cases++;
}
console.log(JSON.stringify({vectors:vectors.length,arrayFields:3,cases,accepted:102,rejected:78,matched:true}));
'@ | node --import tsx --input-type=module
```

## Deferred native acceptance fixtures

No fixture below was executed. They require a separately authorized owned full SQL4+5 scope and reviewed fuse removal:

* Run all 60 vectors through actual `policy_v1` in each authority array, plus new reservation entry/committed whole-envelope readback and actual B25 encode/decode pairing. Version9/f/0 must fail before any triple persists; versions1/7/8, nil/max must remain codec-compatible. Include JSON non-string/null, empty/oversized arrays, uppercase and escape variants. Compare native C-collation predicate behavior, not only JS regex text.
* Positive namespace fixture: actual non-superuser migration and OWNER transfer/temporary CREATE cleanup yields exactly the four typed ACL facts, no SET/INHERIT runtime edge and the selected one trusted ADMIN exception.
* Negative namespace defaults: configure an unrelated runtime principal's future-schema CREATE and USAGE defaults **separately**, then both. Named REVOKEs may leave those grants, but final inventory must reject and roll back all new objects/role/temporary edges. Do not modify defaults to manufacture acceptance.
* Independently test unexpected grantor, WITH GRANT OPTION, wrong namespace owner, missing API/issuer USAGE and duplicate/extra native facts where representable. Verify emitted raw OIDs/grantors and full atomic rollback; ordinary booleans alone are insufficient. Preserve prior default ACLs unchanged.

Native syntax/compilation, actual nspacl/acldefault/proconfig representation, non-superuser role/ACL transfer, deferred-event context, full FORCE-RLS/lock/concurrency/fault matrices, exact time/hash parity and lost-COMMIT response remain unverified. No complete version5 descriptor or operational policy administration/budgets/JS adapter is supplied by this correction.

## Closed tags and preserved boundaries

Correct actual tag set includes **POLICY**: `seed`, `replay`, `staged`, `INPUT`, `ACTOR_REQUIRED`, `ISOLATION`, `POLICY_LOCK`, `POLICY`, `CONFLICT`, `STALE_SEED`, `IDENTITY_CONFLICT`, `UNAVAILABLE`. This corrects the original handoff's minor omission here without editing its frozen text. No HTTP mapping or runtime adapter is introduced. Staged is not confirmed COMMIT; B3 PG_TRANSACTION remains conservatively unknown and requires same-owner/request/payload primary reconciliation. No new capability, signer, provider or cleanup authority follows.

The unconditional execution fuse remains intact. No SQL submission/parser, cluster/connection, role/grant operation, global/default setting change, registry/v1/closed3/4/B25/product/Auth/runtime/package edit, build, browser, provider, managed DB or deployment action occurred. No new agent/window/worktree. Actual validation is installed-source comparison, pure JS/B19/B25 vectors, selected diff check and protected-file comparison only. Independent fixed-source re-review is still required; this report does not self-accept either correction or native behavior.
