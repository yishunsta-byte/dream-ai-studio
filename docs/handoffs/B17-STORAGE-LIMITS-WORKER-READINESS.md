# B17 — Actual Storage limits and worker readiness

- Owner: Codex(Backend); Master assignment `msg_6ea39368f835`.
- Status: **ready_review — read-only readiness report; operational upload blocked by current cap and missing deployment**.
- Last actual provider observation: **2026-11-17 21:43 KST (12:43 UTC)**. Local resource observations:21:39–21:42 KST. Official limits/pricing rechecked21:43 KST.
- Source baseline at final local check: `eb7f87810226cee16ac76a229c8d385e2e4a4571`. B16 `79787f9` is under separate independent review. B14/B15 source unchanged.

## Actual provider observations

Existing authenticated browser session was used. Supabase organization project list linked the exact `dream-ai-studio` project, public ref `osvjfyjlbixmvnjkxdry`; its own project header retained the same organization link, **FREE**, and main/PRODUCTION designation. This is actual project-organization plan evidence, not a personal subscription inference. No billing/card/address page was opened.

| Surface | Actual observation | Consequence / limit |
| --- | --- | --- |
| Supabase organization plan | **Free** in organization list and exact project Storage header. | B16's actual-plan uncertainty is resolved for this observation only. No upgrade performed. |
| Storage global single-file cap | Files → Settings: **Global file size limit**, value `50`, unit `MB`, input disabled; explicit notice that Free has a fixed50MB cap and Pro supports a configurable cap. | Exact2GiB product maximum cannot be supplied now. This is single-file cap, separate from total storage allocation. Save and transformation controls untouched. |
| Existing app private bucket | Files → Buckets displays empty state **Create a file bucket / New bucket**. No bucket list or app bucket exists in the observed project view. | **未設定 / not configured**. Bucket identity, private flag, bucket cap, MIME restrictions and object policies have no existing app target to inspect; not assumed safe/default. No New bucket or Policies action taken. |
| Vercel exact project | Existing dashboard project link matched `dream-ai-studio` and its public `dream-ai-studio-orpin.vercel.app` Visit URL. Header and Functions settings identify **Hobby**. | No inference from account name or another similarly named project. No billing or environment-variable contents inspected. |
| Vercel Functions | Fluid Compute displays **Enabled**; current Hobby CPU/memory notice **1vCPU /2GB**. | Settings are observed configuration, not proof of every deployed function's effective runtime. No Save/deployment. |
| Vercel duration | Expanded **Advanced Settings** only. Default Max Duration number input has empty value and placeholder `300`; raw generic HTML min0/max900. | No explicit project override is displayed. Placeholder is not a measured runtime, and generic max900 is not Hobby entitlement. Current official Hobby Fluid limit is default/max300s; function/deployment overrides and actual execution were not tested. |

Supabase showed a general provider technical-issue banner while the requested plan/Storage pages loaded successfully. No outage conclusion or wider health probe follows. No Auth user/object contents were opened. Dashboard navigation can display account chrome incidentally; no identity, payment or user-content details are retained in this report or a separate evidence capture. Browser task12 finished and agent tabs closed.

Current primary sources: [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) distinguish Free50MB from Pro+ configurable global/bucket constraints; [Vercel Functions limits](https://vercel.com/docs/functions/limitations) state Hobby Fluid300s default/max,2GB/1vCPU and4.5MB request payload. The UI's generic numeric max is not substituted for that documented plan limit. These limits reinforce direct Storage upload plus a separate byte/native worker; extending a Vercel timeout does not fix the upload architecture.

## Current machine and scoped configuration

Only the existing workspace drive, OS memory counters, known media-tool paths and repository configuration/source were inspected. No system-wide file search, service/task inventory, worker start, media execution, benchmark or network-service installation was performed.

| Check | Result | What remains unproved |
| --- | --- | --- |
| Existing D: workspace drive | Latest free **7,758,208,217,088 bytes**, used243,336,822,784 bytes; approximately7.06TiB free. Earlier observation varied with concurrent activity. | Snapshot only; no reservation, quota/ACL, reliable throughput, failover or future free-capacity guarantee. Dedicated verification workRoot is not assigned. |
| RAM | OS total visible66,709,992KiB, available23,480,400KiB at observation (about63.62GiB /22.39GiB). | Shared instantaneous memory, not a worker allocation or capacity test. Full-file buffering remains disallowed by B16. |
| PATH tools | `Get-Command ffmpeg,ffprobe` returned none in this shell. | Does not mean binaries absent; project runtime has its own fallback. |
| Known local media tools | `.tools/ffmpeg/ffmpeg.exe`105,423,872 bytes and `ffprobe.exe`105,221,120 bytes exist; both Authenticode status **NotSigned**. | Presence/hash is not publisher authentication, safety certification or suitability for2GiB hostile media. No executable launched here. |
| Tool identity | ffmpeg SHA256 `3256173F3F8BFFD7DF12227C68ADF68025EDB1832273A9530688A7BB1ED8EDEC`; ffprobe SHA256 `F0D36ECBBDD3BCFAC3EFA078C96C7271C2E68B3810595552AC3B7F17E9A65C52`. | Fingerprints identify these files only; no trusted upstream signature/manifest comparison assigned. |
| Allowed local settings | Selective parsing only `DREAM_DATA_ROOT`, `FFMPEG_PATH`, `FFPROBE_PATH`: all absent/empty in checked process environment and `.env.local`. Values were not printed. | Existing source defaults runtimeRoot to process cwd; media tools fall back to known local paths, then PATH. This shell cannot establish settings of another running process or remote server. |
| Existing worker | package worker command runs `worker/main.ts`; source opens SQLite, validates migrations/startup and loops existing mock/render runner with concurrency1. | Not a PostgreSQL Storage-verification worker, not proof it is running or supervised. No new worker execution. |
| Separate verification deployment | No `worker/storage-verify.ts`, production composition consuming B14 config, dedicated workRoot or verifier deployment/service manifest found in scoped app/worker/scripts/config search. B14 config requires explicit workRoot/probe/bucket/credential injection and has no default environment wiring. | **未指定 / not assigned**. Other machines/system services outside this bounded search are unverified. Current source data-root fallback is not an operational verifier placement. |

No benchmark was needed to establish the current hard cap failure. A future worker assignment must still establish OS-trusted private workRoot/permissions, reliable tool provenance, bounded disk/CPU/concurrency, large-file throughput, power/sleep/restart behavior, credentials/lease/monitoring and cleanup. Large current free disk/RAM does not satisfy those gates. B14 trusted-privateRoot/junction limitations and B15 non-hard-deadline/commit ambiguity remain unchanged.

## Required choices and existing authorization difference

The product requirement stays **2,147,483,648 bytes (2GiB)**. Do not silently reduce it to50MB or treat TUS as bypassing Free's cap. Under the selected Supabase design, an eligible paid organization plan plus explicit global and future bucket caps is required before real2GiB operation. [Current official pricing](https://supabase.com/pricing) lists **Pro from USD25/month**, first project included and additional projects fromUSD10/month. This organization visibly has another project; whether it would be billed, remain paused or otherwise affect the total was not investigated. Thus USD25 is a published starting price, **not this organization's final quote**. Tax/extra compute/storage/traffic and worker availability costs remain unverified. No payment details or upgrade flow opened.

Existing authorization covers architecture, read-only facts and bounded local implementation assigned by Master. It does not authorize a new recurring paid plan, changing production Storage caps/buckets/policies, deploying a verifier, or creating resources here. Master should consolidate the actual paid-plan/cost choice and worker placement/uptime decision after independent B16 review. Existing PC may be a candidate without new server rent, but no zero-cost or always-on guarantee was proved. No Vercel upgrade is established as necessary for the proposed lightweight HTTP/DB path. DEC-SSL-01 remains a separate pending production restart/transport decision; B17 does not resolve or execute it. No new decision answer was received in this task.

Next separately assigned stages can use B16's local contracts/tests without pretending real upload readiness. Real provider write opening additionally needs actual eligible plan/settings, assigned private incoming/final buckets and permission tests, trusted worker deployment, append migration/receipt contracts and independent end-to-end verification. All are unimplemented/unassigned by B17.

## Evidence and delivery

Commands used: ego-browser authenticated read-only navigation/evaluate/snapshot; `Get-PSDrive D`, `Get-CimInstance Win32_OperatingSystem`, `Get-Command`, known-path `Get-Item`, `Get-AuthenticodeSignature`, `Get-FileHash`, scoped `rg`/source reads and selective three-key presence parsing. Initial shell-inline parser failed to parse before reading anything; file-based parser succeeded. Two ambiguous selectors and one off-viewport expansion were recovered from current page observations; no setting was submitted. Temporary browser scripts live outside the repo under the B17 task directory; no screenshot/account-content evidence file was generated.

Only this document is a tracked B17 change. No product tests run for read-only prose reporting; `git diff --check` is the documentation check. No SQL/history/assets/FK/code/package/env/config/default/API/UI/worker changes; no bucket/policy/upload/DDL/register/upgrade/Save/managed API write/deployment. Shared3013/.next and other authors' files left untouched.

Transfer: **B17 ready_review. Exact Supabase project organization currently Free; actual global single-file limit50MB (disabled), no buckets → app private bucket/cap未設定. Exact Vercel project Hobby, Fluid Enabled,1vCPU/2GB; duration blank override/300placeholder, official Hobby max300s, generic max900 not entitlement. D:~7.06TiB free and RAM~22.39GiB available are snapshots only. Known ffmpeg/probe exist, both NotSigned; dedicated verifier workRoot/deployment未指定, existing worker SQLite/mock. Exact2GiB unchanged; paid-plan starting priceUSD25/mo is not organization quote, second project/usage unknown; consolidate actual cost/worker decisions with separate SSL DEC. Read-only only, browser finished; last actual check21:43KST.**
