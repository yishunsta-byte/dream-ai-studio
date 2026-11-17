# B18 — Storage plan cost comparison checkpoint

- Owner: Codex(Backend); Master `msg_13dc7dfa10f9`, checkpoints `msg_d1cd6f1b4495` / `msg_12193f574159`.
- Status: **ready_review — comparison and conditional scenarios only; actual organization checkout quote unconfirmed**.
- Last actual dashboard observation: **2026-11-17 21:47:33 KST (12:47:33 UTC)**. Browser task14 finished immediately after priority B16-FIX instruction; no subsequent provider investigation. Report assembled21:54 KST from that checkpoint and previously read official references.
- B16-FIX `9302419` delivered first, now frozen for B16-R2. Only this new report changes for B18. No paid conversion is authorized.

## Confirmed checkpoint

Existing exact organization was reached through the already established project association. Project-card DOM was counted without outputting project names/contents: **2 projects,1 marked paused**, target project present. Organization still **Free**. One currently non-paused card is an observed state, not a guarantee of future billable hours or an upgrade outcome.

The organization list's existing `Upgrade to Pro` **navigation link** opened an isolated full-screen **Change subscription plan** comparison overlay. Only its plan-comparison container was read. Pro displays **From USD25.00/month**; included100GB file storage and250GB egress, with displayed overage ratesUSD0.0213/GB storage andUSD0.09/GB egress. These are advertised allowances/rates, not a computed organization quote or proof of current usage being inside them.

The comparison contains `Current plan`, **Upgrade to Pro**, and `Upgrade to Team` plan-card buttons. **No plan-card Upgrade button was clicked.** Its next action was not established as preview-only rather than a subscription transition, so the inquiry stopped at this safe boundary as authorized. No Pay/Confirm/Save/checkout/payment-input action, no payment method/address/invoice section inspection, no full billing-page snapshot or account-content evidence capture. Navigation loaded the comparison over the organization billing route; the underlying billing details were not read. Browser task14 was finished and agent pages closed. Only secret-free browser scripts exist outside the repo in the task directory.

| Requested fact | Evidence / classification |
| --- | --- |
| Applies to organization vs project | **Confirmed official contract:** subscription and quota are organization-wide; mixed Free/Pro within one organization is not supported. All2 existing projects therefore fall within the subscription scope, not just this application. |
| Current project count/state | **Observed:**2 project cards,1paused; no other project's names/data collected. Future pause/resume behavior under upgrade was not inspected. |
| Pro base | **Observed comparison:** FromUSD25/month. Not final total. |
| Compute credit/additional projects | **Official documented rule:** monthly organizationUSD10 compute credit; each running project incurs hourly compute, paused projects incur none. Paid-org Nano is billed at Micro rate; compute size is not automatically upgraded. Actual post-upgrade billable hours/state are unconfirmed. |
| Actual total / due today / proration | **Unconfirmed:** no organization-specific checkout or prorated charge was reached. No exact day-based calculation or payment assertion. |
| Tax/currency conversion/payment method | **Unconfirmed:** no tax line or checkout currency total observed. No payment details inspected or inferred. USD list prices do not establish KRW charge or tax-inclusive cost. |
| One-time versus ongoing | **Official contract:** subscription is recurring and plan line charged upfront; metered usage charged in arrears. No one-time-only offer or exact initial charge observed. |
| Final confirmation control / effect boundary | **Unconfirmed:** comparison button label known, subsequent confirmation/payment control not opened. Cannot call that button harmless or assert another dialog will always appear. |
| Spend cap / hard budget | **Official rule only:** Pro Spend Cap covers selected quotas, excludes compute/add-ons; current or future organization cap state not inspected. No hard monthly spending ceiling proved. |

## Sources and conditional costs

Primary references read during B18, no further provider reads after the pause instruction:

- [Organization-based billing](https://supabase.com/docs/guides/platform/billing-on-supabase): separate subscription per organization, all projects share the plan and organization-level allowances; different plans require separate organizations. This report does not propose moving/deleting/reconfiguring another project.
- [Compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute): compute billed per running hour (partial hour counts as full); paused projects excluded;USD10 monthly compute credits reset without accumulation. MicroUSD0.01344/hour, approximatelyUSD10/month; Nano on paid organizations billed at that rate without automatic size upgrade.
- [Pricing](https://supabase.com/pricing): Pro fromUSD25/month, first project included through compute credits and additional projects fromUSD10/month. Starting price is not a final organization quote.
- [Subscription changes](https://supabase.com/docs/guides/platform/manage-your-subscription): upgrades take effect immediately; plan subscription upfront and usage arrears. The public contract does not supply this organization's actual due-today/proration/tax calculation.
- [Cost controls](https://supabase.com/docs/guides/platform/cost-control): covered usage may be restricted at quota with Spend Cap on; compute and separately opted-in resources are excluded. Spend Cap is not a universal dollar budget. No cap was changed.

For illustration only, with no extra services/overages/tax and unchanged list rates, full-month Pro base isUSD25 plus `max(0, aggregate eligible compute charge − USD10 credit)`. This is a scenario formula, **not the organization's current or final monthly bill**. It assumes credit availability/application and a full cycle, not a mid-cycle proration preview.

| Conditional scenario | Illustrative recurring subtotal before tax/extra usage | Missing facts |
| --- | --- | --- |
| One Nano/Micro runs730h, other remains paused with0 billable hours | Compute730×0.01344=USD9.8112; covered byUSD10 credit; approximately **USD25/month** base subtotal. | Must confirm actual upgrade handling of already-paused project, running hours, credit, add-ons and usage before using as a quote. No promise the other project remains paused automatically. |
| Both Nano/Micro projects run730h each | ComputeUSD19.6224−USD10 credit +USD25 =USD34.6224, approximately **USD35/month**. | Conditional on both running for those hours at that rate; not observed transition or authorization to resume the paused project. Different month length changes hourly amount. |
| Larger compute, more running projects, add-ons or quota overage | Above scenarios increase according to actual hourly/usage rates; no finite total calculated. | Resource inventory, region-specific usage, overage/cap settings, tax/proration and worker costs not investigated. |

One verified2GiB original may temporarily need roughly4GiB staging+final storage and roughly4GiB staging/final reads to the worker, before retries/downstream use. That is a workload estimate from B16, not a measured billable-byte count or guarantee that organization allowances remain available. Existing unrelated-project usage shares quotas. Long-term originals and abandoned uploads accumulate storage; plan purchase alone does not implement safe retention or cleanup.

## What can progress without upgrading

Exact product maximum remains **2,147,483,648 bytes**; current actual Free50MB cap cannot provide it, and TUS does not bypass that cap. No fallback product maximum or paid-plan change was made.

After B16-R2 acceptance and Master's separate scope, development can proceed with pure protocol state/receipt/operation/fingerprint tests, including F1/F2/lease/terminal/GC ordering, using synthetic identities and no provider IO. Subsequent separately assigned local isolated PG migration/locking/ACL tests and local fake-provider byte/native tests can validate their bounded contracts without a paid upgrade. These stages cannot claim real2GiB Storage/RLS/worker readiness. No real Free-bucket experiment, large upload or paid traffic is required for the current documentation checkpoint.

The current PC is **only a development/verification candidate**, per Master. B17 disk/RAM/tool presence does not approve always-on use, remote exposure, Scheduler/service installation or actual verifier execution. No paid worker server is approved or purchased. Vercel remains Hobby; B16's lightweight HTTP/DB architecture does not by itself justify a Vercel upgrade.

Master will consolidate the actual recurring-plan/organization impact and worker-placement/uptime decisions before any future operational assignment; no duplicate user cost question is raised here. Exact organization checkout amount, paused-project handling, tax/proration and final action boundary must remain explicitly unknown until safely confirmed in a separately authorized scope. DEC-SSL-01 remains separate and unresolved. Front's deployment authorization rejection must not be bypassed through another actor; B18 performs no deployment or authentication work.

## Delivery and boundary

`git diff --check` is the document check; no product tests/build/worker/SQL/API were run. No B14/B15 source, B16 frozen design, SQL/history/FK, Storage/bucket/policy, account/subscription, pause/resume/compute, payment method, environment/config,3013/shared.next, package or deployment change. Navigation/read-only comparison was performed; no actual upgrade, checkout submission, provider write, charge or resource transition was performed or claimed.

Master transfer: **B18 ready_review. Exact org2projects/1paused and current Free confirmed; isolated comparison FromUSD25/month only. Organization-wide subscription affects both projects;USD10 compute credit shared, paused compute excluded, paid Nano billed Micro. Conditional one-running/other-stays-paused≈USD25, both730h≈USD35 before extras/tax; neither is an actual org quote. Actual total/due-today/proration/tax/final confirm boundary unconfirmed; plan-card Upgrade not clicked, no payment/details/config changes. Last provider observation21:47:33KST; browser finished; further investigation stopped per Master. Pure protocol/local isolated stages can progress only after review/separate assignment, no paid or always-on worker operation authorized.**
