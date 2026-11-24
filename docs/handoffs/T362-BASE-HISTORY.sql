-- Only for an existing session authorized to read the migration journal.
-- 42501 (no privilege), 42P01 (missing relation) or inaccessible journal:
-- record history as unverified, ROLLBACK, and return to the operator.
-- A later migration requires separate compatibility review.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH expected(ordinal, id, checksum) AS (
  VALUES
    (1,'0001_schema','3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19'),
    (2,'0002_invariants','1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100'),
    (3,'0003_rls','7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d')
)
SELECT coalesce(e.ordinal,h.ordinal) AS ordinal, e.id AS expected_id,
       CASE WHEN e.ordinal IS NULL THEN 'additional migration: review'
            WHEN h.ordinal IS NULL THEN 'missing'
            WHEN h.id IS DISTINCT FROM e.id THEN 'ID mismatch'
            WHEN h.checksum IS DISTINCT FROM e.checksum THEN 'checksum mismatch'
            ELSE 'match' END AS result
FROM expected e FULL JOIN dream_migrations.history h ON h.ordinal=e.ordinal
ORDER BY ordinal;
ROLLBACK;
