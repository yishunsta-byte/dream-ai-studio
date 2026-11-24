-- Owned T307 loopback provisioning only. This is not a product migration.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'dream_test_t281' OR current_user <> 't281_bootstrap'
    OR current_setting('server_version_num') <> '170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t281.synthetic', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T307_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;

CREATE ROLE t307_authority_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE SCHEMA rea_t307;
REVOKE ALL ON SCHEMA rea_t307 FROM PUBLIC;
GRANT USAGE ON SCHEMA dream, rea_t281, rea_t307 TO t307_authority_reader;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO t307_authority_reader;

CREATE TABLE rea_t307.restore_witness (
  singleton boolean PRIMARY KEY CHECK(singleton),
  store_id text NOT NULL CHECK(store_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  restore_generation text NOT NULL CHECK(restore_generation ~ '^[A-Za-z0-9_-]{1,128}$'),
  not_after timestamptz NOT NULL
);
CREATE TABLE rea_t307.asset_witness (
  owner_id uuid NOT NULL, asset_id uuid NOT NULL, object_id uuid NOT NULL, receipt_id uuid NOT NULL,
  identity_digest dream.sha256 NOT NULL, storage_generation bigint NOT NULL CHECK(storage_generation > 0),
  store_id text NOT NULL CHECK(store_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  restore_generation text NOT NULL CHECK(restore_generation ~ '^[A-Za-z0-9_-]{1,128}$'),
  source_generation text NOT NULL CHECK(source_generation ~ '^[A-Za-z0-9_-]{1,128}$'),
  not_after timestamptz NOT NULL, PRIMARY KEY(owner_id,asset_id),
  FOREIGN KEY(owner_id,receipt_id,object_id,asset_id)
    REFERENCES dream.storage_verification_receipts(owner_id,id,object_id,asset_id)
);
ALTER TABLE rea_t307.asset_witness ENABLE ROW LEVEL SECURITY;
ALTER TABLE rea_t307.asset_witness FORCE ROW LEVEL SECURITY;
GRANT SELECT ON rea_t307.restore_witness TO t307_authority_reader;
DO $$
DECLARE target regclass;
BEGIN
  FOREACH target IN ARRAY ARRAY['dream.projects','dream.assets','dream.project_assets','dream.asset_receipt_state',
    'dream.storage_objects','dream.storage_verification_receipts','rea_t281.owner_state','rea_t281.scope_state',
    'rea_t307.asset_witness']::regclass[] LOOP
    EXECUTE format('GRANT SELECT ON TABLE %s TO t307_authority_reader', target);
    EXECUTE format('CREATE POLICY t307_owner_read ON %s FOR SELECT TO t307_authority_reader
      USING (owner_id = (SELECT dream.actor_id()))', target);
  END LOOP;
END $$;

INSERT INTO rea_t307.restore_witness VALUES (true,'fixture-store','restore-1',now() + interval '1 hour');

-- Build actual SQL1–4 registered rows and verification lineage under all original constraints.
CREATE FUNCTION rea_t307.seed_registration(tenant uuid, asset uuid, expired boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,dream AS $$
DECLARE
  object_id uuid := ('20000000-0000-7000-8000-' || right(asset::text,12))::uuid;
  intent_id uuid := ('30000000-0000-7000-8000-' || right(asset::text,12))::uuid;
  op_id uuid := ('40000000-0000-7000-8000-' || right(asset::text,12))::uuid;
  run_id uuid := ('50000000-0000-7000-8000-' || right(asset::text,12))::uuid;
  receipt_id uuid := ('60000000-0000-7000-8000-' || right(asset::text,12))::uuid;
  worker uuid := '10000000-0000-4000-8000-000000000099';
  asset_row dream.assets%ROWTYPE;
  opened timestamptz := date_trunc('milliseconds', transaction_timestamp()) - interval '5 minutes';
  claimed timestamptz := opened + interval '10 seconds';
  verified timestamptz := claimed + interval '10 seconds';
  lease timestamptz := opened + interval '2 minutes';
  deadline timestamptz := opened + interval '3 minutes';
  expiry timestamptz := CASE WHEN expired THEN opened + interval '3 minutes' ELSE opened + interval '1 hour' END;
  incoming text := tenant::text || '/incoming/' || asset::text;
  identity text;
  identity_hash text;
  hash text := repeat('e',64);
  empty_hash text := encode(sha256(convert_to('{}','UTF8')),'hex');
  terminal text := jsonb_build_object('status','succeeded','receiptId',receipt_id::text)::text;
  claim jsonb;
  receipt text;
BEGIN
  SELECT * INTO STRICT asset_row FROM dream.assets WHERE owner_id=tenant AND id=asset;
  identity := jsonb_build_object('ownerId',tenant::text,'assetId',asset::text,'bucket','private-test',
    'key',asset_row.file_path,'providerVersion',NULL,'kind',asset_row.kind,'mime',asset_row.mime,
    'sha256',asset_row.sha256,'sizeBytes',asset_row.size_bytes)::text;
  identity_hash := dream.storage_raw_hash('object-identity',identity);
  claim := jsonb_build_object('workerId',worker::text,'fence',1,'policyEpoch',1,'policyDigest',hash,
    'claimedAt',floor(extract(epoch FROM claimed)*1000)::bigint,'leaseUntil',floor(extract(epoch FROM lease)*1000)::bigint,
    'authorizationUntil',floor(extract(epoch FROM deadline)*1000)::bigint,'claimVerifiers',jsonb_build_array(worker::text));
  receipt := jsonb_build_object('id',receipt_id::text,'objectId',object_id::text,'identity',identity::jsonb,
    'operationId',op_id::text,'generation',1,'fence',1,'policyEpoch',1,'policyDigest',hash,
    'source',jsonb_build_object('bucket','incoming','key',incoming,'providerVersion',NULL),
    'media',jsonb_build_object('width',asset_row.width,'height',asset_row.height,'durationMs',asset_row.duration_ms),
    'verifiedAt',floor(extract(epoch FROM verified)*1000)::bigint,'notAfter',floor(extract(epoch FROM expiry)*1000)::bigint,
    'verifierId',worker::text,'verifierVersion','fixture','toolVersion','fixture')::text;

  INSERT INTO dream.storage_policy_versions VALUES('fixture',1,hash,opened) ON CONFLICT DO NOTHING;
  INSERT INTO dream.storage_objects(owner_id,id,reserved_asset_id,lifecycle,revision,barrier_fence,active_generation,created_at)
    VALUES(tenant,object_id,asset,'reserved',0,0,0,opened);
  INSERT INTO dream.upload_intents(owner_id,id,object_id,request_id,request_fingerprint,request_json,request_raw_sha,
    incoming_bucket,incoming_key,max_bytes,authorization_until,issue_envelope_until,max_issues,issue_count,status,revision,created_at)
    VALUES(tenant,intent_id,object_id,intent_id,hash,'{}',empty_hash,'incoming',incoming,8,deadline,lease,1,0,'open',0,opened);
  INSERT INTO dream.storage_verification_operations(owner_id,id,object_id,intent_id,kind,generation,
    request_fingerprint,request_json,request_raw_sha,policy_id,policy_epoch,policy_digest,authorization_until,
    expected_state_revision,fence,status,revision,created_at)
    VALUES(tenant,op_id,object_id,intent_id,'initial',1,hash,'{}',empty_hash,'fixture',1,hash,deadline,0,0,'pending',0,opened);
  UPDATE dream.storage_verification_operations SET status='running',revision=1,fence=1,worker_id=worker,
    lease_until=lease,claimed_at=claimed,claim_verifiers=ARRAY[worker] WHERE id=op_id;
  UPDATE dream.storage_objects SET lifecycle='publication_reserved',revision=1,active_generation=1,
    bucket='private-test',object_key=asset_row.file_path,kind=asset_row.kind,mime=asset_row.mime,
    sha256=asset_row.sha256,size_bytes=asset_row.size_bytes,identity_json=identity,identity_digest=identity_hash,
    publication_json=jsonb_build_object('operationId',op_id::text,'identityDigest',identity_hash,'fence',1,
      'barrierFence',0,'reservedAt',floor(extract(epoch FROM claimed)*1000)::bigint,'claim',claim)::text
    WHERE id=object_id;
  UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=asset,revision=2 WHERE id=object_id;
  INSERT INTO dream.storage_verification_runs VALUES(tenant,run_id,object_id,op_id,1,1,worker,'succeeded','{}',empty_hash,verified);
  INSERT INTO dream.storage_verification_receipts(owner_id,id,object_id,asset_id,operation_id,run_id,generation,fence,
    identity_digest,policy_id,policy_epoch,policy_digest,source_bucket,source_key,width,height,duration_ms,verifier_id,
    verifier_version,tool_version,verified_at,not_after,receipt_json,receipt_digest)
    VALUES(tenant,receipt_id,object_id,asset,op_id,run_id,1,1,identity_hash,'fixture',1,hash,'incoming',incoming,
      asset_row.width,asset_row.height,asset_row.duration_ms,worker,'fixture','fixture',verified,expiry,receipt,
      dream.storage_raw_hash('verification-receipt',receipt));
  UPDATE dream.storage_verification_operations SET status='succeeded',revision=2,completed_at=verified,
    completed_state_revision=1,completed_aggregate_revision=2,terminal_receipt_id=receipt_id,terminal_json=terminal,
    terminal_digest=dream.storage_raw_hash('verification-terminal',terminal) WHERE id=op_id;
  UPDATE dream.upload_intents SET status='succeeded',revision=1 WHERE id=intent_id;
  INSERT INTO dream.asset_receipt_state(owner_id,asset_id,object_id,current_receipt_id,status,revision,updated_at)
    VALUES(tenant,asset,object_id,receipt_id,'ready',1,verified);
  INSERT INTO rea_t307.asset_witness VALUES(tenant,asset,object_id,receipt_id,identity_hash,1,
    'fixture-store','restore-1','source-' || right(asset::text,12),now() + interval '1 hour');
END $$;
REVOKE ALL ON FUNCTION rea_t307.seed_registration(uuid,uuid,boolean) FROM PUBLIC;
COMMIT;
