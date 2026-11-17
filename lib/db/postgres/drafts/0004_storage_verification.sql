-- B20 UNPUBLISHED OFFLINE DRAFT. NOT IN MANIFEST. NOT FOR PRODUCTION APPLY.
-- Apply only in a new owned synthetic SQL3 cluster. No transition/definer APIs,
-- registrar grants, Storage configuration or SQL3->4 runner support are supplied.
BEGIN;

CREATE FUNCTION dream.storage_raw_hash(domain_name text, raw_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(domain_name || ':v1' || chr(10) || raw_value,'UTF8')),'hex')
$$;
CREATE FUNCTION dream.storage_uuid7(v uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT v::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;
CREATE FUNCTION dream.storage_creation_fingerprint(client_hash text,snapshot_hash text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,dream AS $$
 SELECT dream.storage_raw_hash('creation-request-v2','{"clientDigest":"' || client_hash || '","fingerprintVersion":2,"snapshotDigest":"' || snapshot_hash || '"}')
$$;

CREATE TABLE dream.storage_policy_versions (
 policy_id text NOT NULL CHECK(length(policy_id) BETWEEN 1 AND 128),
 epoch dream.safe_uint NOT NULL, digest dream.sha256 NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(policy_id,epoch), UNIQUE(policy_id,epoch,digest)
);
CREATE TABLE dream.storage_policies (
 policy_id text PRIMARY KEY, epoch dream.safe_uint NOT NULL, digest dream.sha256 NOT NULL,
 revision dream.safe_uint NOT NULL, updated_at timestamptz NOT NULL,
 FOREIGN KEY(policy_id,epoch,digest) REFERENCES dream.storage_policy_versions(policy_id,epoch,digest) ON DELETE RESTRICT
);
CREATE TABLE dream.storage_objects (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), reserved_asset_id uuid NOT NULL CHECK(dream.storage_uuid7(reserved_asset_id)),
 registered_asset_id uuid, lifecycle text NOT NULL CHECK(lifecycle IN ('reserved','publication_reserved','registered','cleanup_claimed','tombstoned')),
 revision dream.safe_uint NOT NULL, barrier_fence dream.safe_uint NOT NULL, initial_closed boolean NOT NULL DEFAULT false,
 closure_json text, publication_json text,
 active_generation dream.safe_uint NOT NULL, cleanup_id uuid,
 bucket text, object_key text, provider_version text, kind text, mime text, sha256 dream.sha256,
 size_bytes dream.safe_positive, identity_json text, identity_digest dream.sha256,
 created_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,reserved_asset_id), UNIQUE(bucket,object_key),
 UNIQUE(owner_id,id,identity_digest), UNIQUE(owner_id,id,registered_asset_id),
 UNIQUE(owner_id,id,bucket,object_key,identity_digest),
 FOREIGN KEY(owner_id,registered_asset_id) REFERENCES dream.assets(owner_id,id) ON DELETE RESTRICT,
 CHECK(registered_asset_id IS NULL OR registered_asset_id=reserved_asset_id),
 CHECK((lifecycle='registered')=(registered_asset_id IS NOT NULL)),
 CHECK(lifecycle<>'registered' OR NOT initial_closed), CHECK(lifecycle NOT IN ('cleanup_claimed','tombstoned') OR initial_closed),
 CHECK(initial_closed=(closure_json IS NOT NULL)), CHECK(closure_json IS NULL OR jsonb_typeof(closure_json::jsonb)='object'),
 CHECK((identity_json IS NULL)=(publication_json IS NULL)), CHECK(publication_json IS NULL OR jsonb_typeof(publication_json::jsonb)='object'),
 CHECK((lifecycle IN ('cleanup_claimed','tombstoned'))=(cleanup_id IS NOT NULL)),
 CHECK((identity_json IS NULL AND identity_digest IS NULL AND bucket IS NULL AND object_key IS NULL AND provider_version IS NULL
   AND kind IS NULL AND mime IS NULL AND sha256 IS NULL AND size_bytes IS NULL)
  OR (identity_json IS NOT NULL AND identity_digest IS NOT NULL AND bucket IS NOT NULL AND object_key IS NOT NULL
   AND kind IS NOT NULL AND mime IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL)),
 CHECK(lifecycle NOT IN ('publication_reserved','registered') OR identity_json IS NOT NULL),
 CHECK(lifecycle<>'reserved' OR identity_json IS NULL),
 CHECK(bucket IS NULL OR bucket ~ '^[a-z][a-z0-9-]{0,62}$'),
 CHECK(provider_version IS NULL OR length(provider_version) BETWEEN 1 AND 256),
 CHECK(size_bytes IS NULL OR size_bytes<=2147483648),
 CHECK(identity_json IS NULL OR ((
   identity_digest=dream.storage_raw_hash('object-identity',identity_json)
   AND identity_json::jsonb=jsonb_build_object('ownerId',owner_id::text,'assetId',reserved_asset_id::text,
     'bucket',bucket,'key',object_key,'providerVersion',provider_version,'kind',kind,'mime',mime,'sha256',sha256,'sizeBytes',size_bytes)
   AND object_key=owner_id::text || '/assets/' || reserved_asset_id::text || '/' || sha256 || '.' ||
     CASE mime WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp'
       WHEN 'video/mp4' THEN 'mp4' WHEN 'video/quicktime' THEN 'mov' WHEN 'video/webm' THEN 'webm' END
   AND kind=CASE WHEN mime IN ('image/png','image/jpeg','image/webp') THEN 'image'
     WHEN mime IN ('video/mp4','video/quicktime','video/webm') THEN 'video' END
  ) IS TRUE))
);
CREATE TABLE dream.upload_intents (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL,
 request_id uuid NOT NULL CHECK(dream.storage_uuid7(request_id)), request_fingerprint dream.sha256 NOT NULL,
 request_json text NOT NULL CHECK(jsonb_typeof(request_json::jsonb)='object'), request_raw_sha dream.sha256 NOT NULL,
 incoming_bucket text NOT NULL CHECK(incoming_bucket ~ '^[a-z][a-z0-9-]{0,62}$'), incoming_key text NOT NULL,
 max_bytes dream.safe_positive NOT NULL CHECK(max_bytes<=2147483648),
 authorization_until timestamptz NOT NULL, issue_envelope_until timestamptz NOT NULL,
 max_issues dream.safe_positive NOT NULL, issue_count dream.safe_uint NOT NULL,
 status text NOT NULL CHECK(status IN ('open','completion_requested','succeeded','canceled','expired','failed')),
 revision dream.safe_uint NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,id,object_id), UNIQUE(owner_id,object_id), UNIQUE(owner_id,request_id),
 UNIQUE(owner_id,id,object_id,incoming_bucket,incoming_key),
 FOREIGN KEY(owner_id,object_id) REFERENCES dream.storage_objects(owner_id,id) ON DELETE RESTRICT,
 CHECK(issue_envelope_until<=authorization_until AND issue_count<=max_issues),
 CHECK(request_raw_sha=encode(sha256(convert_to(request_json,'UTF8')),'hex')),
 CHECK(dream.valid_object_key(incoming_key,owner_id) AND incoming_key ~ '^[a-zA-Z0-9/_.-]+$')
);
CREATE TABLE dream.storage_verification_operations (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL,
 intent_id uuid, kind text NOT NULL CHECK(kind IN ('initial','reverify')), generation dream.safe_positive NOT NULL,
 request_fingerprint dream.sha256 NOT NULL, request_json text NOT NULL CHECK(jsonb_typeof(request_json::jsonb)='object'),
 request_raw_sha dream.sha256 NOT NULL, policy_id text NOT NULL, policy_epoch dream.safe_uint NOT NULL, policy_digest dream.sha256 NOT NULL,
 authorization_until timestamptz NOT NULL, expected_state_revision dream.safe_uint NOT NULL,
 fence dream.safe_uint NOT NULL, lease_until timestamptz, worker_id uuid,
 claimed_at timestamptz, claim_verifiers uuid[] NOT NULL DEFAULT '{}', completed_at timestamptz, completed_state_revision dream.safe_uint,
 completed_aggregate_revision dream.safe_positive,
 canceled_claim_json text,
 status text NOT NULL CHECK(status IN ('pending','running','succeeded','failed','canceled')),
 terminal_receipt_id uuid, terminal_json text, terminal_digest dream.sha256, failure_code text,
 revision dream.safe_uint NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,id,object_id,generation), UNIQUE(owner_id,object_id,generation),
 UNIQUE(owner_id,id,object_id,generation,fence,policy_id,policy_epoch,policy_digest),
 FOREIGN KEY(owner_id,object_id) REFERENCES dream.storage_objects(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,intent_id,object_id) REFERENCES dream.upload_intents(owner_id,id,object_id) ON DELETE RESTRICT,
 FOREIGN KEY(policy_id,policy_epoch,policy_digest) REFERENCES dream.storage_policy_versions(policy_id,epoch,digest) ON DELETE RESTRICT,
 CHECK((kind='initial' AND intent_id IS NOT NULL AND generation=1) OR (kind='reverify' AND intent_id IS NULL AND generation>1)),
 CHECK((lease_until IS NULL)=(worker_id IS NULL)), CHECK(lease_until IS NULL OR lease_until<=authorization_until),
 CHECK((lease_until IS NULL)=(claimed_at IS NULL)),
 CHECK(array_position(claim_verifiers,NULL) IS NULL AND cardinality(claim_verifiers)<=100),
 CHECK((lease_until IS NULL AND cardinality(claim_verifiers)=0) OR
   ((lease_until IS NOT NULL AND claimed_at<lease_until AND worker_id=ANY(claim_verifiers) AND fence>0) IS TRUE)),
 CHECK((status IN ('succeeded','failed','canceled'))=(completed_at IS NOT NULL AND completed_state_revision IS NOT NULL)),
 CHECK((status IN ('succeeded','failed','canceled'))=(completed_aggregate_revision IS NOT NULL)),
 CHECK(status NOT IN ('pending','running') OR (completed_at IS NULL AND completed_state_revision IS NULL AND completed_aggregate_revision IS NULL
   AND terminal_receipt_id IS NULL AND terminal_json IS NULL AND terminal_digest IS NULL AND failure_code IS NULL)),
 CHECK(status NOT IN ('succeeded','failed') OR
   ((claimed_at IS NOT NULL AND completed_at>=claimed_at AND completed_at<lease_until AND completed_at<authorization_until) IS TRUE)),
 CHECK(status<>'succeeded' OR completed_state_revision=expected_state_revision+1),
 CHECK(created_at<authorization_until AND (claimed_at IS NULL OR claimed_at>=created_at) AND (completed_at IS NULL OR completed_at>=created_at)),
 CHECK(status<>'canceled' OR (worker_id IS NULL AND lease_until IS NULL AND claimed_at IS NULL AND cardinality(claim_verifiers)=0)),
 CHECK(status='canceled' OR canceled_claim_json IS NULL), CHECK(canceled_claim_json IS NULL OR jsonb_typeof(canceled_claim_json::jsonb)='object'),
 CHECK(status<>'running' OR (lease_until IS NOT NULL AND fence>0)),
 CHECK((status IN ('succeeded','failed','canceled'))=(terminal_json IS NOT NULL AND terminal_digest IS NOT NULL)),
 CHECK(status='succeeded' OR terminal_receipt_id IS NULL), CHECK(status<>'succeeded' OR terminal_receipt_id IS NOT NULL),
 CHECK((status='failed')=(failure_code IS NOT NULL)),
 CHECK(failure_code IS NULL OR failure_code IN ('INVALID_BYTES','MIME_MISMATCH','SIZE_MISMATCH','HASH_MISMATCH','MEDIA_INVALID')),
 CHECK(request_raw_sha=encode(sha256(convert_to(request_json,'UTF8')),'hex')),
 CHECK(terminal_json IS NULL OR (jsonb_typeof(terminal_json::jsonb)='object' AND terminal_digest=dream.storage_raw_hash('verification-terminal',terminal_json)))
 ,CHECK(status<>'succeeded' OR terminal_json::jsonb=jsonb_build_object('status','succeeded','receiptId',terminal_receipt_id::text))
 ,CHECK(status<>'failed' OR terminal_json::jsonb=jsonb_build_object('status','failed','code',failure_code))
 ,CHECK(status<>'canceled' OR terminal_json::jsonb='{"status":"canceled"}'::jsonb)
);
CREATE UNIQUE INDEX storage_one_initial ON dream.storage_verification_operations(owner_id,object_id) WHERE kind='initial';
CREATE UNIQUE INDEX storage_one_live_generation ON dream.storage_verification_operations(owner_id,object_id) WHERE status IN ('pending','running');
CREATE TABLE dream.storage_verification_runs (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL, operation_id uuid NOT NULL,
 generation dream.safe_positive NOT NULL, fence dream.safe_positive NOT NULL, worker_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('succeeded','failed')), observed_json text NOT NULL CHECK(jsonb_typeof(observed_json::jsonb)='object'),
 observed_sha dream.sha256 NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,operation_id,fence),
 UNIQUE(owner_id,id,operation_id,object_id,generation,fence,outcome),
 FOREIGN KEY(owner_id,operation_id,object_id,generation) REFERENCES dream.storage_verification_operations(owner_id,id,object_id,generation) ON DELETE RESTRICT,
 CHECK(observed_sha=encode(sha256(convert_to(observed_json,'UTF8')),'hex'))
);
CREATE TABLE dream.storage_verification_receipts (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL, asset_id uuid NOT NULL,
 operation_id uuid NOT NULL, run_id uuid NOT NULL, generation dream.safe_positive NOT NULL, fence dream.safe_positive NOT NULL,
 run_outcome text NOT NULL DEFAULT 'succeeded' CHECK(run_outcome='succeeded'),
 identity_digest dream.sha256 NOT NULL, policy_id text NOT NULL, policy_epoch dream.safe_uint NOT NULL, policy_digest dream.sha256 NOT NULL,
 source_bucket text NOT NULL CHECK(source_bucket ~ '^[a-z][a-z0-9-]{0,62}$'), source_key text NOT NULL, source_version text,
 width dream.safe_positive NOT NULL, height dream.safe_positive NOT NULL, duration_ms dream.safe_positive,
 verifier_id uuid NOT NULL, verifier_version text NOT NULL CHECK(length(verifier_version) BETWEEN 1 AND 128),
 tool_version text NOT NULL CHECK(length(tool_version) BETWEEN 1 AND 128),
 verified_at timestamptz NOT NULL, not_after timestamptz NOT NULL,
 receipt_json text NOT NULL, receipt_digest dream.sha256 NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,operation_id), UNIQUE(owner_id,object_id,generation),
 UNIQUE(owner_id,id,operation_id,object_id,generation), UNIQUE(owner_id,id,object_id,asset_id),
 FOREIGN KEY(owner_id,object_id,identity_digest) REFERENCES dream.storage_objects(owner_id,id,identity_digest) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,asset_id) REFERENCES dream.assets(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,operation_id,object_id,generation,fence,policy_id,policy_epoch,policy_digest)
   REFERENCES dream.storage_verification_operations(owner_id,id,object_id,generation,fence,policy_id,policy_epoch,policy_digest) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,run_id,operation_id,object_id,generation,fence,run_outcome)
   REFERENCES dream.storage_verification_runs(owner_id,id,operation_id,object_id,generation,fence,outcome) ON DELETE RESTRICT,
 CHECK(not_after>verified_at), CHECK(dream.valid_object_key(source_key,owner_id)),
 CHECK(receipt_digest=dream.storage_raw_hash('verification-receipt',receipt_json)),
 CHECK(jsonb_typeof(receipt_json::jsonb)='object')
);
ALTER TABLE dream.storage_verification_operations ADD FOREIGN KEY(owner_id,terminal_receipt_id,id,object_id,generation)
 REFERENCES dream.storage_verification_receipts(owner_id,id,operation_id,object_id,generation) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE dream.asset_receipt_state (
 owner_id uuid NOT NULL, asset_id uuid NOT NULL, object_id uuid NOT NULL, current_receipt_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('ready','revoked','unavailable')), revision dream.safe_uint NOT NULL,
 revocation_history_json text NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(revocation_history_json::jsonb)='array'),
 reason_code text, updated_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,asset_id), UNIQUE(owner_id,object_id),
 FOREIGN KEY(owner_id,object_id,asset_id) REFERENCES dream.storage_objects(owner_id,id,registered_asset_id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,current_receipt_id,object_id,asset_id) REFERENCES dream.storage_verification_receipts(owner_id,id,object_id,asset_id) ON DELETE RESTRICT
);
CREATE TABLE dream.storage_cleanup_claims (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL,
 barrier_fence dream.safe_positive NOT NULL, claimed_at timestamptz NOT NULL,
 claimed_aggregate_revision dream.safe_positive NOT NULL,
 revision dream.safe_uint NOT NULL DEFAULT 0, observation_json text CHECK(observation_json IS NULL OR jsonb_typeof(observation_json::jsonb)='object'),
 UNIQUE(owner_id,id,object_id), UNIQUE(owner_id,object_id), UNIQUE(owner_id,id,object_id,barrier_fence),
 FOREIGN KEY(owner_id,object_id) REFERENCES dream.storage_objects(owner_id,id) ON DELETE RESTRICT
);
ALTER TABLE dream.storage_objects ADD FOREIGN KEY(owner_id,cleanup_id,id,barrier_fence)
 REFERENCES dream.storage_cleanup_claims(owner_id,id,object_id,barrier_fence) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE dream.storage_outbox (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('publish','delete','reconcile')), target_kind text NOT NULL CHECK(target_kind IN ('final','incoming')),
 operation_id uuid, generation dream.safe_positive, fence dream.safe_uint NOT NULL, barrier_fence dream.safe_uint NOT NULL,
 intent_id uuid, cleanup_id uuid, bucket text NOT NULL, object_key text NOT NULL, identity_digest dream.sha256,
 payload_json text NOT NULL CHECK(jsonb_typeof(payload_json::jsonb)='object'), payload_sha dream.sha256 NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','claimed','uncertain','done','failed')), attempts dream.safe_uint NOT NULL,
 revision dream.safe_uint NOT NULL, next_attempt_at timestamptz, created_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,object_id,kind,id),
 FOREIGN KEY(owner_id,object_id) REFERENCES dream.storage_objects(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,operation_id,object_id,generation) REFERENCES dream.storage_verification_operations(owner_id,id,object_id,generation) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,object_id,bucket,object_key,identity_digest) REFERENCES dream.storage_objects(owner_id,id,bucket,object_key,identity_digest) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,intent_id,object_id,bucket,object_key) REFERENCES dream.upload_intents(owner_id,id,object_id,incoming_bucket,incoming_key) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,cleanup_id,object_id,barrier_fence) REFERENCES dream.storage_cleanup_claims(owner_id,id,object_id,barrier_fence) ON DELETE RESTRICT,
 CHECK((target_kind='final' AND identity_digest IS NOT NULL AND intent_id IS NULL)
   OR (target_kind='incoming' AND intent_id IS NOT NULL AND identity_digest IS NULL)),
 CHECK(kind<>'publish' OR (target_kind='final' AND operation_id IS NOT NULL AND generation IS NOT NULL AND fence>0)),
 CHECK((operation_id IS NULL)=(generation IS NULL)),
 CHECK((kind='delete')=(cleanup_id IS NOT NULL)),
 CHECK(payload_sha=encode(sha256(convert_to(payload_json,'UTF8')),'hex'))
);
CREATE TABLE dream.storage_capability_issues (
 owner_id uuid NOT NULL, id uuid PRIMARY KEY CHECK(dream.storage_uuid7(id)), object_id uuid NOT NULL, intent_id uuid NOT NULL,
 ordinal dream.safe_positive NOT NULL, issue_until_ms dream.safe_uint NOT NULL,
 latest_acceptance_ms dream.safe_uint, token_lifetime_ms dream.safe_uint NOT NULL,
 resource_lifetime_ms dream.safe_uint NOT NULL, grace_ms dream.safe_uint NOT NULL,
 horizon_ms bigint GENERATED ALWAYS AS (latest_acceptance_ms + token_lifetime_ms + resource_lifetime_ms + grace_ms) STORED,
 bound_evidence dream.sha256, dispatched boolean NOT NULL, outcome text NOT NULL CHECK(outcome IN ('reserved','uncertain','issued','not_issued')),
 revision dream.safe_uint NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,intent_id,ordinal),
 FOREIGN KEY(owner_id,intent_id,object_id) REFERENCES dream.upload_intents(owner_id,id,object_id) ON DELETE RESTRICT,
 CHECK(latest_acceptance_ms IS NULL OR latest_acceptance_ms>=issue_until_ms),
 CHECK(horizon_ms IS NULL OR horizon_ms BETWEEN 0 AND 9007199254740991),
 CHECK(dispatched OR outcome='reserved')
);
CREATE TABLE dream.creation_operations (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, request_id uuid NOT NULL CHECK(dream.storage_uuid7(request_id)),
 client_digest dream.sha256 NOT NULL, snapshot_digest dream.sha256 NOT NULL, fingerprint_version integer NOT NULL CHECK(fingerprint_version=2), request_fingerprint dream.sha256 NOT NULL,
 client_json text, original_snapshot_json text, request_json text,
 authorization_until timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('pending','succeeded','failed','canceled','retired')),
 project_id uuid, result_json text, result_digest dream.sha256, failure_code text,
 settled_at timestamptz, settled_by uuid, settled_registrars uuid[] NOT NULL DEFAULT '{}',
 retired_at timestamptz, retired_by uuid, retired_registrars uuid[] NOT NULL DEFAULT '{}', retired_from text CHECK(retired_from IN ('pending','terminal')),
 revision dream.safe_uint NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,project_id) REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT,
 CHECK(status='retired' OR ((client_json IS NOT NULL AND original_snapshot_json IS NOT NULL AND request_json IS NOT NULL
   AND jsonb_typeof(client_json::jsonb)='object' AND jsonb_typeof(original_snapshot_json::jsonb)='object'
   AND client_digest=dream.storage_raw_hash('creation-client',client_json)
   AND snapshot_digest=dream.storage_raw_hash('creation-snapshot',original_snapshot_json)
   AND request_json::jsonb=jsonb_build_object('client',client_json::jsonb,'snapshot',original_snapshot_json::jsonb)) IS TRUE)),
 CHECK(request_fingerprint=dream.storage_creation_fingerprint(client_digest,snapshot_digest)),
 CHECK((status IN ('succeeded','failed','canceled'))=(settled_at IS NOT NULL) OR status='retired'),
 CHECK((settled_at IS NULL AND settled_by IS NULL AND cardinality(settled_registrars)=0 AND result_json IS NULL AND result_digest IS NULL)
   OR ((settled_at IS NOT NULL AND settled_by IS NOT NULL AND settled_by=ANY(settled_registrars) AND settled_at<authorization_until AND result_json IS NOT NULL AND result_digest IS NOT NULL) IS TRUE)),
 CHECK(array_position(settled_registrars,NULL) IS NULL AND cardinality(settled_registrars)<=100),
 CHECK(array_position(retired_registrars,NULL) IS NULL AND cardinality(retired_registrars)<=100),
 CHECK(status<>'retired' OR ((retired_at IS NOT NULL AND retired_by=ANY(retired_registrars) AND
    client_json IS NULL AND original_snapshot_json IS NULL AND request_json IS NULL AND
    ((retired_from='pending' AND settled_at IS NULL AND retired_at>=authorization_until) OR
     (retired_from='terminal' AND settled_at IS NOT NULL AND retired_at>=settled_at))) IS TRUE)),
 CHECK(status='retired' OR (retired_at IS NULL AND retired_by IS NULL AND cardinality(retired_registrars)=0 AND retired_from IS NULL)),
 CHECK(status NOT IN ('succeeded') OR project_id IS NOT NULL),
 CHECK(status NOT IN ('pending','failed','canceled') OR project_id IS NULL),
 CHECK(status NOT IN ('succeeded','failed','canceled') OR (result_json IS NOT NULL AND result_digest IS NOT NULL)),
 CHECK(status<>'pending' OR (result_json IS NULL AND result_digest IS NULL AND failure_code IS NULL)),
 CHECK(status<>'failed' OR (failure_code IS NOT NULL AND failure_code ~ '^[A-Z_]{1,64}$')),
 CHECK(result_json IS NULL OR result_digest=dream.storage_raw_hash('creation-result',result_json)),
 CHECK(status<>'succeeded' OR result_json::jsonb=jsonb_build_object('status','succeeded','projectId',project_id::text)),
 CHECK(status<>'failed' OR result_json::jsonb=jsonb_build_object('status','failed','code',failure_code)),
 CHECK(status<>'canceled' OR result_json::jsonb='{"status":"canceled"}'::jsonb)
);

-- Invoker-only constraints, NOT SECURITY DEFINER transition/executor functions.
CREATE FUNCTION dream.storage_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,dream AS $$
DECLARE o jsonb; n jsonb; obj dream.storage_objects%ROWTYPE; op dream.storage_verification_operations%ROWTYPE;
 old_generation bigint; new_generation bigint; expected jsonb; i integer; evidence jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'storage identity/history cannot be deleted' USING ERRCODE='23514'; END IF;
 n:=to_jsonb(NEW);
 -- Validate JSON kinds and required keys before any text extraction/cast. SQL
 -- NULL is not false, and PostgreSQL accepts non-JSON boolean spellings like yes.
 IF TG_TABLE_NAME='storage_objects' AND n->>'closure_json' IS NOT NULL THEN
  evidence:=(n->>'closure_json')::jsonb;
  IF ((jsonb_typeof(evidence)='object' AND evidence ?& ARRAY['revision','at','principalId','authorizers','reason','operationId']
    AND evidence-ARRAY['revision','at','principalId','authorizers','reason','operationId']='{}'::jsonb
    AND jsonb_typeof(evidence->'revision')='number' AND jsonb_typeof(evidence->'at')='number'
    AND jsonb_typeof(evidence->'principalId')='string' AND jsonb_typeof(evidence->'authorizers')='array'
    AND jsonb_typeof(evidence->'reason')='string' AND evidence->>'reason' IN ('cancel','verification_failure','cleanup')
    AND (evidence->'operationId'='null'::jsonb OR (jsonb_typeof(evidence->'operationId')='string'
      AND evidence->>'operationId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))) IS NOT TRUE) THEN
   RAISE EXCEPTION 'invalid closure JSON fields/types' USING ERRCODE='23514'; END IF;
  IF (((evidence->>'revision')::numeric BETWEEN 1 AND 9007199254740991
    AND trunc((evidence->>'revision')::numeric)=(evidence->>'revision')::numeric
    AND (evidence->>'at')::numeric BETWEEN 0 AND 9007199254740991 AND trunc((evidence->>'at')::numeric)=(evidence->>'at')::numeric
    AND evidence->>'principalId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND jsonb_array_length(evidence->'authorizers') BETWEEN 1 AND 100
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'authorizers') a WHERE
      (jsonb_typeof(a)='string' AND a#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE)) IS NOT TRUE) THEN
   RAISE EXCEPTION 'invalid closure JSON values' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='storage_cleanup_claims' AND n->>'observation_json' IS NOT NULL THEN
  evidence:=(n->>'observation_json')::jsonb;
  IF ((jsonb_typeof(evidence)='object' AND evidence ?& ARRAY['at','absent','writerQuiescent','identityDigest']
    AND evidence-ARRAY['at','absent','writerQuiescent','identityDigest']='{}'::jsonb
    AND jsonb_typeof(evidence->'at')='number' AND jsonb_typeof(evidence->'absent')='boolean'
    AND jsonb_typeof(evidence->'writerQuiescent')='boolean' AND jsonb_typeof(evidence->'identityDigest')='string'
    AND evidence->>'identityDigest' ~ '^[0-9a-f]{64}$') IS NOT TRUE) THEN
   RAISE EXCEPTION 'invalid cleanup observation JSON fields/types' USING ERRCODE='23514'; END IF;
  IF (((evidence->>'at')::numeric BETWEEN 0 AND 9007199254740991
    AND trunc((evidence->>'at')::numeric)=(evidence->>'at')::numeric) IS NOT TRUE) THEN
   RAISE EXCEPTION 'invalid cleanup observation time' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF (TG_TABLE_NAME='storage_objects' AND (n->>'lifecycle'<>'reserved' OR n->>'revision'<>'0' OR n->>'barrier_fence'<>'0' OR n->>'active_generation'<>'0'))
   OR (TG_TABLE_NAME='storage_verification_operations' AND (n->>'status'<>'pending' OR n->>'revision'<>'0' OR n->>'fence'<>'0' OR n->>'lease_until' IS NOT NULL))
   OR (TG_TABLE_NAME='creation_operations' AND (n->>'status'<>'pending' OR n->>'revision'<>'0'))
   OR (TG_TABLE_NAME='storage_capability_issues' AND (n->>'outcome'<>'reserved' OR n->>'revision'<>'0' OR n->>'dispatched'<>'false')) THEN
   RAISE EXCEPTION 'record must begin as reservation' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  o:=to_jsonb(OLD);
  IF n->'owner_id' IS DISTINCT FROM o->'owner_id' OR n->'id' IS DISTINCT FROM o->'id'
    OR n->'request_id' IS DISTINCT FROM o->'request_id' OR n->'created_at' IS DISTINCT FROM o->'created_at' THEN
   RAISE EXCEPTION 'storage row identity is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('storage_policy_versions','storage_verification_runs','storage_verification_receipts') THEN
   RAISE EXCEPTION 'storage history is append only' USING ERRCODE='23514'; END IF;
  IF (n->>'revision')::bigint<>(o->>'revision')::bigint+1 THEN RAISE EXCEPTION 'revision CAS step required' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='storage_objects' THEN
   IF (n-ARRAY['revision','barrier_fence','active_generation','initial_closed','closure_json','publication_json','cleanup_id','lifecycle','registered_asset_id','bucket','object_key','provider_version','kind','mime','sha256','size_bytes','identity_json','identity_digest'])
     IS DISTINCT FROM (o-ARRAY['revision','barrier_fence','active_generation','initial_closed','closure_json','publication_json','cleanup_id','lifecycle','registered_asset_id','bucket','object_key','provider_version','kind','mime','sha256','size_bytes','identity_json','identity_digest'])
     OR (OLD.identity_json IS NOT NULL AND (n-ARRAY['revision','barrier_fence','active_generation','initial_closed','closure_json','publication_json','cleanup_id','lifecycle','registered_asset_id'])
       IS DISTINCT FROM (o-ARRAY['revision','barrier_fence','active_generation','initial_closed','closure_json','publication_json','cleanup_id','lifecycle','registered_asset_id']))
     THEN RAISE EXCEPTION 'object tuple is immutable' USING ERRCODE='23514'; END IF;
   IF (OLD.closure_json IS NOT NULL AND NEW.closure_json IS DISTINCT FROM OLD.closure_json)
     OR ((OLD.lifecycle='registered' OR OLD.initial_closed) AND NEW.publication_json IS DISTINCT FROM OLD.publication_json) THEN
    RAISE EXCEPTION 'closure/publication history cannot be replaced' USING ERRCODE='23514'; END IF;
   IF NEW.barrier_fence<OLD.barrier_fence OR NEW.active_generation<OLD.active_generation OR (OLD.initial_closed AND NOT NEW.initial_closed)
     OR (OLD.lifecycle='registered' AND NEW.lifecycle<>'registered')
     OR (OLD.lifecycle IN ('cleanup_claimed','tombstoned') AND (NEW.lifecycle NOT IN ('cleanup_claimed','tombstoned') OR NEW.cleanup_id<>OLD.cleanup_id))
     OR (NEW.lifecycle IN ('cleanup_claimed','tombstoned') AND OLD.lifecycle NOT IN ('cleanup_claimed','tombstoned') AND NEW.barrier_fence<=OLD.barrier_fence)
     OR (NEW.lifecycle='registered' AND OLD.lifecycle NOT IN ('publication_reserved','registered')) THEN
    RAISE EXCEPTION 'invalid object lifecycle' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='upload_intents' THEN
   IF (n-ARRAY['revision','status','issue_count']) IS DISTINCT FROM (o-ARRAY['revision','status','issue_count'])
     OR NEW.issue_count<OLD.issue_count OR (OLD.status IN ('succeeded','failed','canceled','expired') AND n IS DISTINCT FROM o) THEN
    RAISE EXCEPTION 'intent identity or terminal outcome is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='storage_verification_operations' THEN
   IF (n-ARRAY['revision','status','fence','lease_until','worker_id','claimed_at','claim_verifiers','completed_at','completed_state_revision','completed_aggregate_revision','canceled_claim_json','terminal_receipt_id','terminal_json','terminal_digest','failure_code'])
     IS DISTINCT FROM (o-ARRAY['revision','status','fence','lease_until','worker_id','claimed_at','claim_verifiers','completed_at','completed_state_revision','completed_aggregate_revision','canceled_claim_json','terminal_receipt_id','terminal_json','terminal_digest','failure_code'])
     OR NEW.fence<OLD.fence OR OLD.status IN ('succeeded','failed','canceled') THEN
    RAISE EXCEPTION 'operation identity or terminal outcome is immutable' USING ERRCODE='23514'; END IF;
   IF NEW.fence>OLD.fence+1 OR (NEW.fence=OLD.fence AND OLD.worker_id IS NOT NULL AND
      (NEW.worker_id IS DISTINCT FROM OLD.worker_id OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.claim_verifiers IS DISTINCT FROM OLD.claim_verifiers
       OR NEW.lease_until<OLD.lease_until)) OR (NEW.fence>OLD.fence AND NEW.worker_id IS NOT NULL AND OLD.lease_until IS NOT NULL AND NEW.claimed_at<OLD.lease_until) THEN
    RAISE EXCEPTION 'claim history cannot change without legal fence step' USING ERRCODE='23514'; END IF;
   IF NEW.status='canceled' THEN
    expected:=CASE WHEN OLD.worker_id IS NULL THEN NULL ELSE jsonb_build_object('workerId',OLD.worker_id::text,'fence',OLD.fence,
      'claimedAt',floor(extract(epoch FROM OLD.claimed_at)*1000)::bigint,'leaseUntil',floor(extract(epoch FROM OLD.lease_until)*1000)::bigint,
      'authorizationUntil',floor(extract(epoch FROM OLD.authorization_until)*1000)::bigint,'policyEpoch',OLD.policy_epoch,'policyDigest',OLD.policy_digest,'claimVerifiers',to_jsonb(OLD.claim_verifiers)) END;
    IF NEW.canceled_claim_json::jsonb IS DISTINCT FROM expected OR NEW.fence<>OLD.fence+1 THEN
     RAISE EXCEPTION 'canceled claim history differs' USING ERRCODE='23514'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='storage_policies' THEN
   IF NEW.policy_id<>OLD.policy_id OR NEW.epoch<>OLD.epoch+1 THEN RAISE EXCEPTION 'policy epoch must advance' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='asset_receipt_state' THEN
   IF (n-ARRAY['revision','status','reason_code','updated_at','current_receipt_id','revocation_history_json']) IS DISTINCT FROM (o-ARRAY['revision','status','reason_code','updated_at','current_receipt_id','revocation_history_json']) THEN
    RAISE EXCEPTION 'asset state identity is immutable' USING ERRCODE='23514'; END IF;
   IF jsonb_array_length(NEW.revocation_history_json::jsonb)<jsonb_array_length(OLD.revocation_history_json::jsonb) THEN
    RAISE EXCEPTION 'revocation history cannot shrink' USING ERRCODE='23514'; END IF;
   FOR i IN 0..jsonb_array_length(OLD.revocation_history_json::jsonb)-1 LOOP
    IF NEW.revocation_history_json::jsonb->i IS DISTINCT FROM OLD.revocation_history_json::jsonb->i THEN
     RAISE EXCEPTION 'revocation event is immutable' USING ERRCODE='23514'; END IF;
   END LOOP;
   IF NEW.current_receipt_id<>OLD.current_receipt_id THEN
    SELECT generation INTO old_generation FROM dream.storage_verification_receipts WHERE owner_id=OLD.owner_id AND id=OLD.current_receipt_id;
    SELECT generation INTO new_generation FROM dream.storage_verification_receipts WHERE owner_id=NEW.owner_id AND id=NEW.current_receipt_id;
    IF new_generation<=old_generation THEN RAISE EXCEPTION 'receipt pointer cannot go backwards' USING ERRCODE='23514'; END IF;
   ELSIF OLD.status<>'ready' AND NEW.status='ready' THEN RAISE EXCEPTION 'new receipt required for ready' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='storage_cleanup_claims' THEN
   IF (n-ARRAY['revision','observation_json']) IS DISTINCT FROM (o-ARRAY['revision','observation_json'])
    OR (OLD.observation_json IS NOT NULL AND (NEW.observation_json IS NULL OR (NEW.observation_json::jsonb->>'at')::numeric::bigint<(OLD.observation_json::jsonb->>'at')::numeric::bigint)) THEN
    RAISE EXCEPTION 'cleanup claim identity/observation time is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='storage_outbox' THEN
   IF (n-ARRAY['revision','status','attempts','next_attempt_at']) IS DISTINCT FROM (o-ARRAY['revision','status','attempts','next_attempt_at']) OR NEW.attempts<OLD.attempts THEN
    RAISE EXCEPTION 'outbox target is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='storage_capability_issues' THEN
   IF (n-ARRAY['revision','latest_acceptance_ms','horizon_ms','bound_evidence','dispatched','outcome'])
     IS DISTINCT FROM (o-ARRAY['revision','latest_acceptance_ms','horizon_ms','bound_evidence','dispatched','outcome'])
     OR (OLD.dispatched AND NOT NEW.dispatched) OR (OLD.latest_acceptance_ms IS NOT NULL AND NEW.latest_acceptance_ms IS DISTINCT FROM OLD.latest_acceptance_ms)
     OR (OLD.bound_evidence IS NOT NULL AND NEW.bound_evidence IS DISTINCT FROM OLD.bound_evidence)
     OR (OLD.latest_acceptance_ms IS NULL AND NEW.latest_acceptance_ms IS NOT NULL AND NEW.bound_evidence IS NULL) THEN
    RAISE EXCEPTION 'capability reservation/lifetime cannot be reused or shortened' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='creation_operations' THEN
   IF (n-ARRAY['revision','status','project_id','result_json','result_digest','failure_code','client_json','original_snapshot_json','request_json','settled_at','settled_by','settled_registrars','retired_at','retired_by','retired_registrars','retired_from'])
     IS DISTINCT FROM (o-ARRAY['revision','status','project_id','result_json','result_digest','failure_code','client_json','original_snapshot_json','request_json','settled_at','settled_by','settled_registrars','retired_at','retired_by','retired_registrars','retired_from'])
     OR (OLD.status='retired') OR (OLD.status<>'pending' AND NEW.status<>'retired')
     OR (NEW.status<>'retired' AND (NEW.client_json IS DISTINCT FROM OLD.client_json OR NEW.original_snapshot_json IS DISTINCT FROM OLD.original_snapshot_json OR NEW.request_json IS DISTINCT FROM OLD.request_json))
     OR (NEW.status='retired' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.result_json IS DISTINCT FROM OLD.result_json
       OR NEW.result_digest IS DISTINCT FROM OLD.result_digest OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
       OR NEW.settled_by IS DISTINCT FROM OLD.settled_by OR NEW.settled_registrars IS DISTINCT FROM OLD.settled_registrars
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code)) THEN
    RAISE EXCEPTION 'creation snapshot/result/retired ID is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='storage_objects' AND n->>'lifecycle'='registered' THEN
  IF NOT EXISTS(SELECT 1 FROM dream.assets a WHERE a.owner_id=NEW.owner_id AND a.id=NEW.registered_asset_id
    AND a.file_path=NEW.object_key AND a.sha256=NEW.sha256 AND a.mime=NEW.mime AND a.kind=NEW.kind AND a.size_bytes=NEW.size_bytes) THEN
   RAISE EXCEPTION 'registered asset tuple differs' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='storage_verification_receipts' THEN
  SELECT * INTO STRICT obj FROM dream.storage_objects WHERE owner_id=NEW.owner_id AND id=NEW.object_id;
  SELECT * INTO STRICT op FROM dream.storage_verification_operations WHERE owner_id=NEW.owner_id AND id=NEW.operation_id;
  IF NEW.asset_id<>obj.reserved_asset_id OR obj.initial_closed OR obj.lifecycle IN ('cleanup_claimed','tombstoned') THEN
   RAISE EXCEPTION 'receipt target unavailable' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM dream.assets a WHERE a.owner_id=NEW.owner_id AND a.id=NEW.asset_id
    AND a.file_path=obj.object_key AND a.sha256=obj.sha256 AND a.mime=obj.mime AND a.kind=obj.kind AND a.size_bytes=obj.size_bytes
    AND a.width=NEW.width AND a.height=NEW.height AND a.duration_ms IS NOT DISTINCT FROM NEW.duration_ms) THEN
   RAISE EXCEPTION 'receipt asset/media tuple differs' USING ERRCODE='23514'; END IF;
  expected:=jsonb_build_object('id',NEW.id::text,'objectId',NEW.object_id::text,'identity',obj.identity_json::jsonb,
    'operationId',NEW.operation_id::text,'generation',NEW.generation,'fence',NEW.fence,'policyEpoch',NEW.policy_epoch,'policyDigest',NEW.policy_digest,
    'source',jsonb_build_object('bucket',NEW.source_bucket,'key',NEW.source_key,'providerVersion',NEW.source_version),
    'media',jsonb_build_object('width',NEW.width,'height',NEW.height,'durationMs',NEW.duration_ms),
    'verifiedAt',floor(extract(epoch FROM NEW.verified_at)*1000)::bigint,'notAfter',floor(extract(epoch FROM NEW.not_after)*1000)::bigint,
    'verifierId',NEW.verifier_id::text,'verifierVersion',NEW.verifier_version,'toolVersion',NEW.tool_version);
  IF NEW.receipt_json::jsonb IS DISTINCT FROM expected OR
    (obj.kind='image' AND NEW.duration_ms IS NOT NULL) OR (obj.kind='video' AND NEW.duration_ms IS NULL) THEN
   RAISE EXCEPTION 'raw receipt/columns differ' USING ERRCODE='23514'; END IF;
  IF op.kind='reverify' AND (obj.lifecycle<>'registered' OR NEW.source_bucket<>obj.bucket OR NEW.source_key<>obj.object_key OR NEW.source_version IS DISTINCT FROM obj.provider_version)
    OR (op.kind='initial' AND NOT EXISTS(SELECT 1 FROM dream.upload_intents i WHERE i.owner_id=NEW.owner_id AND i.id=op.intent_id
      AND i.incoming_bucket=NEW.source_bucket AND i.incoming_key=NEW.source_key)) THEN
   RAISE EXCEPTION 'verification source differs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- A deferred constraint validates the *committed* cleanup claim, not a runtime
-- executor or an external delete. It never grants publication/deletion authority.
CREATE FUNCTION dream.storage_cleanup_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,dream AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dream.storage_objects o WHERE o.owner_id=NEW.owner_id AND o.id=NEW.object_id
   AND o.cleanup_id=NEW.id AND o.barrier_fence=NEW.barrier_fence AND o.lifecycle IN ('cleanup_claimed','tombstoned')) THEN
  RAISE EXCEPTION 'cleanup claim must own closed object barrier' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER storage_cleanup_link AFTER INSERT ON dream.storage_cleanup_claims
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dream.storage_cleanup_link_guard();

-- Committed-row consistency checks, not a serialization/lease executor. Concurrent
-- writers STILL need the common policy/object/operation/state locking contract.
CREATE FUNCTION dream.storage_consistency_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,dream AS $$
DECLARE x jsonb:=to_jsonb(NEW); object_uuid uuid; tenant uuid:=(x->>'owner_id')::uuid;
 obj dream.storage_objects%ROWTYPE; st dream.asset_receipt_state%ROWTYPE;
 receipt_row dream.storage_verification_receipts%ROWTYPE; op dream.storage_verification_operations%ROWTYPE;
 count_points bigint; distinct_points bigint; minimum_point bigint; maximum_point bigint; current_point bigint; current_gen bigint; revocation_event jsonb;
 p jsonb; h jsonb; c jsonb; claim dream.storage_cleanup_claims%ROWTYPE; state_value bigint;
BEGIN
 object_uuid:=CASE WHEN TG_TABLE_NAME='storage_objects' THEN (x->>'id')::uuid ELSE (x->>'object_id')::uuid END;
 SELECT * INTO STRICT obj FROM dream.storage_objects WHERE owner_id=tenant AND id=object_uuid;
 SELECT coalesce((SELECT revision FROM dream.asset_receipt_state WHERE owner_id=tenant AND object_id=object_uuid),0) INTO state_value;
 IF obj.revision<state_value OR EXISTS(SELECT 1 FROM dream.storage_verification_operations o WHERE o.owner_id=tenant AND o.object_id=object_uuid
   AND (o.expected_state_revision>state_value OR o.completed_state_revision>state_value OR o.completed_state_revision<o.expected_state_revision
     OR o.completed_aggregate_revision>obj.revision OR o.completed_state_revision>o.completed_aggregate_revision)) THEN
  RAISE EXCEPTION 'completion/state/aggregate revision bounds differ' USING ERRCODE='23514'; END IF;
 IF obj.initial_closed AND EXISTS(SELECT 1 FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid AND status IN ('pending','running')) THEN
  RAISE EXCEPTION 'closed object retains live operation' USING ERRCODE='23514'; END IF;
 IF obj.publication_json IS NOT NULL THEN
  p:=obj.publication_json::jsonb; h:=p->'claim';
  SELECT * INTO STRICT op FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid AND id=(p->>'operationId')::uuid AND kind='initial';
  IF ((p->>'identityDigest'=obj.identity_digest AND (p->>'fence')::bigint=(h->>'fence')::bigint AND (p->>'fence')::bigint BETWEEN 1 AND op.fence
     AND (p->>'barrierFence')::bigint<=obj.barrier_fence AND (h->>'policyDigest')=op.policy_digest AND (h->>'policyEpoch')::bigint=op.policy_epoch
     AND (h->>'authorizationUntil')::bigint=floor(extract(epoch FROM op.authorization_until)*1000)::bigint
     AND (h->>'claimedAt')::bigint>=floor(extract(epoch FROM op.created_at)*1000)::bigint
     AND (h->>'claimedAt')::bigint<=(p->>'reservedAt')::bigint AND (p->>'reservedAt')::bigint<(h->>'leaseUntil')::bigint
     AND (h->>'leaseUntil')::bigint<=(h->>'authorizationUntil')::bigint AND h->'claimVerifiers' @> jsonb_build_array(h->>'workerId')) IS NOT TRUE) THEN
   RAISE EXCEPTION 'publication claim window/identity differs' USING ERRCODE='23514'; END IF;
  c:=CASE WHEN (p->>'fence')::bigint=op.fence THEN jsonb_build_object('workerId',op.worker_id::text,'claimedAt',floor(extract(epoch FROM op.claimed_at)*1000)::bigint,'leaseUntil',floor(extract(epoch FROM op.lease_until)*1000)::bigint,'claimVerifiers',to_jsonb(op.claim_verifiers))
    WHEN (p->>'fence')::bigint=(op.canceled_claim_json::jsonb->>'fence')::bigint THEN op.canceled_claim_json::jsonb ELSE NULL END;
  IF c IS NOT NULL AND ((h->>'workerId'=c->>'workerId' AND h->'claimedAt'=c->'claimedAt' AND (h->>'leaseUntil')::bigint<=(c->>'leaseUntil')::bigint AND h->'claimVerifiers'=c->'claimVerifiers') IS NOT TRUE) THEN
   RAISE EXCEPTION 'publication claimant differs from same-fence history' USING ERRCODE='23514'; END IF;
 END IF;
 IF obj.closure_json IS NOT NULL THEN
  c:=obj.closure_json::jsonb;
  IF ((c->>'revision')::numeric::bigint BETWEEN 1 AND obj.revision AND c->'authorizers' @> jsonb_build_array(c->>'principalId')) IS NOT TRUE THEN
   RAISE EXCEPTION 'closure authorization/revision differs' USING ERRCODE='23514'; END IF;
  IF c->>'reason'='cancel' THEN
   IF ((c->>'principalId'=tenant::text AND c->'authorizers'=jsonb_build_array(tenant::text) AND c->'operationId'='null'::jsonb) IS NOT TRUE) THEN
    RAISE EXCEPTION 'owner cancel authority/operation differs' USING ERRCODE='23514'; END IF;
  ELSIF c->>'reason'='cleanup' THEN
   IF ((c->'operationId'='null'::jsonb AND obj.cleanup_id IS NOT NULL) IS NOT TRUE) THEN
    RAISE EXCEPTION 'cleanup closure operation/claim differs' USING ERRCODE='23514'; END IF;
  ELSIF c->>'reason'<>'verification_failure' THEN RAISE EXCEPTION 'invalid closure cause' USING ERRCODE='23514'; END IF;
  SELECT * INTO op FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid AND kind='initial';
  IF c->>'reason'='verification_failure' AND (NOT FOUND OR (c->>'operationId'=op.id::text) IS NOT TRUE) THEN
   RAISE EXCEPTION 'failure closure must identify same-owner object initial operation' USING ERRCODE='23514'; END IF;
  IF FOUND AND (c->>'reason') IN ('cancel','verification_failure') AND
    (((c->>'at')::numeric::bigint=floor(extract(epoch FROM op.completed_at)*1000)::bigint AND (c->>'revision')::numeric::bigint=op.completed_aggregate_revision
      AND ((c->>'reason'='cancel' AND op.status='canceled') OR (c->>'reason'='verification_failure' AND op.status='failed' AND c->>'principalId'=op.worker_id::text AND c->'authorizers'=to_jsonb(op.claim_verifiers)))) IS NOT TRUE) THEN
   RAISE EXCEPTION 'first closure and initial completion differ' USING ERRCODE='23514'; END IF;
 END IF;
 IF obj.cleanup_id IS NOT NULL THEN
  SELECT * INTO STRICT claim FROM dream.storage_cleanup_claims WHERE owner_id=tenant AND id=obj.cleanup_id AND object_id=object_uuid;
  IF ((claim.claimed_aggregate_revision<=obj.revision AND
   ((obj.closure_json::jsonb->>'reason'='cleanup' AND (obj.closure_json::jsonb->>'revision')::numeric::bigint=claim.claimed_aggregate_revision
      AND (obj.closure_json::jsonb->>'at')::numeric::bigint=floor(extract(epoch FROM claim.claimed_at)*1000)::bigint)
    OR (obj.closure_json::jsonb->>'reason'<>'cleanup' AND (obj.closure_json::jsonb->>'revision')::numeric::bigint<claim.claimed_aggregate_revision))) IS NOT TRUE) THEN
   RAISE EXCEPTION 'first closure and GC claim revision differ' USING ERRCODE='23514'; END IF;
  IF (obj.lifecycle='tombstoned') IS DISTINCT FROM coalesce(claim.observation_json::jsonb->'absent'='true'::jsonb AND claim.observation_json::jsonb->'writerQuiescent'='true'::jsonb,false) THEN
   RAISE EXCEPTION 'cleanup completion observation differs' USING ERRCODE='23514'; END IF;
  IF claim.observation_json IS NOT NULL AND (((claim.observation_json::jsonb->>'at')::numeric::bigint>=floor(extract(epoch FROM claim.claimed_at)*1000)::bigint
    AND claim.observation_json::jsonb->>'identityDigest'=coalesce(obj.identity_digest,dream.storage_raw_hash('object-identity','null'))) IS NOT TRUE) THEN RAISE EXCEPTION 'cleanup observation target/time differs' USING ERRCODE='23514'; END IF;
 END IF;
 IF obj.active_generation<>(SELECT coalesce(max(generation),0) FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid) THEN
  RAISE EXCEPTION 'active generation differs from operation history' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM dream.storage_verification_operations a JOIN dream.storage_verification_operations b ON a.owner_id=b.owner_id AND a.object_id=b.object_id AND b.generation<a.generation
   WHERE a.owner_id=tenant AND a.object_id=object_uuid AND (b.completed_state_revision IS NULL OR b.completed_state_revision>a.expected_state_revision)) THEN
  RAISE EXCEPTION 'generation state history differs' USING ERRCODE='23514'; END IF;
 FOR receipt_row IN SELECT * FROM dream.storage_verification_receipts WHERE owner_id=tenant AND object_id=object_uuid LOOP
  SELECT * INTO STRICT op FROM dream.storage_verification_operations WHERE owner_id=tenant AND id=receipt_row.operation_id;
  IF op.status<>'succeeded' OR op.terminal_receipt_id<>receipt_row.id OR op.worker_id<>receipt_row.verifier_id OR op.completed_at<>receipt_row.verified_at
    OR NOT (receipt_row.verifier_id=ANY(op.claim_verifiers)) OR obj.lifecycle<>'registered' OR obj.initial_closed THEN
   RAISE EXCEPTION 'receipt issuer/time/committed operation differs' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM dream.storage_verification_operations o WHERE o.owner_id=tenant AND o.object_id=object_uuid AND o.kind='initial'
   AND o.status IN ('failed','canceled') AND NOT obj.initial_closed) THEN
  RAISE EXCEPTION 'terminal initial operation must close intent authority' USING ERRCODE='23514'; END IF;
 IF obj.lifecycle<>'registered' THEN
  IF EXISTS(SELECT 1 FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid AND (status='succeeded' OR kind='reverify')) THEN
   RAISE EXCEPTION 'unregistered object cannot have success or reverify' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO STRICT st FROM dream.asset_receipt_state WHERE owner_id=tenant AND object_id=object_uuid;
 IF NOT EXISTS(SELECT 1 FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid AND kind='initial' AND status='succeeded') THEN
  RAISE EXCEPTION 'registration requires initial success' USING ERRCODE='23514'; END IF;
 SELECT o.completed_state_revision,r.generation INTO STRICT current_point,current_gen
  FROM dream.storage_verification_receipts r JOIN dream.storage_verification_operations o ON o.owner_id=r.owner_id AND o.id=r.operation_id
  WHERE r.owner_id=tenant AND r.id=st.current_receipt_id;
 IF current_gen<>(SELECT max(generation) FROM dream.storage_verification_receipts WHERE owner_id=tenant AND object_id=object_uuid) THEN
  RAISE EXCEPTION 'current receipt is not latest success' USING ERRCODE='23514'; END IF;
 FOR revocation_event IN SELECT value FROM jsonb_array_elements(st.revocation_history_json::jsonb) LOOP
  IF ((jsonb_typeof(revocation_event)='object' AND jsonb_typeof(revocation_event->'revision')='number' AND jsonb_typeof(revocation_event->'at')='number'
    AND jsonb_typeof(revocation_event->'principalId')='string' AND jsonb_typeof(revocation_event->'authorizers')='array'
    AND (revocation_event->>'revision')::bigint BETWEEN 1 AND st.revision
    AND revocation_event->'authorizers' @> jsonb_build_array(revocation_event->>'principalId') AND (revocation_event->>'kind') IN ('manual','verification_failure')) IS NOT TRUE) THEN
   RAISE EXCEPTION 'invalid revocation history fields' USING ERRCODE='23514'; END IF;
  IF revocation_event->>'kind'='manual' THEN
   IF revocation_event->'operationId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'manual event must not claim operation' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM dream.storage_verification_operations o WHERE o.owner_id=tenant AND o.object_id=object_uuid AND o.id=(revocation_event->>'operationId')::uuid
     AND o.kind='reverify' AND o.status='failed' AND o.completed_state_revision=(revocation_event->>'revision')::bigint
     AND floor(extract(epoch FROM o.completed_at)*1000)::bigint=(revocation_event->>'at')::bigint AND o.worker_id=(revocation_event->>'principalId')::uuid AND to_jsonb(o.claim_verifiers)=revocation_event->'authorizers') THEN
    RAISE EXCEPTION 'failed event differs from same-owner operation' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF (st.status='ready') IS DISTINCT FROM (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(st.revocation_history_json::jsonb) e WHERE (e->>'revision')::bigint>current_point)) THEN
  RAISE EXCEPTION 'availability conflicts with revocation history' USING ERRCODE='23514'; END IF;
 WITH points AS (SELECT completed_state_revision AS value FROM dream.storage_verification_operations WHERE owner_id=tenant AND object_id=object_uuid AND status='succeeded'
   UNION ALL SELECT (e->>'revision')::bigint FROM jsonb_array_elements(st.revocation_history_json::jsonb) e)
 SELECT count(*),count(DISTINCT value),min(value),max(value) INTO count_points,distinct_points,minimum_point,maximum_point FROM points;
 IF count_points<>st.revision OR distinct_points<>count_points OR minimum_point<>1 OR maximum_point<>st.revision THEN
  RAISE EXCEPTION 'state revision history has holes/duplicates' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM dream.storage_verification_operations o WHERE o.owner_id=tenant AND o.object_id=object_uuid AND o.kind='reverify' AND o.status='failed'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(st.revocation_history_json::jsonb) e WHERE (e->>'operationId')::uuid=o.id AND e->>'kind'='verification_failure'
     AND (e->>'revision')::bigint=o.completed_state_revision AND (e->>'at')::bigint=floor(extract(epoch FROM o.completed_at)*1000)::bigint
     AND (e->>'principalId')::uuid=o.worker_id AND e->'authorizers'=to_jsonb(o.claim_verifiers))) THEN
  RAISE EXCEPTION 'failed reverify and immutable revocation differ' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['storage_policy_versions','storage_policies','storage_objects','upload_intents',
  'storage_verification_operations','storage_verification_runs','storage_verification_receipts','asset_receipt_state',
  'storage_cleanup_claims','storage_outbox','storage_capability_issues','creation_operations'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE dream.%I FROM PUBLIC,dream_api,dream_worker',t);
  EXECUTE format('ALTER TABLE dream.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE dream.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER storage_guard BEFORE INSERT OR UPDATE OR DELETE ON dream.%I FOR EACH ROW EXECUTE FUNCTION dream.storage_guard()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['storage_objects','storage_verification_operations','storage_verification_receipts','asset_receipt_state','storage_cleanup_claims'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER storage_consistency AFTER INSERT OR UPDATE ON dream.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dream.storage_consistency_guard()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['storage_objects','upload_intents','storage_verification_operations','storage_verification_runs',
  'storage_verification_receipts','asset_receipt_state','creation_operations'] LOOP
  EXECUTE format('GRANT SELECT ON TABLE dream.%I TO dream_api',t);
  EXECUTE format('CREATE POLICY storage_owner_read ON dream.%I FOR SELECT TO dream_api USING(owner_id=(SELECT dream.actor_id()))',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION dream.storage_raw_hash(text,text),dream.storage_uuid7(uuid),dream.storage_creation_fingerprint(text,text),dream.storage_guard(),dream.storage_cleanup_link_guard(),dream.storage_consistency_guard() FROM PUBLIC,dream_api,dream_worker;
-- No runtime parent/member grant, new LOGIN, SECURITY DEFINER, INSERT policy,
-- asset registrar policy, history ordinal4 or manifest update is created.
COMMIT;
