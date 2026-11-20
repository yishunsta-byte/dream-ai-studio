CREATE SCHEMA dream_reference_analysis;
REVOKE ALL ON SCHEMA dream_reference_analysis FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA dream_reference_analysis TO authenticated;

CREATE TABLE dream_reference_analysis.operators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id)
);
ALTER TABLE dream_reference_analysis.operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dream_reference_analysis.operators FROM PUBLIC, anon, authenticated;

CREATE FUNCTION dream_reference_analysis.can_publish()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM dream_reference_analysis.operators WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION dream_reference_analysis.can_publish() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dream_reference_analysis.can_publish() TO authenticated;

CREATE TABLE public.reference_analysis_publications (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 600),
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 1 AND 2000),
  media text NOT NULL CHECK (media IN ('image', 'music', 'video')),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'revoked')),
  published_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reference_analysis_publications ENABLE ROW LEVEL SECURITY;
CREATE INDEX reference_analysis_publications_feed
  ON public.reference_analysis_publications (published_at DESC) WHERE status = 'published';
CREATE INDEX reference_analysis_publications_owner
  ON public.reference_analysis_publications (owner_id, published_at DESC);

REVOKE ALL ON TABLE public.reference_analysis_publications FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, title, summary, prompt, media, status, published_at)
  ON public.reference_analysis_publications TO anon, authenticated;
GRANT INSERT (id, title, summary, prompt, media)
  ON public.reference_analysis_publications TO authenticated;
GRANT UPDATE (status) ON public.reference_analysis_publications TO authenticated;

CREATE POLICY reference_analysis_public_feed ON public.reference_analysis_publications
  FOR SELECT TO anon USING (status = 'published');
CREATE POLICY reference_analysis_operator_view ON public.reference_analysis_publications
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND (SELECT dream_reference_analysis.can_publish()));
CREATE POLICY reference_analysis_operator_publish ON public.reference_analysis_publications
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND status = 'published' AND (SELECT dream_reference_analysis.can_publish()));
CREATE POLICY reference_analysis_operator_revoke ON public.reference_analysis_publications
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND status = 'published' AND (SELECT dream_reference_analysis.can_publish()))
  WITH CHECK (owner_id = (SELECT auth.uid()) AND status = 'revoked' AND (SELECT dream_reference_analysis.can_publish()));
