# B8 — Managed connection diagnosis

- Date: 2026-11-17 KST; author: Codex(Backend).
- Assignment: Master `msg_17595ecd79da`; B7 baseline report commit `13e6c7a`.
- **Result: verified TLS Session pooler connection and read-only catalog inspection succeeded. Direct connectivity remains blocked by local IPv6 reachability. No migration/apply readiness acceptance.**
- Existing live-auth project ref: `osvjfyjlbixmvnjkxdry`. This work does not classify it as staging or independently establish organization ownership/administrator authority.

## 1. Supplied targets and runtime

Targets were reread from the existing authenticated Supabase project Connect dialog. No endpoint was inferred or constructed from the project ref. Endpoint/password/DSN/account values were held only in process memory and were not printed, written to probe source/results, or passed in command arguments. Password was selectively parsed from the existing local `SUPABASE_DB_PASSWORD` key; no Auth API key was used as a DB password.

| Target | Safe SHA-256 fingerprint¹ | Result |
| --- | --- | --- |
| Provider Direct | `0ad1a2d0b6016a58192a68542a1dde30a87887f1307329c50b45381d5c89a462` | DNS AAAA exists; actual IPv6 TCP attempt returns `ENETUNREACH`. |
| Provider Session pooler | `b857268ff00d94f5bc9432f78c322a1de253f3835a62c6a80e3f9c8c44c9df23` | IPv4 DNS resolves; official provider CA enables verified TLS and catalog SELECT. |

¹ Same non-password tuple hashing as B7: host, port, database path, username. These are probe identity fingerprints, **not** B5 profile-bound migration target hashes.

Actual probes ran in ego-browser's Node **v24.22.1** with the repository's installed `pg` client. The ordinary shell's Node was v26.13.0; shell version alone does not describe the probe runtime.

## 2. Direct DNS and IPv6 diagnosis

| Probe | Direct result |
| --- | --- |
| Node `dns.lookup` (all/default) | `ENOENT` |
| Node `dns.lookup` family 4 / family 6 | `ENOTFOUND` / `ENOENT` |
| Node `dns.resolve4` / `dns.resolve6` | `ENODATA` / one AAAA answer |
| Windows `Resolve-DnsName` A / AAAA | zero A / one AAAA answer |
| Windows `.NET Dns.GetHostAddresses` | Failed; no raw exception emitted. |
| Network interfaces | Non-internal IPv6 interface exists, but no non-internal global IPv6 address was observed (link-local/ULA excluded). |
| TCP to the actual DNS-returned AAAA, provider port | `ENETUNREACH`; no PostgreSQL startup/password sent. |

Both explicit DNS resolvers agree that an AAAA record exists. Thus `lookup`'s `ENOENT` is not evidence that the provider DNS record is absent. The observed local addressing and real TCP failure establish an IPv6 reachability blocker in this execution environment. The precise OS resolver policy behind `lookup`/`.NET` behavior was not changed or conclusively identified. No DNS/network/interface setting was changed.

Session pooler DNS independently returned three A answers and zero AAAA answers; Node default/family-4 lookup and Windows A/`.NET` resolution succeeded. This distinguishes its trust-chain failure from the Direct network failure.

## 3. TLS chain and independent CA provenance

Initial Node handshake used `rejectUnauthorized: true` and failed `SELF_SIGNED_CERT_IN_CHAIN`. Node bundled/default trust lists contained 118 certificates, and its Windows system list 93; the observed provider root was absent from both. The rejected Node socket did not expose a peer certificate afterward.

A separate Windows `.NET SslStream` diagnostic sent only PostgreSQL SSLRequest and a TLS handshake, **no DB startup/password**. `AuthenticateAsClient` used the actual supplied hostname. Its validation callback recorded the OS validation result and unconditionally returned false, rejecting the handshake; it never accepted a certificate or created an authenticated DB session. OS validation reported `RemoteCertificateChainErrors` / `UntrustedRoot`, **hostname match true**. All three chain certificates were within their validity intervals:

| Certificate role | Issuer | Validity (UTC) | SHA-256 |
| --- | --- | --- | --- |
| Leaf | Supabase Intermediate 2021 CA / Supabase Inc | 2025-03-12 15:56:33 → 2030-03-11 15:56:33 | `03:70:9C:A4:4D:1B:06:E4:50:4D:A0:A8:3B:6C:A0:65:76:1E:DC:70:4C:D5:63:4B:CC:38:94:FD:5C:7B:32:48` |
| Intermediate | Supabase Root 2021 CA / Supabase Inc | 2023-10-24 07:53:45 → 2033-10-21 07:53:45 | `24:A6:6D:35:78:C2:58:27:5F:C0:FF:BE:A2:5C:50:D1:30:6C:39:42:52:DA:A5:0D:50:1E:53:76:A1:F2:FE:7A` |
| Root (self-issued) | Supabase Root 2021 CA / Supabase Inc | 2021-04-28 10:56:53 → 2031-04-26 10:56:53 | `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` |

Trust was **not** assigned to the certificate merely because the server sent it. In the authenticated official dashboard, Database → Settings at `https://supabase.com/dashboard/project/osvjfyjlbixmvnjkxdry/database/settings` supplied **Download certificate**. That separately downloaded public CA has the exact root fingerprint above, CA=true, valid dates above, and a valid self-signature. It was used solely as the explicit CA for the B8 probe's PostgreSQL client. The public certificate remains ignored at `tmp/b8-managed-01/provider-root.crt`; no global/system store or environment was changed.

## 4. Verified Session pooler read-only result

Client settings: explicit connection fields, process-local provider CA, `rejectUnauthorized: true`, actual hostname as SNI, and Node `tls.checkServerIdentity`. After successful authentication, observed client socket: **encrypted=true, authorized=true, hostnameValid=true, TLSv1.3**. Credentials were sent only after the client accepted the verified TLS session.

The client executed `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, pure current-session/catalog SELECTs, and `ROLLBACK`; connection closed afterward. A second bounded read-only observation resolved the backend TLS visibility ambiguity. No Auth user rows, user counts/content, or product rows were queried.

| Metadata | Observed |
| --- | --- |
| PostgreSQL server version | `170012` (17.12) |
| `transaction_read_only` | true |
| Current role equals session role | true |
| Operator superuser / CREATEROLE / database CREATE | false / true / true |
| `auth.users` relation exists | true |
| Auth `id`: UUID, not-null, valid unconditional single-key unique index | true |
| Operator auth schema USAGE / table REFERENCES | true / true |
| `dream` schema | absent |
| `dream_migrations` schema / history relation | absent / absent |
| Reserved API/worker/runtime login roles | zero |
| Own backend `pg_stat_ssl` row count / `ssl` | 1 / false |

**Transport distinction:** verified client→pooler TLS succeeded. PostgreSQL reported `ssl=false` for its own backend session behind the pooler. That is a separate pooler→PostgreSQL observation; it does not contradict the client's TLS evidence and does not prove that the internal hop is encrypted. No pooler/server transport setting was changed. Provider internal transport policy requires separate verification if it is an acceptance requirement.

## 5. Boundary and next requirements

- Direct requires a working IPv6 execution path (or a separately authorized provider-supported connectivity arrangement). No endpoint/resource/network change was made.
- B5's accepted migration CLI targets Direct and must not be repurposed with this Session pooler result. Its files remain unchanged at the accepted `52ea968` baseline; no runner fingerprint, dry-run, apply, or provision was executed.
- This proves existing target access and the listed catalog privileges through Session pooler. It does not prove Direct migration connectivity, full ACL/role graph correctness, future DDL success, runtime actor isolation, worker behavior, Storage, or operational readiness.
- Missing dream/history/reserved roles describes only those application objects; the existing live Auth environment is not an empty database or an approved staging environment.
- Before any write work, Master must identify the exact approved environment, owner/operator scope, connectivity and internal TLS acceptance, and separately assign execution. No account/Auth/DDL/GRANT/provision/deployment/resource changes were performed.

## 6. Evidence and delivery

Ignored evidence directory `tmp/b8-managed-01/`: `dns-safe.json`, `pooler-dns-safe.json`, `direct-network-safe.json`, `tls-safe.json`, `os-tls-safe.json`, `ca-safe.json`, `db-safe.json`, public provider CA, and secret-free probe sources. The initial pooler DNS artifact's source label says Direct because the dashboard remembered Session pooler selection; its fingerprint matches the pooler target. Direct was then explicitly selected and independently probed. No interpretation relies on that initial label.

Only this report is a tracked B8 change. Probe directory/CA ignore status verified; browser task finished, pages closed, clients disposed. No product test run was needed for the documentation-only deliverable; actual bounded network/TLS/catalog observations are the evidence. Concurrent WIP, 3013, `.next`, and accepted migration code were not modified.
