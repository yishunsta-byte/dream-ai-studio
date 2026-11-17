# B34-R — Independent actual-adapter native foundation review

**Verdict: PASS for the assigned normal owned PostgreSQL18.7 adapter scope.** Independently ran the frozen actual-service harness once, exit0, and verified native data, server audit, per-attempt session closure and owned OS shutdown. No native catalog/query/reply/cleanup mismatch found. This is not actual lost-COMMIT, faulted shutdown, concurrent/expired/evolved behavior, production provenance or activation acceptance. Master retains final authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_652a5e10b638`, acceptance receipt `msg_62a524f7ec7f`. Date:2026-11-18 Asia/Seoul. Only this tracked report is edited.

## Frozen identity and actual command

| Artifact | Independent evidence |
| --- | --- |
| Harness commit | `3749241e0e96c28d811ca8061b094cd7eb41aff9` |
| Harness | `tests/b34-reservation-adapter-native-owned.ts`; LF SHA256 `83d8de7edd617ef189dbad1f738d7aeacbeeace4f06438216d1180a3b7934851` |
| Adapter | `5f97f007abd2272dff265f19d229e14ab609c7c3`, accepted code/unit/fault review2afbc3e; six module pins verified before and after execution |
| Original SQL5 |fbfc48c95264eaf37826f943b5e35e9fe67fa616; LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| Derived SQL5 |LF SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` |
| Engine |Existing signed `.tools/b3-postgres-18.7/pgsql/bin`, PostgreSQL18.7 Windows x86_64/msvc-19.44.35229; Node26.13.0 |
| Reviewer root |`D:/starwork/dream-ai-studio/tmp/b34-native-820a380f-ff2d-482d-beb2-cea1a5686efd` |
| Separate review scratch |`D:/starwork/b34r-review-3749241` |
| Owned server |**PID77228 /sole listener127.0.0.1:58831**, verified directory/PID/port |

Actual command from repository root:

```powershell
node --conditions=react-server --import tsx tests/b34-reservation-adapter-native-owned.ts --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

**One invocation, one new owned UTF8/C SCRAM cluster, exit0, seven recorded stages, stopped=true.** Actual postgresUploadReservations, unchanged createPostgresPool and installed pg execute: no factory/driver/reply mock, reconstructed fake server reply, module patch or path-check bypass. Existing server-only0.0.1 package exports officially map react-server to empty.js; this condition is explicitly authorized and changes no package. No service composition/route or production opt-in is enabled.

Before execution, current harness/protected postgres/model/service/repository/package/tsconfig matched3749241; six modules also match5f97f00. Independent LF hashes and recursive installed dependency hashes were retained (pg/tsx/Zod/uuid/server-only plus installed dependency closure:20 packages/1,091 files). preflight.json SHA256 `f76a84c053c4f14e4572643f992a4dcc857d6c2025d5094895e7f35ce02bbe51`; dependency manifest SHA256 `b1cf66775a608c94e3a72c928d5b0dfdf6f8686d04ce1fadb3612e72e4d7c11b`. No installation. postgres/initdb/pg_ctl each verified Valid EnterpriseDB signature and actual18.7 version.

## Provisioning, source and trust boundary

New database **dream_test_b34_adapter** satisfies unchanged connection.ts's loopback/no-TLS synthetic exception. Bootstrap provisions the fixture and actual nonsuperuser/non-bypass migration login; that login executes full hash-verified SQL1–4 and whole SQL5 derivative. Approved SQL2 pin remains `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`; all other accepted baseline pins are explicit/verified in the frozen runner. No SQL function/guard/inventory/statement is rewritten.

Independently matched retained SQL5 original to fixed git source and verified only the known **87-character fuse at offset252** is removed, preserving newline/543 lines and exact reinsertion; derivative hash matches above. Original repository fuse remains intact. This execution permission applies only to this newly owned B34-R derivative/cluster, not registry/apply permission.

Provisioner evidence contains the exact13-field synthetic target. Actual OIDs: loginA17837, API17115, issuer17736, migration16389, bootstrap/API-membership-grantor10, read17830, reserve17831. Independently checked restricted login flags and one direct API membership per login (adminfalse/inheritfalse/settrue); native functions have issuer owner, migration namespace owner, SECURITY DEFINER/VOLATILE and expected proconfig. The real service's metadata SQL and validation execute before entries. These native values come from the controlled fixture creator, not a production attestation; scope remains owned-synthetic.

Policy/Auth rows and finite values are bootstrap-only synthetic setup. VerifiedActor is issued from trusted fixture IDs, not actual server Auth/getUser. Only synthetic generated credentials are used; no env file/real DSN/credential is read. Secret-bearing provisioning precedes statement logging. Audit settings change only this new cluster. No password material is reproduced in report/messages.

## Seven recorded stages versus service attempts/controls

The seven records are **six connected service attempts plus one native B25 binding check**. There are separately **two zero-connect service controls**. Thus eight reserve API invocations, not nine connected/native transactions or seven independent runs.

| Stage | Independently reproduced result |
| --- | --- |
| New admission | Actual service success/confirmed/cleanupok, origincreated, issuancefalse, generated IDs3; native ledger/object/intent1 each, cap/outbox0. |
| Native stored B25 check | Read committed ledger and real fixed B25 projections; actual B19 reconstruction/B25 decode/model/raw/hash and all ten returned DTO fields match. B25 INSERT specs are not executed. |
| Same-key same payload | Actual replay success/confirmed/cleanupok; original DTO/rawSha/fingerprint retained, generated count remains3, no reserve dispatch or extra triple. |
| Changed payload | Actual not-applied/CLIENT_CONFLICT/cleanupok, no new IDs/triples, read-side conflict then real ROLLBACK. |
| Other owner same key | Separate restricted login/actor creates its own distinct IDs/triple; no original object/asset/intent ID in response. Each owner has one ledger, final IDs6 intentionally. |
| Management credentials | Actual bootstrap connection rejected CONFIGURATION_REJECTED/not-applied/cleanupok after identity query, no BEGIN/entry/write. This is the combined wrong-login/management control, not isolation of every individual privilege predicate. |
| Swapped function OIDs | Actual identity/local metadata checks followed by ROLLBACK, CONFIGURATION_REJECTED/not-applied/cleanupok, no entry/write. |

Additional approved-runtime control returns DISABLED with no pool/adapter connection/SQL; invalid actor returns AUTH_REQUIRED/identitynull, request getter reads0 and no adapter connection/SQL. Frozen runner compares the server-audit delta around those two calls; independent offline audit also finds exactly the six expected connected sessions and no extras. These are actual closed preconnect calls, not Auth integration or production target verification.

Reviewer recomputed UTF8 raw SHA, semantic request domain fingerprint, client digest and ledger result digest from actual retained rows, and checked the immutable ledger result against returned ten-field DTO. Raw text matches stored intent and actual decoder. Decoded model matches every original reservation field/reservedAt and is pristine reserved/revision0. These independent readback checks supplement the actual B25 encoder/decoder calls in the run, not replace real adapter execution.

Final counts are **request2/object2/intent2/capability0/outbox0**, with one ledger per owner. No first native failure/SQLSTATE was observed; server audit has zero ERROR records in its captured interval. Closed application rejections above are not mislabeled as raw PostgreSQL exceptions.

## Server-audit/session evidence

| Actual adapter backend | Login | read/reserve entries | COMMIT/ROLLBACK | Hygiene | Disconnection |
| --- | --- | --- | --- | ---: | ---: |
|26948|b34_api_a|1/1|1/0|1|1|
|35740|b34_api_a|1/0|1/0|1|1|
|78516|b34_api_a|1/0|0/1|0|1|
|52768|b34_api_b|1/1|1/0|1|1|
|67808|b34_bootstrap|0/0|0/0|0|1|
|63088|b34_api_a|0/0|0/1|0|1|

Each PID has the actual identity query and server disconnection. Audit shows real RC BEGIN/local role/actor/function metadata where appropriate. Only two owner-new attempts dispatch reserve; replay/conflict do not. Three acknowledged successes (two creates plus replay) perform hygiene. The management attempt has identity only; the swapped-OID attempt stops at metadata and rollback. Real service cleanupok is corroborated by server disconnection and absence of dream-backend sessions after each attempt, not only by returned flags.

Every saved activity snapshot contains only the intentionally retained **observer PID79400**, application B34-owned-native, in this fixture DB. Before shutdown, final counts/activity queries actually succeed, proving the server is still responsive while all adapter sessions are already closed. The observer is not an adapter leak; bootstrap admin's separate postgres-database provisioning connection is outside this fixture-DB activity filter and is also closed in harness finally.

## Owned shutdown, correction history and evidence

Runner cleanup-safe: PID77228/port58831, completed=true/postmasterPidAbsent=true/listenerAbsent=true. After exit, Tester independently verified **OS PID count0, port listener count0, owned postmaster.pid absent**. Stop/listener logs retained; no redundant stop, force termination or second run. Owned data/logs remain for inspection with server stopped.

Read the author's operator-timing-correction.json and handoff: earlier pipe/startup-delay suspicion was explicitly corrected after its original process completed exit0 and shutdown; subsequent manual stop saw an already absent PID file, changed no running cluster, and no runner workaround/second native invocation followed. That historical suspicion was not recreated or treated as a native defect. This independent run also waited for its original process completion and used its own shutdown evidence rather than inferring failure from delayed output.

Retained runner root includes original/derived SQL, six module pins, synthetic provisioning/target, native triples/projections, seven stage results, final controls/activity, server audit and shutdown records. Review scratch includes preflight/dependency manifests, run.log, read-only inspect_evidence.py and independent-evidence-summary.json. Inspector exit0 independently checks seven records/six sessions/two controls, actual OIDs/role/function facts, hashes/DTO, per-case session absence, exact derivation and cleanup. Summary SHA256 `659204632c21f9c2496b7a1bb66f1b0d55a21ebcd1d98e4bd046d685ec4b4e20`. No supplemental native fixture/expanded DB test was needed.

Post-run fixed comparison again confirms unchanged harness, six modules, SQL/model/B3/package/config inputs; only this report is staged/committed with selected whitespace validation. T122/T137 WIP preserved. No existing service/cluster/shared3013/.next, real env/managed/provider/Storage/registry/UI/route/runtime change, installation/build/deploy or new agent/window/worktree.

Remaining gates: actual committed-response loss/primary reconciliation, faulted/late socket shutdown, expired/evolved history and races through this adapter, real Auth/B3 top-level integration, other PG majors, full v5 descriptor/provisioning/production target attestation, budgets/provider permissions and runtime activation. Previous direct-SQL B28–31 evidence is not substituted for any of these. approved-runtime remains DISABLED.

Copyable return:

> B34-R fixed3749241 actual adapter5f97f00 normal native PASS: one owned PG18.7 run exit0; seven stages=six real connected service attempts plus native B25 check, extra two preconnect controls connection0/getter0. Actual created/replay/conflict/foreign-owner data and management/function-OID boundaries pass; six audited PIDs all disconnected, per-attempt activity clean, observer79400 alone/responding before stop. DTO/raw/model/domain hashes and final2triples/capoutbox0 independently verified. PID77228/127.0.0.1:58831 stopped with OS PID/listener0/pidfileabsent; original fuse/six modules/protected files unchanged. No native lostCOMMIT/race/expiry/evolved/runtime authority claim; Master final acceptance required.
