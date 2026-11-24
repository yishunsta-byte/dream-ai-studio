# B48-R independent OID-equivalence review

2026-11-18 · Codex(Tester) · Master msg_8e7540cacad6; acceptance msg_3c3fb6467546; first-witness discrepancy returned msg_4acc6015fbfb; Master stop confirmation msg_1bd7c34b4dbb.

**Author evidence/static review PASS; own A execution exit0; first independent OS cleanup guard FAIL; own B not executed; independent A/B equivalence remains incomplete.** This is a first-discrepancy return under the assigned stop condition, not pair-equivalence acceptance. Master explicitly confirmed preserving that result and returning without further native execution. No product defect or cleanup failure cause is established from the conflicting process observations.

Fixed author commit **f7e02addff064797253b9db8c17ec3c0e13c4185**, exactly two new paths: B48 harness and author handoff. Read AI_TEAM_RULES.md, AGENTS.md, docs/team/CODEX_MASTER.md and fixed B48 handoff before review. Only this new tracked report and own ignored `tmp/b48r-review-f7e02ad` were written by Tester, plus one harness-owned fresh evidence root. Existing Master document edits and unrelated untracked T122/T137 files preserved.

## Source and author evidence review

Harness LF SHA **d9333f3cdcbf2049f5e08d2f2fa8412459d7c0aaed4bb08150bd63568987067b**; marked seed LF SHA **8baf641bb06c7a42fe0809b67966168793f2dd79c5ff27349d0b50ddc4eb8918**. Independent inverse removes only seed and authorized scenario/identifiers/cleanup-parameter changes, restoring frozen B47 full bytes SHA **ce6a2c73c25b406ec3bee3c65b0025f0875af2d5a204bfed04cce14e6e7cd821**. Original15 projections, native binding recipe, migration bodies, decoder and finally control flow match. Scenario order/count are controlling-session requirements, not enforced by standalone CLI.

Catalog **97ccf4f241dcbf5c572a314d61d10f488891977929cadc71e55c216374354e14**, loader **0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698**, D **9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb**, P **f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339** match fixed source before and after. Own sources.json confirms all five body checksums, including P body **15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9**.

Source-derived seed mutation recipe has36 dispatches, SHA **cd4bebbc8652490ddd5d91654422d472d86a5f54ac0a0cd38b400168566d6ae7**, exactly matches original seed-sql-sequence.json (file SHA **bca867173b2076d4b79efd866bac467c6aeb4a8cefa84efb9ce6a709cdc0821d**). Only B allocates in bootstrap postgres, one explicit transaction: two restricted NOLOGIN roles; schema/enum/domain/constant SQL function;16 UUID-PK/text tables; reverse DROP16 then explicit function/domain/type/schema/roles removal; no CASCADE. Seed removed before M/Auth/P and template0 target creation. Author B inventory72 comprises roles2/namespace1/classes32/types36/function1; before/after namespace and role counts0; author A inventory0. Namespace-local capture does not inventory every associated internal allocation, including TOAST.

Independently checked author pair artifact SHA **3b9e425dc3de8552f7b36599dc3160871013cca282189d1de87915d791d1019f**, all54 original-file hashes and full typed/canonical/observation-byte equality. Independently built semantic native identity maps, unique in each scenario with equal key sets:

|Category|Mapped|Changed|
|---|---:|---:|
|schemas|3|3|
|relations|33|33|
|constraints|700|700|
|indexes|140|140|
|functions|18|18|
|types|69|69|
|roles|5|4|
|memberships|3|3|

Author actual examples: M16389→16528; auth.users16392→16531; Auth PK constraint16397→16536; bootstrap10→10. Exactly5 of527 external-fact endpoints change;522 remain equal, including builtins. Both author dependency batches2996 native rows/2960 exact seven-field groups,2924 singleton+36 double; normalized multiplicity sum2996. Raw13/15 projection files differ while complete typed catalogs, canonical JSON and observation file bytes match. Query hashes unchanged. No OID text rewriting, function source scrubbing, expected learning or normalization relaxation was used by this review.

This supports the author's fixed two-scenario diagnostic only. Builtins and bootstrap do not shift, and allocation/mapping observations do not prove arbitrary cross-cluster equivalence.

## Own A and first OS witness discrepancy

Exactly one native invocation: `node --conditions=react-server --import tsx tests/b48-schema5-oid-equivalence-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin --scenario A`. Exec session31700 actual exit0, stdout stopped=true. Root **tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07**; PG18.7 signed existing EnterpriseDB binaries, UTF8/C/template0, loopback61009. Postmaster35560; clients74724/41172/66300. No native B invocation, extra scenario, patch, retry or intervention.

Ownership13:27:23.140; ready13:27:38.548; start.log saved13:28:38.080; run13:28:39.012; final13:28:40.383; shutdown log13:28:49.450; cleanup-safe13:28:50.668, all +09:00. Original start await returned naturally after the previously observed approximately60s readiness gap. The delay's cause remains unknown.

Own A distinct M/B,527 fixed facts/profile none/null login pair, migrationCommittedtrue/all five source bodies in one READ COMMITTED transaction, original shared lock and COMMIT, three admin-only M membership edges, then M REPEATABLE READ READ ONLY collection. All15 projections succeeded; named38/internal296. Counts schemas3/relations33/columns430/constraints700/indexes140/policies57/triggers334/functions18/domains3/types69/defaultAcls0/dependencies2960/roles5/memberships3. Raw dependencies2996/groups2960/2924 single+36 double, explicit multiplicity sum2996. Empty seed inventory and zero namespace/role residue. Own A typed/catalog/canonical/full observation bytes equal author A; this is not own A/B comparison.

First .ps1 attempt was blocked by existing execution policy before its body ran. No execution policy was changed. The first actual independent OS guard used `Invoke-Command -ScriptBlock ([scriptblock]::Create((Get-Content -Raw -LiteralPath tmp/b48r-review-f7e02ad/cleanup-os.ps1))) -ArgumentList 'D:\starwork\dream-ai-studio\tmp\b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07','A'`.

At **13:29:05.7225958+09:00**, the guard recorded **Get-Process35560 absent=false**, all three clients absent=true, listener61009 absent=true, postmaster.pid absent=true. It exited1 with RuntimeException/FullyQualifiedErrorId `Cleanup witness failed`. Original harness cleanup-safe.json separately reports all process/listener/pidfile cleanup flags true, completedtrue,15 calls/migration committed. Those claims do not override the first independent guard. Original script and JSON are preserved unchanged, including exact Get-Process expression; initial guard did not capture process start time/path.

The immediately following tool read requested CIM ProcessId35560 with creation time/executable path/command line and Get-Process35560 with StartTime/HasExited/Path. Both returned no row; start time/path therefore unavailable. That command did not include its own timestamp; it occurred after the first guard and before the final recorded witness. It also returned original shutdown log lines13:28:40.416 fast shutdown and13:28:49.450 database shut down. No claim of exact subsequent-query wall time is made.

At **13:29:38.8000928+09:00**, final read-only current-state witness found all four exact PIDs absent by CIM,35560 Get-Process absent, listener61009 absent, pidfile absent. No kill/stop/restart or cleanup mutation was needed. This proves the recorded current absence and does not retroactively pass or explain the first guard. PID reuse, process exit race or command handling issues are possible explanations only, not findings. B remains unexecuted per first-discrepancy stop condition and Master's confirmation.

## Validation, evidence and limits

Independent scoped strict TypeScript/import graph exit0: `tsc --ignoreConfig --noEmit --incremental false --target ES2020 --lib ESNext,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict tests/b48-schema5-oid-equivalence-native-owned.ts`. Scoped ESLint max-warnings0 exit0. Catalog unit suite240/240 PASS with native switches process-local0. No whole-project type, full suite, browser or build/deploy acceptance is claimed.

Observation hash independently recomputed from unchanged `catalog-observation:v3\n` domain plus actual canonicalJson: **88148dc170a912568432239e55bfff6f12fa9fd3cbbe021e8b769c6beb67a2b1**. Complete observation file SHA **5445150afb472543029a1383d84644574060576293768807645fa2096ffc258a**. Own final SHA **b66197ddf4fbb04253dccd4630ba26dbde65594a7c4f09025a8d1901018ee327**, cleanup-safe SHA **a670e0f8c642ea666854b20502491bf9e23f5f092313296bab789ebbf27cbd2b**. All remain descriptor4/unvalidated/approvalfalse/expectedCatalogfalse; no Golden/reference/state/runner/runtime/managed acceptance or promotion.

Own ignored evidence: preflight.json (source/54author hashes/65historical hashes), seed-sequence.json, author-analysis.json (full identity map/direct comparisons), own-a-analysis.json (27 own file hashes/counts/times), cleanup-os.ps1, cleanup-os-A-first-discrepancy.json, cleanup-current-final.json, first-witness-transcript.md. Review-only inverse spacing and canonical-envelope assumption corrections, initial parser error and policy-blocked command are distinguished in the transcript; original mismatch JSONs retained. They caused no native retry or source changes.

Historical preservation rechecked: B47 recovery25/25, two original B45 sets36/36, interrupted B47 nonsecret files4/4 unchanged. No old-root password read/reuse, old B45 re-decode, old cluster operation or repair. Production5148/preview50963/Ego54/55/shared3013/.next, accounts/mail/password/deploy/install/config and other work preserved. No new agents/windows/worktrees. No shared index wholesale staging.

Master copyable return: B48-R first-discrepancy review returned. f7e02ad fixed source/seed/B47inverse/pins and author54artifact/nativeOID mapping/full typed+bytes equality PASS; scopedtype/lint/catalog240PASS. Own A-c6850ec7 exactly1 actualexit0/stoppedtrue/all15/hash88148dc, but first independent OSguard13:29:05 PID35560 absent=false exit1; later13:29:38 current fourPIDs/listener61009/pidfile absent. Root cause unproven; firstfailure not retroactively PASS. Own B never launched; independent pair incomplete. Allunvalidatedapprovalfalseexpectedfalse, no product patch/native retry/promotion. Master decides any separate next experiment after review.
