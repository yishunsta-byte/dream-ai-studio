-- Schema5 local source publication: B37. Isolated v3 source validation only.
-- No runner, descriptor, target authorization or runtime activation is supplied.
-- Execution requires a separately approved schema5 migration action.
BEGIN;


-- All settings below are trusted migration inputs, never application/request data.
-- Pin actual native OIDs, not marker strings such as '$owner' or role display names.
DO $preflight$
DECLARE m oid; root_oid oid;
BEGIN
 SELECT oid INTO STRICT m FROM pg_catalog.pg_roles WHERE rolname=current_user
   AND rolcreaterole AND NOT rolsuper AND NOT rolbypassrls;
 IF current_setting('dream.b27_migration_owner_oid',true) IS DISTINCT FROM m::text
   OR current_setting('server_version_num')::integer/10000 <> 18
   OR current_setting('dream.b27_expected_pg_major',true) IS DISTINCT FROM '18'
   OR current_setting('createrole_self_grant',true) IS DISTINCT FROM ''
   OR current_setting('standard_conforming_strings')<>'on'
   OR current_setting('server_encoding')<>'UTF8' THEN
  RAISE EXCEPTION 'B27_PREFLIGHT_UNVERIFIED';
 END IF;
 root_oid:=nullif(current_setting('dream.b27_bootstrap_oid',true),'')::oid;
 IF root_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=root_oid AND rolsuper)
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='dream' AND nspowner=m)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='dream_upload_reserver')
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='dream_reservation')
   OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('dream_api','dream_worker')
     AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
     AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit) <> 2 THEN
  RAISE EXCEPTION 'B27_PRINCIPAL_TOPOLOGY_UNVERIFIED';
 END IF;
END $preflight$;

CREATE ROLE dream_upload_reserver NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT
 NOCREATEDB NOCREATEROLE NOREPLICATION;
DO $automatic_edge$
DECLARE r oid:='dream_upload_reserver'::regrole; m oid:=current_user::regrole;
 root_oid oid:=current_setting('dream.b27_bootstrap_oid')::oid;
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=r OR member=r) <> 1
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=r AND member=m
     AND grantor=root_oid AND admin_option AND NOT inherit_option AND NOT set_option) THEN
  RAISE EXCEPTION 'B27_AUTOMATIC_ADMIN_EDGE_MISMATCH';
 END IF;
END $automatic_edge$;
CREATE SCHEMA dream_reservation;
REVOKE ALL ON SCHEMA dream_reservation FROM PUBLIC,dream_api,dream_worker;
GRANT USAGE ON SCHEMA dream_reservation TO dream_api,dream_upload_reserver;
GRANT USAGE ON SCHEMA dream TO dream_upload_reserver;
GRANT USAGE ON DOMAIN dream.safe_uint,dream.safe_positive,dream.sha256 TO dream_upload_reserver;
GRANT EXECUTE ON FUNCTION dream.actor_id(),dream.valid_object_key(text,uuid),
 dream.storage_uuid7(uuid),dream.storage_raw_hash(text,text) TO dream_upload_reserver;

-- INVOKER helper. ASCII-only wire subset makes SQL/JS escaping parity explicit.
-- Numeric lexemes remain json (not jsonb) until unsigned safe-integer validation.
CREATE FUNCTION dream_reservation.canonical_json_v1(v json, depth integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE t text:=json_typeof(v); result text; s text; item record;
BEGIN
 IF depth>16 THEN RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023'; END IF;
 IF t='object' THEN
  result:='';
  FOR item IN SELECT key,value FROM json_each(v) ORDER BY key COLLATE "C" LOOP
   IF item.key COLLATE "C" ~ '[^ -~]' THEN RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023'; END IF;
   result:=result || CASE WHEN result='' THEN '' ELSE ',' END || to_json(item.key)::text || ':' ||
     dream_reservation.canonical_json_v1(item.value,depth+1);
  END LOOP;
  RETURN '{'||result||'}';
 ELSIF t='array' THEN
  SELECT '['||coalesce(string_agg(dream_reservation.canonical_json_v1(value,depth+1),',' ORDER BY ord),'')||']'
    INTO result FROM json_array_elements(v) WITH ORDINALITY AS a(value,ord);
  RETURN result;
 ELSIF t='number' THEN
  s:=v::text;
  IF s !~ '^(0|[1-9][0-9]{0,15})$' OR s::numeric>9007199254740991 THEN
   RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023';
  END IF;
  RETURN s;
 ELSIF t='string' THEN
  s:=v#>>'{}';
  IF s COLLATE "C" ~ '[^ -~]' THEN RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023'; END IF;
  RETURN to_json(s)::text;
 ELSIF t IN ('boolean','null') THEN RETURN v::text;
 END IF;
 RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023';
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.canonical_json_v1(json,integer) FROM PUBLIC,dream_api,dream_worker;

CREATE FUNCTION dream_reservation.parse_wire_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF octet_length(raw)>65536 OR NOT (raw IS JSON OBJECT WITH UNIQUE KEYS) THEN
  RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023';
 END IF;
 PERFORM dream_reservation.canonical_json_v1(raw::json,0);
 RETURN raw::jsonb;
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.parse_wire_v1(text) FROM PUBLIC,dream_api,dream_worker;

-- Exact sorted-key canonical client v1. No whitespace/escapes/unknown keys.
-- Six existing MIME strings only; hints are neither rights nor media attestation.
CREATE FUNCTION dream_reservation.client_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE d jsonb; expected text;
BEGIN
 IF octet_length(raw)>160 OR raw !~
  '^\{"claimedMime":"(image/png|image/jpeg|image/webp|video/mp4|video/quicktime|video/webm)","clientVersion":1,"requestedMaxBytes":[1-9][0-9]{0,9}\}$' THEN
  RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023';
 END IF;
 d:=raw::jsonb;
 IF (d->>'requestedMaxBytes')::bigint>2147483648 THEN
  RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023';
 END IF;
 expected:='{"claimedMime":"'||(d->>'claimedMime')||'","clientVersion":1,"requestedMaxBytes":'||(d->>'requestedMaxBytes')||'}';
 IF raw<>expected THEN RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023'; END IF;
 RETURN d;
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.client_v1(text) FROM PUBLIC,dream_api,dream_worker;

-- Policy v1 canonical body: no defaults or seeded operational values.
CREATE FUNCTION dream_reservation.policy_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE d jsonb; field text; a jsonb; n numeric;
BEGIN
 d:=dream_reservation.parse_wire_v1(raw);
 IF raw<>dream_reservation.canonical_json_v1(raw::json,0)
   OR NOT (d ?& ARRAY['bodyVersion','collectors','incomingBucket','intentTtlMs','issueEnvelopeMs',
     'keyRule','maxBytes','maxIssues','maxPreparationAgeMs','policyManagers','providerMaxBytes','verifiers'])
   OR d-ARRAY['bodyVersion','collectors','incomingBucket','intentTtlMs','issueEnvelopeMs',
     'keyRule','maxBytes','maxIssues','maxPreparationAgeMs','policyManagers','providerMaxBytes','verifiers']<>'{}'::jsonb
   OR d->'bodyVersion'<>'1'::jsonb OR d->'keyRule'<>'"owner/incoming/object/intent:v1"'::jsonb
   OR jsonb_typeof(d->'incomingBucket')<>'string' OR d->>'incomingBucket' !~ '^[a-z][a-z0-9-]{0,62}$' THEN
  RAISE EXCEPTION 'B27_POLICY' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['maxBytes','providerMaxBytes','intentTtlMs','issueEnvelopeMs','maxIssues','maxPreparationAgeMs'] LOOP
  IF jsonb_typeof(d->field)<>'number' THEN RAISE EXCEPTION 'B27_POLICY' USING ERRCODE='22023'; END IF;
  n:=(d->>field)::numeric;
  IF n<1 OR n>9007199254740991 THEN RAISE EXCEPTION 'B27_POLICY' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (d->>'maxBytes')::bigint>2147483648 OR (d->>'providerMaxBytes')::bigint>2147483648
   OR (d->>'maxIssues')::bigint>1000 OR (d->>'issueEnvelopeMs')::bigint>(d->>'intentTtlMs')::bigint THEN
  RAISE EXCEPTION 'B27_POLICY' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['verifiers','collectors','policyManagers'] LOOP
  a:=d->field;
  IF jsonb_typeof(a)<>'array' THEN RAISE EXCEPTION 'B27_POLICY' USING ERRCODE='22023'; END IF;
  -- Exact installed Zod 4.6.7 z.uuid() + shared lowercase refinement,
  -- with B25 request()'s additional exact 36-character authority-ID bound.
  -- RFC versions 1..8 / variant 8,9,a,b OR the special nil/max UUIDs.
  IF jsonb_array_length(a) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(a) e
    WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}')<>36 OR (e#>>'{}') COLLATE "C" !~
      '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') THEN
   RAISE EXCEPTION 'B27_POLICY' USING ERRCODE='22023';
  END IF;
 END LOOP;
 RETURN d;
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.policy_v1(text) FROM PUBLIC,dream_api,dream_worker;

CREATE FUNCTION dream_reservation.epoch_ms_v1(ms bigint) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF ms NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'B27_INPUT' USING ERRCODE='22023'; END IF;
 RETURN (TIMESTAMP '1970-01-01 00:00:00'+make_interval(days=>(ms/86400000)::integer)
   +(ms%86400000)*INTERVAL '1 millisecond') AT TIME ZONE 'UTC';
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.epoch_ms_v1(bigint) FROM PUBLIC,dream_api,dream_worker;

CREATE TABLE dream_reservation.upload_policy_versions (
 policy_id text NOT NULL CHECK(policy_id='asset-upload'), epoch dream.safe_uint NOT NULL,
 digest dream.sha256 NOT NULL, body_json text NOT NULL, body_digest dream.sha256 NOT NULL,
 PRIMARY KEY(policy_id,epoch,digest),
 FOREIGN KEY(policy_id,epoch,digest) REFERENCES dream.storage_policy_versions(policy_id,epoch,digest) ON DELETE RESTRICT,
 CHECK(dream_reservation.policy_v1(body_json) IS NOT NULL),
 CHECK(body_digest=dream.storage_raw_hash('upload-policy-body',body_json))
);
ALTER TABLE dream.upload_intents ADD CONSTRAINT upload_intents_reservation_binding
 UNIQUE(owner_id,request_id,id,object_id);
CREATE TABLE dream_reservation.upload_requests (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL CHECK(dream.storage_uuid7(request_id)),
 client_version integer NOT NULL CHECK(client_version=1), client_json text NOT NULL,
 client_digest dream.sha256 NOT NULL, policy_id text NOT NULL CHECK(policy_id='asset-upload'),
 policy_epoch dream.safe_uint NOT NULL, policy_digest dream.sha256 NOT NULL,
 intent_id uuid NOT NULL CHECK(dream.storage_uuid7(intent_id)), object_id uuid NOT NULL CHECK(dream.storage_uuid7(object_id)),
 reservation_fingerprint dream.sha256 NOT NULL, reservation_raw_sha dream.sha256 NOT NULL,
 result_json text NOT NULL, result_digest dream.sha256 NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,request_id,intent_id,object_id)
  REFERENCES dream.upload_intents(owner_id,request_id,id,object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(policy_id,policy_epoch,policy_digest)
  REFERENCES dream_reservation.upload_policy_versions(policy_id,epoch,digest) ON DELETE RESTRICT,
 CHECK(dream_reservation.client_v1(client_json) IS NOT NULL),
 CHECK(client_digest=dream.storage_raw_hash('upload-reservation-client',client_json)),
 CHECK(result_json=dream_reservation.canonical_json_v1(result_json::json,0)),
 CHECK(result_digest=dream.storage_raw_hash('upload-reservation-result',result_json))
);
CREATE FUNCTION dream_reservation.immutable_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'B27_IMMUTABLE' USING ERRCODE='23514'; END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.immutable_guard_v1() FROM PUBLIC,dream_api,dream_worker;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON dream_reservation.upload_policy_versions
 FOR EACH ROW EXECUTE FUNCTION dream_reservation.immutable_guard_v1();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON dream_reservation.upload_requests
 FOR EACH ROW EXECUTE FUNCTION dream_reservation.immutable_guard_v1();
REVOKE ALL ON TABLE dream_reservation.upload_policy_versions,dream_reservation.upload_requests FROM PUBLIC,dream_api,dream_worker;
ALTER TABLE dream_reservation.upload_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_reservation.upload_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE dream_reservation.upload_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_reservation.upload_requests FORCE ROW LEVEL SECURITY;

GRANT SELECT ON dream.storage_policies,dream.storage_policy_versions,dream.storage_objects,dream.upload_intents,
 dream.storage_verification_operations,dream.storage_verification_receipts,dream.asset_receipt_state,
 dream_reservation.upload_policy_versions,dream_reservation.upload_requests TO dream_upload_reserver;
GRANT INSERT ON dream.storage_objects,dream.upload_intents,dream_reservation.upload_requests TO dream_upload_reserver;
GRANT UPDATE(policy_id) ON dream.storage_policies TO dream_upload_reserver;
GRANT UPDATE(id) ON dream.storage_objects TO dream_upload_reserver;
CREATE POLICY upload_reservation_read ON dream.storage_policies FOR SELECT TO dream_upload_reserver USING(policy_id='asset-upload');
CREATE POLICY upload_reservation_lock ON dream.storage_policies FOR UPDATE TO dream_upload_reserver USING(policy_id='asset-upload') WITH CHECK(false);
CREATE POLICY upload_reservation_read ON dream.storage_policy_versions FOR SELECT TO dream_upload_reserver USING(policy_id='asset-upload');
CREATE POLICY upload_reservation_read ON dream_reservation.upload_policy_versions FOR SELECT TO dream_upload_reserver USING(policy_id='asset-upload');
CREATE POLICY upload_reservation_read ON dream.storage_objects FOR SELECT TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_lock ON dream.storage_objects FOR UPDATE TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id())) WITH CHECK(false);
CREATE POLICY upload_reservation_insert ON dream.storage_objects FOR INSERT TO dream_upload_reserver WITH CHECK(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_read ON dream.upload_intents FOR SELECT TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_insert ON dream.upload_intents FOR INSERT TO dream_upload_reserver WITH CHECK(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_read ON dream.storage_verification_operations FOR SELECT TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_read ON dream.storage_verification_receipts FOR SELECT TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_read ON dream.asset_receipt_state FOR SELECT TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_read ON dream_reservation.upload_requests FOR SELECT TO dream_upload_reserver USING(owner_id=(SELECT dream.actor_id()));
CREATE POLICY upload_reservation_insert ON dream_reservation.upload_requests FOR INSERT TO dream_upload_reserver WITH CHECK(owner_id=(SELECT dream.actor_id()));

-- INVOKER, called only inside bounded definer entries. No API EXECUTE.
-- Existing immutable history is read independently of today's admission policy.
CREATE FUNCTION dream_reservation.replay_v1(actor uuid, rid uuid, client_raw text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $fn$
DECLARE h dream_reservation.upload_requests%ROWTYPE; i dream.upload_intents%ROWTYPE;
 o dream.storage_objects%ROWTYPE; d jsonb; r jsonb; expected jsonb;
BEGIN
 SELECT * INTO h FROM dream_reservation.upload_requests WHERE owner_id=actor AND request_id=rid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF h.client_json<>client_raw OR h.client_digest<>dream.storage_raw_hash('upload-reservation-client',client_raw) THEN
  RETURN jsonb_build_object('tag','CONFLICT');
 END IF;
 SELECT * INTO o FROM dream.storage_objects WHERE owner_id=actor AND id=h.object_id FOR UPDATE;
 IF NOT FOUND OR o.owner_id IS DISTINCT FROM actor OR o.id IS DISTINCT FROM h.object_id THEN
  RAISE EXCEPTION 'B27_REQUIRED_OBJECT_LOCK';
 END IF;
 SELECT * INTO STRICT i FROM dream.upload_intents WHERE owner_id=actor AND request_id=rid
  AND id=h.intent_id AND object_id=h.object_id;
 d:=dream_reservation.parse_wire_v1(i.request_json); r:=d->'reservation';
 expected:=jsonb_build_object('requestId',rid::text,'objectId',h.object_id::text,'assetId',o.reserved_asset_id::text,
  'intentId',h.intent_id::text,'reservedAt',(d->>'reservedAt')::bigint,
  'authorizationUntil',(r->>'intentExpiresAt')::bigint,'issueEnvelopeUntil',(r->>'issueEnvelopeUntil')::bigint,
  'maxBytes',i.max_bytes,'policyEpoch',h.policy_epoch,'policyDigest',h.policy_digest::text);
 IF (h.reservation_fingerprint=i.request_fingerprint AND h.reservation_raw_sha=i.request_raw_sha
   AND i.request_raw_sha=encode(sha256(convert_to(i.request_json,'UTF8')),'hex')
   AND i.request_fingerprint=dream.storage_raw_hash('upload-reservation-request',dream_reservation.canonical_json_v1(i.request_json::json,0))
   AND d->'requestId'=to_jsonb(rid::text) AND d->'maxBytes'=to_jsonb(i.max_bytes::bigint)
   AND r->'ownerId'=to_jsonb(actor::text) AND r->'objectId'=to_jsonb(o.id::text)
   AND r->'assetId'=to_jsonb(o.reserved_asset_id::text) AND r->'intentId'=to_jsonb(i.id::text)
   AND r->'policyEpoch'=to_jsonb(h.policy_epoch::bigint) AND r->'policyDigest'=to_jsonb(h.policy_digest::text)
   AND r->'incoming'->>'bucket'=i.incoming_bucket AND r->'incoming'->>'key'=i.incoming_key
   AND r->'maxIssues'=to_jsonb(i.max_issues::bigint)
   AND dream_reservation.epoch_ms_v1((d->>'reservedAt')::bigint)=o.created_at AND i.created_at=o.created_at AND h.created_at=o.created_at
   AND dream_reservation.epoch_ms_v1((r->>'intentExpiresAt')::bigint)=i.authorization_until
   AND dream_reservation.epoch_ms_v1((r->>'issueEnvelopeUntil')::bigint)=i.issue_envelope_until
   AND h.result_json::jsonb=expected AND h.result_digest=dream.storage_raw_hash('upload-reservation-result',h.result_json)) IS NOT TRUE THEN
  RAISE EXCEPTION 'B27_HISTORY_BINDING';
 END IF;
 RETURN jsonb_build_object('tag','replay','reservation',expected,'originalEnvelope',i.request_json,
  'current',jsonb_build_object('lifecycle',o.lifecycle,'revision',o.revision,'intentStatus',i.status,
    'intentRevision',i.revision,'initialClosed',o.initial_closed),'issuanceAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.replay_v1(uuid,uuid,text) FROM PUBLIC,dream_api,dream_worker;

CREATE FUNCTION dream_reservation.read_upload_seed_v1(rid uuid, client_raw text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $fn$
DECLARE actor uuid; p dream.storage_policies%ROWTYPE; body text; policy jsonb; replay jsonb; now_ms bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN jsonb_build_object('tag','ISOLATION'); END IF;
 actor:=dream.actor_id();
 IF actor IS NULL THEN RETURN jsonb_build_object('tag','ACTOR_REQUIRED'); END IF;
 IF rid IS NULL OR NOT dream.storage_uuid7(rid) OR client_raw IS NULL THEN RETURN jsonb_build_object('tag','INPUT'); END IF;
 PERFORM dream_reservation.client_v1(client_raw);
 SELECT * INTO p FROM dream.storage_policies WHERE policy_id='asset-upload' FOR SHARE;
 IF NOT FOUND OR p.policy_id IS DISTINCT FROM 'asset-upload' OR p.epoch IS NULL OR p.digest IS NULL THEN
  RETURN jsonb_build_object('tag','POLICY_LOCK');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM dream.storage_policy_versions WHERE policy_id=p.policy_id AND epoch=p.epoch AND digest=p.digest) THEN
  RETURN jsonb_build_object('tag','POLICY_LOCK');
 END IF;
 replay:=dream_reservation.replay_v1(actor,rid,client_raw);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT body_json INTO STRICT body FROM dream_reservation.upload_policy_versions
  WHERE policy_id=p.policy_id AND epoch=p.epoch AND digest=p.digest;
 policy:=dream_reservation.policy_v1(body);
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF now_ms NOT BETWEEN 0 AND 9007199254740991 THEN RETURN jsonb_build_object('tag','POLICY'); END IF;
 RETURN jsonb_build_object('tag','seed','ownerId',actor::text,'requestId',rid::text,
  'policyId',p.policy_id,'policyEpoch',p.epoch,'policyDigest',p.digest::text,'policy',policy,'now',now_ms,
  'issuanceAuthorized',false);
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('tag','INPUT');
 WHEN OTHERS THEN RETURN jsonb_build_object('tag','UNAVAILABLE');
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.read_upload_seed_v1(uuid,text) FROM PUBLIC,dream_api,dream_worker;

CREATE FUNCTION dream_reservation.reserve_upload_v1(rid uuid, client_raw text, envelope_raw text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $fn$
DECLARE actor uuid; p dream.storage_policies%ROWTYPE; body text; policy jsonb; client jsonb; d jsonb; r jsonb;
 replay jsonb; expected jsonb; result jsonb; result_raw text; fingerprint text; raw_sha text;
 object_uuid uuid; asset_uuid uuid; intent_uuid uuid; reserved_ms bigint; until_ms bigint; envelope_ms bigint;
 now_ms bigint; max_bytes bigint; incoming_key text; claimed integer;
BEGIN
 -- This EXCEPTION-bearing block is an atomic subtransaction. Any thrown failure
 -- after the latch undoes all three writes even if caller commits the error tag.
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN jsonb_build_object('tag','ISOLATION'); END IF;
 actor:=dream.actor_id();
 IF actor IS NULL THEN RETURN jsonb_build_object('tag','ACTOR_REQUIRED'); END IF;
 IF rid IS NULL OR NOT dream.storage_uuid7(rid) OR client_raw IS NULL THEN RETURN jsonb_build_object('tag','INPUT'); END IF;
 client:=dream_reservation.client_v1(client_raw);
 SELECT * INTO p FROM dream.storage_policies WHERE policy_id='asset-upload' FOR SHARE;
 IF NOT FOUND OR p.policy_id IS DISTINCT FROM 'asset-upload' OR p.epoch IS NULL OR p.digest IS NULL THEN
  RETURN jsonb_build_object('tag','POLICY_LOCK');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM dream.storage_policy_versions WHERE policy_id=p.policy_id AND epoch=p.epoch AND digest=p.digest) THEN
  RETURN jsonb_build_object('tag','POLICY_LOCK');
 END IF;
 replay:=dream_reservation.replay_v1(actor,rid,client_raw);
 IF replay IS NOT NULL THEN RETURN replay; END IF; -- before proposed envelope/live body/expiry
 SELECT body_json INTO STRICT body FROM dream_reservation.upload_policy_versions
  WHERE policy_id=p.policy_id AND epoch=p.epoch AND digest=p.digest;
 policy:=dream_reservation.policy_v1(body);
 IF envelope_raw IS NULL THEN RETURN jsonb_build_object('tag','INPUT'); END IF;
 d:=dream_reservation.parse_wire_v1(envelope_raw); r:=d->'reservation';
 object_uuid:=(r->>'objectId')::uuid; asset_uuid:=(r->>'assetId')::uuid; intent_uuid:=(r->>'intentId')::uuid;
 IF object_uuid IS NULL OR asset_uuid IS NULL OR intent_uuid IS NULL OR NOT dream.storage_uuid7(object_uuid)
   OR NOT dream.storage_uuid7(asset_uuid) OR NOT dream.storage_uuid7(intent_uuid) THEN
  RETURN jsonb_build_object('tag','INPUT');
 END IF;
 reserved_ms:=(d->>'reservedAt')::bigint;
 until_ms:=reserved_ms+(policy->>'intentTtlMs')::bigint;
 envelope_ms:=reserved_ms+(policy->>'issueEnvelopeMs')::bigint;
 IF reserved_ms IS NULL OR reserved_ms<0 OR until_ms>9007199254740991 OR envelope_ms>9007199254740991 THEN
  RETURN jsonb_build_object('tag','INPUT');
 END IF;
 max_bytes:=least((client->>'requestedMaxBytes')::bigint,(policy->>'maxBytes')::bigint,(policy->>'providerMaxBytes')::bigint);
 incoming_key:=actor::text||'/incoming/'||object_uuid::text||'/'||intent_uuid::text;
 expected:=jsonb_build_object('codecVersion',1,'requestId',rid::text,'maxBytes',max_bytes,'reservedAt',reserved_ms,
  'reservation',jsonb_build_object('ownerId',actor::text,'objectId',object_uuid::text,'assetId',asset_uuid::text,
   'intentId',intent_uuid::text,'intentExpiresAt',until_ms,'issueEnvelopeUntil',envelope_ms,
   'maxIssues',(policy->>'maxIssues')::bigint,'verifiers',policy->'verifiers','collectors',policy->'collectors',
   'policyManagers',policy->'policyManagers','policyEpoch',p.epoch,'policyDigest',p.digest::text,
   'incoming',jsonb_build_object('bucket',policy->>'incomingBucket','key',incoming_key,'providerVersion',NULL)));
 IF d IS DISTINCT FROM expected THEN RETURN jsonb_build_object('tag','INPUT'); END IF;
 fingerprint:=dream.storage_raw_hash('upload-reservation-request',dream_reservation.canonical_json_v1(envelope_raw::json,0));
 raw_sha:=encode(sha256(convert_to(envelope_raw,'UTF8')),'hex');
 result:=jsonb_build_object('requestId',rid::text,'objectId',object_uuid::text,'assetId',asset_uuid::text,
  'intentId',intent_uuid::text,'reservedAt',reserved_ms,'authorizationUntil',until_ms,'issueEnvelopeUntil',envelope_ms,
  'maxBytes',max_bytes,'policyEpoch',p.epoch,'policyDigest',p.digest::text);
 result_raw:=dream_reservation.canonical_json_v1(result::json,0);
 INSERT INTO dream_reservation.upload_requests(owner_id,request_id,client_version,client_json,client_digest,
  policy_id,policy_epoch,policy_digest,intent_id,object_id,reservation_fingerprint,reservation_raw_sha,
  result_json,result_digest,created_at)
 VALUES(actor,rid,1,client_raw,dream.storage_raw_hash('upload-reservation-client',client_raw),p.policy_id,p.epoch,p.digest,
  intent_uuid,object_uuid,fingerprint,raw_sha,result_raw,dream.storage_raw_hash('upload-reservation-result',result_raw),
  dream_reservation.epoch_ms_v1(reserved_ms))
 ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING 1 INTO claimed;
 IF NOT FOUND THEN
  -- New VOLATILE/READ COMMITTED statement snapshot after the unique-index wait.
  replay:=dream_reservation.replay_v1(actor,rid,client_raw);
  IF replay IS NULL THEN RAISE EXCEPTION 'B27_LATCH_UNRESOLVED'; END IF;
  RETURN replay;
 END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF reserved_ms>now_ms OR now_ms-reserved_ms>(policy->>'maxPreparationAgeMs')::bigint
   OR now_ms>=envelope_ms OR now_ms>=until_ms THEN
  RAISE EXCEPTION 'B27_STALE_SEED' USING ERRCODE='P0002';
 END IF;
 -- Fresh path: no expected existing object. Unique INSERT failure is not replay.
 INSERT INTO dream.storage_objects(owner_id,id,reserved_asset_id,registered_asset_id,lifecycle,revision,
  barrier_fence,initial_closed,closure_json,publication_json,active_generation,cleanup_id,bucket,object_key,
  provider_version,kind,mime,sha256,size_bytes,identity_json,identity_digest,created_at)
 VALUES(actor,object_uuid,asset_uuid,NULL,'reserved',0,0,false,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
  dream_reservation.epoch_ms_v1(reserved_ms));
 INSERT INTO dream.upload_intents(owner_id,id,object_id,request_id,request_fingerprint,request_json,request_raw_sha,
  incoming_bucket,incoming_key,max_bytes,authorization_until,issue_envelope_until,max_issues,issue_count,status,revision,created_at)
 VALUES(actor,intent_uuid,object_uuid,rid,fingerprint,envelope_raw,raw_sha,policy->>'incomingBucket',incoming_key,max_bytes,
  dream_reservation.epoch_ms_v1(until_ms),dream_reservation.epoch_ms_v1(envelope_ms),(policy->>'maxIssues')::bigint,
  0,'open',0,dream_reservation.epoch_ms_v1(reserved_ms));
 -- Validate original immutable bindings; no B25 pristine decoder on evolved rows.
 replay:=dream_reservation.replay_v1(actor,rid,client_raw);
 IF replay IS NULL OR replay->>'tag'<>'replay' THEN RAISE EXCEPTION 'B27_NEW_BINDING'; END IF;
 -- This statement cannot confirm the enclosing COMMIT or deferred constraints.
 RETURN jsonb_set(replay,'{tag}','"staged"'::jsonb)||jsonb_build_object('commitConfirmed',false);
EXCEPTION WHEN no_data_found THEN RETURN jsonb_build_object('tag','STALE_SEED');
 WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('tag','INPUT');
 WHEN unique_violation THEN RETURN jsonb_build_object('tag','IDENTITY_CONFLICT');
 WHEN OTHERS THEN RETURN jsonb_build_object('tag','UNAVAILABLE');
END $fn$;
REVOKE ALL ON FUNCTION dream_reservation.reserve_upload_v1(uuid,text,text) FROM PUBLIC,dream_api,dream_worker;

GRANT EXECUTE ON FUNCTION dream_reservation.canonical_json_v1(json,integer),dream_reservation.parse_wire_v1(text),
 dream_reservation.client_v1(text),dream_reservation.policy_v1(text),dream_reservation.epoch_ms_v1(bigint),
 dream_reservation.replay_v1(uuid,uuid,text) TO dream_upload_reserver;
-- Apply exact public entry grants while still owned by the migration role.
GRANT EXECUTE ON FUNCTION dream_reservation.read_upload_seed_v1(uuid,text),
 dream_reservation.reserve_upload_v1(uuid,text,text) TO dream_api;
GRANT dream_upload_reserver TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA dream_reservation TO dream_upload_reserver;
ALTER FUNCTION dream_reservation.read_upload_seed_v1(uuid,text) OWNER TO dream_upload_reserver;
ALTER FUNCTION dream_reservation.reserve_upload_v1(uuid,text,text) OWNER TO dream_upload_reserver;
REVOKE CREATE ON SCHEMA dream_reservation FROM dream_upload_reserver;
REVOKE dream_upload_reserver FROM CURRENT_USER;

-- Native typed-principal/delta assertions. This is not a full version5 descriptor.
DO $inventory$
DECLARE r oid:='dream_upload_reserver'::regrole; m oid:=current_user::regrole; api oid:='dream_api'::regrole;
 root_oid oid:=current_setting('dream.b27_bootstrap_oid')::oid; f record; x record;
BEGIN
 -- Closed namespace owner/ACL inventory, including privileges inherited from
 -- migration-role schema defaults for principals not named by the REVOKE above.
 -- Owner's implicit grant capability is not an ACL WITH GRANT OPTION bit.
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='dream_reservation' AND nspowner=m) THEN
  RAISE EXCEPTION 'B27_SCHEMA_OWNER';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_namespace n,
   LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
   WHERE n.nspname='dream_reservation')<>4 THEN RAISE EXCEPTION 'B27_SCHEMA_ACL'; END IF;
 IF EXISTS(
  WITH actual AS (
   SELECT a.grantee,a.grantor,a.privilege_type,a.is_grantable
    FROM pg_catalog.pg_namespace n,
    LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
    WHERE n.nspname='dream_reservation'
  ), expected(grantee,grantor,privilege_type,is_grantable) AS (
   VALUES(m,m,'CREATE'::text,false),(m,m,'USAGE'::text,false),
     (api,m,'USAGE'::text,false),(r,m,'USAGE'::text,false)
  )
  SELECT 1 FROM (
   (SELECT * FROM actual EXCEPT SELECT * FROM expected)
   UNION ALL
   (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) AS schema_acl_delta
 ) THEN RAISE EXCEPTION 'B27_SCHEMA_ACL'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=r OR member=r)<>1 OR NOT EXISTS(
  SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=r AND member=m AND grantor=root_oid
   AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'B27_MEMBERSHIP_DELTA'; END IF;
 IF pg_has_role(api,m,'MEMBER') OR pg_has_role('dream_worker'::regrole,m,'MEMBER') OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_roles login_role WHERE login_role.rolcanlogin AND NOT login_role.rolsuper
   AND login_role.oid<>m AND pg_has_role(login_role.oid,m,'MEMBER')) THEN
  RAISE EXCEPTION 'B27_RUNTIME_MANAGEMENT_PATH';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=r AND
   (rolcanlogin OR rolsuper OR rolbypassrls OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication))
   OR has_schema_privilege(r,'dream_reservation','CREATE')
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=r)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r)
   OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE proowner=r)<>2 THEN RAISE EXCEPTION 'B27_ROLE_DELTA'; END IF;
 FOR f IN SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid IN (
  'dream_reservation.read_upload_seed_v1(uuid,text)'::regprocedure,
  'dream_reservation.reserve_upload_v1(uuid,text,text)'::regprocedure) LOOP
  IF f.proowner<>r OR NOT f.prosecdef OR f.provolatile<>'v' OR f.proconfig IS DISTINCT FROM
    ARRAY['search_path=pg_catalog, pg_temp','row_security=on']::text[] THEN RAISE EXCEPTION 'B27_ENTRY_PROPERTIES'; END IF;
  IF EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.grantee NOT IN (r,api) OR a.privilege_type<>'EXECUTE' OR a.is_grantable AND a.grantee<>r
      OR a.grantor<>r) OR NOT has_function_privilege(api,f.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'B27_ENTRY_ACL';
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='dream_reservation' AND p.prosecdef)<>2 THEN RAISE EXCEPTION 'B27_DEFINER_COUNT'; END IF;
 -- No PUBLIC/API/worker helper grants and no extra issuer function dependency.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
   LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE n.nspname='dream_reservation' AND NOT p.prosecdef AND
    (a.grantee NOT IN(m,r) OR a.grantor<>m OR a.grantee=r AND a.is_grantable)) THEN
  RAISE EXCEPTION 'B27_HELPER_ACL';
 END IF;
 FOR x IN SELECT c.oid,n.nspname,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='dream_reservation' AND c.relkind='r' LOOP
  IF x.relowner<>m OR NOT x.relrowsecurity OR NOT x.relforcerowsecurity OR EXISTS(
    SELECT 1 FROM aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a
     WHERE a.grantee NOT IN(m,r) OR a.grantee=r AND
      (a.privilege_type NOT IN ('SELECT','INSERT') OR a.privilege_type='INSERT' AND x.relname<>'upload_requests' OR a.is_grantable)) THEN
   RAISE EXCEPTION 'B27_NEW_TABLE_ACL';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream_reservation'
   AND p.polroles IS DISTINCT FROM ARRAY[r]::oid[]) THEN RAISE EXCEPTION 'B27_POLICY_ROLE'; END IF;
 -- Table/column privilege delta must match the explicit nine-table allowlist.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
   LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE a.grantee=r AND (n.nspname||'.'||c.relname NOT IN (
    'dream.storage_policies','dream.storage_policy_versions','dream.storage_objects','dream.upload_intents',
    'dream.storage_verification_operations','dream.storage_verification_receipts','dream.asset_receipt_state',
    'dream_reservation.upload_policy_versions','dream_reservation.upload_requests') OR a.is_grantable
    OR a.privilege_type NOT IN('SELECT','INSERT') OR a.privilege_type='INSERT' AND n.nspname||'.'||c.relname NOT IN(
     'dream.storage_objects','dream.upload_intents','dream_reservation.upload_requests'))) THEN RAISE EXCEPTION 'B27_TABLE_DELTA'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute att JOIN pg_catalog.pg_class c ON c.oid=att.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(att.attacl) a
   WHERE a.grantee=r AND (a.privilege_type<>'UPDATE' OR a.is_grantable OR
     (n.nspname,c.relname,att.attname) NOT IN (('dream','storage_policies','policy_id'),('dream','storage_objects','id')))) THEN
  RAISE EXCEPTION 'B27_COLUMN_DELTA';
 END IF;
 IF has_schema_privilege(api,'dream_reservation','CREATE') OR has_schema_privilege('dream_worker','dream_reservation','USAGE')
   OR NOT has_column_privilege(r,'dream.storage_policies','policy_id','UPDATE')
   OR NOT has_column_privilege(r,'dream.storage_objects','id','UPDATE') THEN RAISE EXCEPTION 'B27_SCHEMA_LOCK_ACL'; END IF;
 FOR x IN SELECT unnest(ARRAY['dream.storage_policies','dream.storage_policy_versions','dream.storage_objects',
   'dream.upload_intents','dream.storage_verification_operations','dream.storage_verification_receipts',
   'dream.asset_receipt_state','dream_reservation.upload_policy_versions','dream_reservation.upload_requests']) AS qualified_name LOOP
  IF NOT has_table_privilege(r,x.qualified_name,'SELECT') THEN RAISE EXCEPTION 'B27_REQUIRED_READ'; END IF;
 END LOOP;
 FOR x IN SELECT unnest(ARRAY['dream.storage_objects','dream.upload_intents','dream_reservation.upload_requests']) AS qualified_name LOOP
  IF NOT has_table_privilege(r,x.qualified_name,'INSERT') THEN RAISE EXCEPTION 'B27_REQUIRED_INSERT'; END IF;
 END LOOP;
END $inventory$;
-- Expose typed native facts for future independent review; never learn an expected
-- catalog descriptor from these target rows. Missing exact descriptor is a gate.
SELECT p.oid,p.pronamespace,p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dream_reservation';
SELECT p.polrelid,p.polroles,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid) AS using_expression,
 pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_catalog.pg_policy p
 WHERE p.polname LIKE 'upload_reservation_%';
SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members
 WHERE roleid='dream_upload_reserver'::regrole OR member='dream_upload_reserver'::regrole;
SELECT n.oid,n.nspowner,a.grantee,a.grantor,a.privilege_type,a.is_grantable
 FROM pg_catalog.pg_namespace n,
 LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
 WHERE n.nspname='dream_reservation';
SELECT c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,a.grantee,a.grantor,a.privilege_type,a.is_grantable
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
 LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE a.grantee='dream_upload_reserver'::regrole OR n.nspname='dream_reservation';
SELECT att.attrelid,att.attnum,a.grantee,a.grantor,a.privilege_type,a.is_grantable
 FROM pg_catalog.pg_attribute att,LATERAL aclexplode(att.attacl) a WHERE a.grantee='dream_upload_reserver'::regrole;
-- No policy/limit fixture INSERTs, Auth setup, capability issuance, provider IO,
-- history write, registry entry or deployment permission is supplied.
COMMIT;
