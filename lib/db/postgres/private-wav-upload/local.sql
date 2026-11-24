-- Explicit owned PG17 trial; never part of the numbered product migrations.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
 OR to_regnamespace('private_image_upload_v1') IS NULL THEN RAISE EXCEPTION 'OWNED_WAV_TARGET'; END IF;
END $$;
CREATE ROLE local_wav NOLOGIN;
CREATE SCHEMA local_wav;
REVOKE ALL ON SCHEMA local_wav FROM PUBLIC;
CREATE TABLE local_wav.files (
 owner_id uuid NOT NULL, request_id uuid NOT NULL, asset_id uuid NOT NULL UNIQUE, title text NOT NULL,
 rights_note text, content bytea NOT NULL CHECK(octet_length(content) BETWEEN 46 AND 1048576),
 digest text GENERATED ALWAYS AS (encode(sha256(content),'hex')) STORED,
 sample_rate integer NOT NULL CHECK(sample_rate BETWEEN 8000 AND 192000),
 channels integer NOT NULL CHECK(channels IN (1,2)), frames integer NOT NULL CHECK(frames>0),
 duration_ms integer GENERATED ALWAYS AS (greatest(1,round(frames*1000.0/sample_rate)::integer)) STORED,
 PRIMARY KEY(owner_id,request_id), FOREIGN KEY(owner_id,asset_id) REFERENCES dream.assets(owner_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE local_wav.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_wav.files FORCE ROW LEVEL SECURITY;
CREATE POLICY own_read ON local_wav.files FOR SELECT TO local_wav USING(owner_id=dream.actor_id());
CREATE POLICY own_add ON local_wav.files FOR INSERT TO local_wav WITH CHECK(owner_id=dream.actor_id());
GRANT USAGE ON SCHEMA local_wav,dream TO local_wav;
GRANT EXECUTE ON FUNCTION dream.actor_id(),dream.valid_object_key(text,uuid) TO local_wav;
GRANT USAGE ON DOMAIN dream.sha256 TO local_wav;
GRANT SELECT,INSERT ON local_wav.files TO local_wav;
GRANT SELECT(id,owner_id,archived_at),INSERT(owner_id,id,title,kind,rights_note,role,file_path,mime,size_bytes,sha256,duration_ms,origin,created_at)
 ON dream.assets TO local_wav;
CREATE POLICY local_wav_read ON dream.assets FOR SELECT TO local_wav USING(owner_id=dream.actor_id() AND kind='audio');
CREATE POLICY local_wav_add ON dream.assets FOR INSERT TO local_wav WITH CHECK(
 owner_id=dream.actor_id() AND kind='audio' AND mime='audio/wav' AND role='original' AND origin='upload'
 AND EXISTS(SELECT FROM local_wav.files f WHERE f.owner_id=assets.owner_id AND f.asset_id=assets.id
 AND assets.file_path=f.owner_id::text||'/assets/'||f.asset_id::text||'/'||f.digest||'.wav'
 AND f.digest=assets.sha256 AND f.duration_ms=assets.duration_ms AND octet_length(f.content)=assets.size_bytes
 AND f.title=assets.title AND f.rights_note IS NOT DISTINCT FROM assets.rights_note));
COMMIT;
