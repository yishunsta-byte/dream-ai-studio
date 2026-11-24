BEGIN;
SET LOCAL search_path = pg_catalog;
DO $setup$
BEGIN
  IF current_database() <> 'dream_test_t367' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR current_setting('dream.t367_owned', true) IS DISTINCT FROM 'on'
    OR to_regclass('local_wav.files') IS NULL THEN
    RAISE EXCEPTION 'PCM_AUTHORITY_FIXTURE_TARGET';
  END IF;
END
$setup$;

CREATE ROLE pcm_fixture_reader NOLOGIN;
CREATE SCHEMA pcm_fixture;
REVOKE ALL ON SCHEMA pcm_fixture FROM PUBLIC;
CREATE TABLE pcm_fixture.registrations (
  owner_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 46 AND 1048576),
  PRIMARY KEY (owner_id, asset_id),
  FOREIGN KEY (owner_id, asset_id) REFERENCES dream.assets(owner_id, id)
);
CREATE TABLE pcm_fixture.approvals (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  registration_generation integer NOT NULL CHECK (registration_generation > 0),
  generation integer NOT NULL CHECK (generation > 0),
  active boolean NOT NULL,
  PRIMARY KEY (owner_id, project_id, asset_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES dream.projects(owner_id, id),
  FOREIGN KEY (owner_id, asset_id) REFERENCES pcm_fixture.registrations(owner_id, asset_id)
);
ALTER TABLE pcm_fixture.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcm_fixture.registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE pcm_fixture.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcm_fixture.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY pcm_fixture_own_registrations ON pcm_fixture.registrations FOR SELECT TO pcm_fixture_reader USING (owner_id=dream.actor_id());
CREATE POLICY pcm_fixture_own_approvals ON pcm_fixture.approvals FOR SELECT TO pcm_fixture_reader USING (owner_id=dream.actor_id());
CREATE POLICY pcm_fixture_own_projects ON dream.projects FOR SELECT TO pcm_fixture_reader USING (owner_id=dream.actor_id());
CREATE POLICY pcm_fixture_own_assets ON dream.assets FOR SELECT TO pcm_fixture_reader USING (owner_id=dream.actor_id());
CREATE POLICY pcm_fixture_own_links ON dream.project_assets FOR SELECT TO pcm_fixture_reader USING (owner_id=dream.actor_id());
GRANT USAGE ON SCHEMA pcm_fixture, dream, local_wav TO pcm_fixture_reader;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO pcm_fixture_reader;
GRANT SELECT ON pcm_fixture.registrations, pcm_fixture.approvals TO pcm_fixture_reader;
GRANT SELECT (owner_id,id,archived_at) ON dream.projects TO pcm_fixture_reader;
GRANT SELECT (owner_id,id,archived_at,kind,mime,is_mock,file_path,sha256,size_bytes,duration_ms) ON dream.assets TO pcm_fixture_reader;
GRANT SELECT (owner_id,project_id,asset_id,purpose) ON dream.project_assets TO pcm_fixture_reader;
GRANT SELECT (owner_id,asset_id,content,digest,duration_ms) ON local_wav.files TO pcm_fixture_reader;

CREATE VIEW pcm_fixture.current_wav WITH (security_invoker = true) AS
SELECT a.owner_id,a.id AS asset_id,p.id AS project_id,r.sha256,r.size_bytes,a.file_path,a.duration_ms,
       r.generation AS registration_generation,g.generation AS approval_generation
FROM pcm_fixture.registrations r
JOIN dream.assets a ON a.owner_id=r.owner_id AND a.id=r.asset_id
JOIN pcm_fixture.approvals g ON g.owner_id=r.owner_id AND g.asset_id=r.asset_id AND g.registration_generation=r.generation
JOIN dream.projects p ON p.owner_id=g.owner_id AND p.id=g.project_id
JOIN dream.project_assets l ON l.owner_id=g.owner_id AND l.project_id=g.project_id AND l.asset_id=g.asset_id
WHERE r.owner_id=dream.actor_id() AND g.active AND l.purpose='rea-reference'
  AND p.archived_at IS NULL AND a.archived_at IS NULL AND a.is_mock=0 AND a.kind='audio' AND a.mime='audio/wav'
  AND a.sha256=r.sha256 AND a.size_bytes=r.size_bytes
  AND a.file_path=a.owner_id::text||'/assets/'||a.id::text||'/'||r.sha256||'.wav';
GRANT SELECT ON pcm_fixture.current_wav TO pcm_fixture_reader;
CREATE POLICY pcm_fixture_approved_files ON local_wav.files FOR SELECT TO pcm_fixture_reader USING (
  owner_id=dream.actor_id() AND EXISTS (
    SELECT 1 FROM pcm_fixture.current_wav w WHERE w.owner_id=files.owner_id AND w.asset_id=files.asset_id
      AND w.sha256=files.digest AND w.size_bytes=octet_length(files.content) AND w.duration_ms=files.duration_ms
  )
);
COMMIT;
