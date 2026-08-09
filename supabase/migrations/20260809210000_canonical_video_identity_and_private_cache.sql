-- Canonicalize Video identity after all existing Video, History, Chat, and
-- Project callers exist. The UUID remains the internal relationship key; this explicit
-- YouTube ID is the stable external identity used for every cache lookup.

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS youtube_video_id text;

-- Legacy environments may have populated url_hash only for some rows.  Keep
-- the column during the rollout for compatibility, but make the new identity
-- the only key used by application callers.
ALTER TABLE public.videos
  ALTER COLUMN url_hash DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.canonical_youtube_video_id(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  value text := btrim(input);
  candidate text;
BEGIN
  IF value ~ '^[A-Za-z0-9_-]{11}$' THEN
    RETURN value;
  END IF;

  -- watch?v=..., including additional query parameters before/after v.
  IF value ~* '^https?://(?:www[.]|m[.]|music[.])?youtube[.]com/watch(?:[?].*)?$' THEN
    candidate := substring(value from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)');
    IF candidate IS NOT NULL THEN
      RETURN candidate;
    END IF;
  END IF;

  -- Short links and the path-shaped YouTube forms accepted by the shared
  -- TypeScript normalizer.  A single optional trailing slash is allowed,
  -- while an extra path segment is rejected.
  IF value ~* '^https?://youtu[.]be/[A-Za-z0-9_-]{11}/?(?:[?#].*)?$' THEN
    RETURN substring(value from '/([A-Za-z0-9_-]{11})/?(?:[?#].*)?$');
  END IF;

  IF value ~* '^https?://(?:www[.]|m[.]|music[.])?youtube[.]com/(?:embed|live|shorts|v)/[A-Za-z0-9_-]{11}/?(?:[?#].*)?$' THEN
    RETURN substring(value from '/([A-Za-z0-9_-]{11})/?(?:[?#].*)?$');
  END IF;

  RETURN NULL;
END;
$$;

-- This helper is only an implementation detail of the trigger/backfill.  It
-- is not a public Data API endpoint.
REVOKE ALL ON FUNCTION public.canonical_youtube_video_id(text)
  FROM public, anon, authenticated, service_role;

UPDATE public.videos
SET youtube_video_id = COALESCE(
      public.canonical_youtube_video_id(youtube_url),
      public.canonical_youtube_video_id(url_hash)
    ),
    url_hash = COALESCE(
      url_hash,
      public.canonical_youtube_video_id(youtube_url),
      public.canonical_youtube_video_id(url_hash)
    )
WHERE youtube_video_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.videos
    WHERE youtube_video_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'videos contains rows without a supported canonical YouTube video ID';
  END IF;
END;
$$;

-- A legacy deployment could contain equivalent URL rows whose old hash was
-- not the YouTube ID.  Collapse those rows before installing the unique key,
-- preserving one row per child identity and re-pointing UUID relationships.
DO $$
DECLARE
  duplicate_group record;
  duplicate_video uuid;
  child_id uuid;
  child_user uuid;
  child_accessed_at timestamptz;
  child_project uuid;
  child_position smallint;
BEGIN
  -- Identity collapse does not change the Researcher's logical Source Set.
  -- Suppress transition audit rows while UUID relationships are repointed;
  -- the existing events themselves are updated below and remain auditable.
  IF to_regclass('public.project_source_set_events') IS NOT NULL THEN
    PERFORM pg_catalog.set_config('project_private.audit_skip', 'on', true);
  END IF;

  FOR duplicate_group IN
    SELECT youtube_video_id, min(id::text)::uuid AS keep_id
    FROM public.videos
    GROUP BY youtube_video_id
    HAVING count(*) > 1
  LOOP
    FOR duplicate_video IN
      SELECT id
      FROM public.videos
      WHERE youtube_video_id = duplicate_group.youtube_video_id
        AND id <> duplicate_group.keep_id
    LOOP
      -- Keep one Summary for each output language (NULL is the native
      -- language).  Distinct language rows are all preserved.
      FOR child_id IN
        SELECT id FROM public.summaries WHERE video_id = duplicate_video
      LOOP
        IF EXISTS (
          SELECT 1
          FROM public.summaries duplicate_summary
          JOIN public.summaries keep_summary
            ON keep_summary.video_id = duplicate_group.keep_id
           AND keep_summary.output_language IS NOT DISTINCT FROM
               duplicate_summary.output_language
          WHERE duplicate_summary.id = child_id
        ) THEN
          DELETE FROM public.summaries WHERE id = child_id;
        ELSE
          UPDATE public.summaries
          SET video_id = duplicate_group.keep_id
          WHERE id = child_id;
        END IF;
      END LOOP;

      IF EXISTS (
        SELECT 1 FROM public.video_transcripts
        WHERE video_id = duplicate_group.keep_id
      ) THEN
        DELETE FROM public.video_transcripts WHERE video_id = duplicate_video;
      ELSE
        UPDATE public.video_transcripts
        SET video_id = duplicate_group.keep_id
        WHERE video_id = duplicate_video;
      END IF;

      -- History is unique per owner/video. Preserve the most recent access
      -- even when the deterministic Video survivor already has an older row.
      FOR child_id, child_user, child_accessed_at IN
        SELECT id, user_id, accessed_at
        FROM public.user_video_history
        WHERE video_id = duplicate_video
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.user_video_history
          WHERE user_id = child_user
            AND video_id = duplicate_group.keep_id
        ) THEN
          UPDATE public.user_video_history
          SET accessed_at = greatest(accessed_at, child_accessed_at)
          WHERE user_id = child_user
            AND video_id = duplicate_group.keep_id;
          DELETE FROM public.user_video_history WHERE id = child_id;
        ELSE
          UPDATE public.user_video_history
          SET video_id = duplicate_group.keep_id
          WHERE id = child_id;
        END IF;
      END LOOP;

      UPDATE public.chat_messages
      SET video_id = duplicate_group.keep_id
      WHERE video_id = duplicate_video;

      -- A Project cannot contain the same Video twice, nor can two rows share
      -- a position.  Keep the existing membership on either conflict.
      FOR child_project, child_position IN
        SELECT project_id, position
        FROM public.project_videos
        WHERE video_id = duplicate_video
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.project_videos
          WHERE project_id = child_project
            AND video_id <> duplicate_video
            AND (video_id = duplicate_group.keep_id
                 OR position = child_position)
        ) THEN
          DELETE FROM public.project_videos
          WHERE project_id = child_project
            AND video_id = duplicate_video;
        ELSE
          UPDATE public.project_videos
          SET video_id = duplicate_group.keep_id
          WHERE project_id = child_project
            AND video_id = duplicate_video;
        END IF;
      END LOOP;

      -- Some deployed databases already have the project-source audit table
      -- from a later migration.  Re-point those rows before deleting the
      -- duplicate video, while keeping fresh installs order-independent.
      IF to_regclass('public.project_source_set_events') IS NOT NULL THEN
        EXECUTE 'UPDATE public.project_source_set_events
                 SET video_id = $1
                 WHERE video_id = $2'
          USING duplicate_group.keep_id, duplicate_video;
      END IF;

      DELETE FROM public.videos WHERE id = duplicate_video;
    END LOOP;
  END LOOP;

  IF to_regclass('public.project_source_set_events') IS NOT NULL THEN
    PERFORM pg_catalog.set_config('project_private.audit_skip', 'off', true);
  END IF;
END;
$$;

ALTER TABLE public.videos
  ALTER COLUMN youtube_video_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.videos'::regclass
      AND conname = 'videos_youtube_video_id_key'
  ) THEN
    ALTER TABLE public.videos
      ADD CONSTRAINT videos_youtube_video_id_key UNIQUE (youtube_video_id);
  END IF;
END;
$$;

-- The legacy hash can be NULL, an MD5 digest, or a rolling-deploy copy of the
-- canonical ID. It is no longer an identity or conflict target; retaining its
-- unique constraint lets an equivalent write fail before the canonical
-- youtube_video_id conflict can converge on the existing row.
ALTER TABLE public.videos
  DROP CONSTRAINT IF EXISTS videos_url_hash_key;

CREATE OR REPLACE FUNCTION public.sync_video_canonical_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  supplied_id text := nullif(btrim(NEW.youtube_video_id), '');
  canonical_id text;
  url_id text;
BEGIN
  IF supplied_id IS NOT NULL THEN
    canonical_id := public.canonical_youtube_video_id(supplied_id);
    IF canonical_id IS NULL THEN
      RAISE EXCEPTION 'youtube_video_id must be a valid 11-character YouTube ID';
    END IF;
    url_id := public.canonical_youtube_video_id(NEW.youtube_url);
    IF url_id IS NULL THEN
      RAISE EXCEPTION 'youtube_url must contain a supported YouTube video ID';
    END IF;
    IF url_id <> canonical_id THEN
      RAISE EXCEPTION
        'youtube_url and youtube_video_id must identify the same video';
    END IF;
  ELSE
    canonical_id := public.canonical_youtube_video_id(NEW.youtube_url);
    IF canonical_id IS NULL THEN
      canonical_id := public.canonical_youtube_video_id(NEW.url_hash);
    END IF;
    IF canonical_id IS NULL THEN
      RAISE EXCEPTION 'youtube_url must contain a supported YouTube video ID';
    END IF;
  END IF;

  NEW.youtube_video_id := canonical_id;
  -- Keep the legacy column populated for old rows and during a rolling deploy;
  -- no current caller reads or deduplicates by this column anymore.
  NEW.url_hash := COALESCE(NEW.url_hash, canonical_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_video_canonical_identity()
  FROM public, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS videos_sync_canonical_identity ON public.videos;
CREATE TRIGGER videos_sync_canonical_identity
  BEFORE INSERT OR UPDATE OF youtube_url, youtube_video_id, url_hash
  ON public.videos
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_video_canonical_identity();

-- Shared cache tables are server-owned.  RLS remains enabled, but browser
-- roles have neither table grants nor SELECT policies.  Server/service-role
-- cache paths retain their existing behavior.
DROP POLICY IF EXISTS "videos_select" ON public.videos;
DROP POLICY IF EXISTS "summaries_select" ON public.summaries;
DROP POLICY IF EXISTS "videos_select_service" ON public.videos;
DROP POLICY IF EXISTS "summaries_select_service" ON public.summaries;
CREATE POLICY "videos_select_service"
  ON public.videos FOR SELECT TO service_role USING (true);
CREATE POLICY "summaries_select_service"
  ON public.summaries FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.videos, public.summaries
  FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.videos, public.summaries
  TO service_role;

-- Transcript cache rows carry the complete source material and need the same
-- server-only boundary as Videos and Summaries. Explicit service policies keep
-- local/test roles honest even when they do not inherit Supabase's BYPASSRLS.
ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "video_transcripts_select_service"
  ON public.video_transcripts;
DROP POLICY IF EXISTS "video_transcripts_insert_service"
  ON public.video_transcripts;
DROP POLICY IF EXISTS "video_transcripts_update_service"
  ON public.video_transcripts;
CREATE POLICY "video_transcripts_select_service"
  ON public.video_transcripts FOR SELECT TO service_role USING (true);
CREATE POLICY "video_transcripts_insert_service"
  ON public.video_transcripts FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "video_transcripts_update_service"
  ON public.video_transcripts FOR UPDATE TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.video_transcripts
  FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.video_transcripts TO service_role;

-- Owner-scoped History data is returned through a validated function rather
-- than an authenticated role's embedded videos relation.  This keeps the
-- Data API boundary closed while preserving the learner page/dashboard.
CREATE OR REPLACE FUNCTION public.list_user_video_history(
  p_user_id uuid,
  p_page integer,
  p_page_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  safe_page integer := least(greatest(coalesce(p_page, 1), 1), 100000);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  row_offset integer;
  total_count bigint;
  history_rows jsonb;
BEGIN
  IF actor_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF p_user_id IS DISTINCT FROM actor_id THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  row_offset := (safe_page - 1) * safe_page_size;

  SELECT count(*)
  INTO total_count
  FROM public.user_video_history
  WHERE user_id = actor_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'videoId', history.video_id,
        'youtubeUrl', videos.youtube_url,
        'youtubeVideoId', videos.youtube_video_id,
        'title', videos.title,
        'channelName', videos.channel_name,
        'viewedAt', history.accessed_at
      )
      ORDER BY history.accessed_at DESC, history.video_id
    ),
    '[]'::jsonb
  )
  INTO history_rows
  FROM (
    SELECT user_video_history.video_id, user_video_history.accessed_at
    FROM public.user_video_history
    WHERE user_video_history.user_id = actor_id
    ORDER BY user_video_history.accessed_at DESC, user_video_history.video_id
    OFFSET row_offset
    LIMIT safe_page_size
  ) AS history
  JOIN public.videos
    ON videos.id = history.video_id;

  RETURN jsonb_build_object(
    'outcome', 'resolved',
    'page', safe_page,
    'pageSize', safe_page_size,
    'total', total_count,
    'rows', history_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_video_history(uuid, integer, integer)
  FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_user_video_history(uuid, integer, integer)
  TO authenticated;

-- Project Source Set reads use the same owner-checked server boundary.  The
-- authenticated role receives only its own Project's membership projection,
-- never a table-level Videos/Summaries read capability.
CREATE OR REPLACE FUNCTION public.load_project_source_set(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  source_revision bigint;
  membership_rows jsonb;
BEGIN
  IF actor_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.projects
    JOIN public.workspaces
      ON workspaces.id = projects.workspace_id
    WHERE projects.id = p_project_id
      AND workspaces.owner_id = actor_id
  ) THEN
    RETURN jsonb_build_object('outcome', 'missing');
  END IF;

  SELECT coalesce(project_source_sets.revision, 0)
  INTO source_revision
  FROM public.projects
  LEFT JOIN public.project_source_sets
    ON project_source_sets.project_id = projects.id
  WHERE projects.id = p_project_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'video_id', project_videos.video_id,
        'position', project_videos.position,
        'status', project_videos.status,
        'failure_code', project_videos.failure_code,
        'added_at', project_videos.added_at,
        'status_updated_at', project_videos.status_updated_at,
        'videos', jsonb_build_object(
          'id', videos.id,
          'youtube_url', videos.youtube_url,
          'youtube_video_id', videos.youtube_video_id,
          'title', videos.title,
          'channel_name', videos.channel_name
        )
      )
      ORDER BY project_videos.position
    ),
    '[]'::jsonb
  )
  INTO membership_rows
  FROM public.project_videos
  JOIN public.videos
    ON videos.id = project_videos.video_id
  WHERE project_videos.project_id = p_project_id;

  RETURN jsonb_build_object(
    'outcome', 'resolved',
    'revision', source_revision,
    'project_videos', membership_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.load_project_source_set(uuid)
  FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_project_source_set(uuid)
  TO authenticated;


-- Reinstall canonical Project processing/search callers explicitly. These
-- definitions preserve their original ownership checks, SECURITY DEFINER,
-- empty search_path, and least-privilege grants while switching only the
-- Video identity lookup and conflict key.

create or replace function public.start_project_video_processing(
  p_project_id uuid,
  p_youtube_video_id text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  canonical_video_id uuid;
  current_revision bigint;
  current_status text;
  current_status_updated_at timestamptz;
  next_position smallint;
  attempt_id uuid;
  canonical_url text;
begin
  if actor_id is null then
    return jsonb_build_object('outcome', 'unauthenticated');
  end if;

  if p_youtube_video_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    return jsonb_build_object('outcome', 'invalid_video');
  end if;

  perform 1
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = actor_id
  for update of projects;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  insert into public.project_source_sets (project_id)
  values (p_project_id)
  on conflict (project_id) do nothing;

  select revision
  into current_revision
  from public.project_source_sets
  where project_id = p_project_id
  for update;

  select id
  into canonical_video_id
  from public.videos
  where youtube_video_id = p_youtube_video_id;

  if canonical_video_id is not null then
    select status, status_updated_at, position
    into current_status, current_status_updated_at, next_position
    from public.project_videos
    where project_id = p_project_id
      and video_id = canonical_video_id;

    if current_status = 'ready' then
      return jsonb_build_object(
        'outcome', 'already_ready',
        'revision', current_revision,
        'videoId', canonical_video_id,
        'ordinal', next_position,
        'ownsProcessing', false
      );
    end if;

    if current_status = 'processing'
      and current_status_updated_at > now() - interval '6 minutes' then
      return jsonb_build_object(
        'outcome', 'already_processing',
        'revision', current_revision,
        'videoId', canonical_video_id,
        'ordinal', next_position,
        'ownsProcessing', false
      );
    end if;

    if current_status is not null then
      if p_expected_revision is distinct from current_revision then
        return jsonb_build_object(
          'outcome', 'conflict',
          'revision', current_revision,
          'ownsProcessing', false
        );
      end if;

      attempt_id := gen_random_uuid();
      update public.project_videos
      set status = 'processing',
          failure_code = null,
          processing_attempt_id = attempt_id,
          status_updated_at = now()
      where project_id = p_project_id
        and video_id = canonical_video_id;

      update public.project_source_sets
      set revision = current_revision + 1,
          updated_at = now()
      where project_id = p_project_id
      returning revision into current_revision;

      return jsonb_build_object(
        'outcome', 'retry_started',
        'revision', current_revision,
        'videoId', canonical_video_id,
        'ordinal', next_position,
        'attemptId', attempt_id,
        'ownsProcessing', true
      );
    end if;
  end if;

  if p_expected_revision is distinct from current_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'revision', current_revision,
      'ownsProcessing', false
    );
  end if;

  select (count(*) + 1)::smallint
  into next_position
  from public.project_videos
  where project_id = p_project_id;

  if next_position > 5 then
    return jsonb_build_object(
      'outcome', 'limit_reached',
      'revision', current_revision,
      'ownsProcessing', false
    );
  end if;

  if canonical_video_id is null then
    canonical_url := 'https://www.youtube.com/watch?v=' || p_youtube_video_id;
    insert into public.videos (youtube_url, youtube_video_id)
    values (canonical_url, p_youtube_video_id)
    on conflict (youtube_video_id) do nothing
    returning id into canonical_video_id;

    if canonical_video_id is null then
      select id
      into canonical_video_id
      from public.videos
      where youtube_video_id = p_youtube_video_id;
    end if;
  end if;

  attempt_id := gen_random_uuid();
  insert into public.project_videos (
    project_id,
    video_id,
    position,
    status,
    processing_attempt_id
  ) values (
    p_project_id,
    canonical_video_id,
    next_position,
    'processing',
    attempt_id
  );

  update public.project_source_sets
  set revision = current_revision + 1,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'started',
    'revision', current_revision,
    'videoId', canonical_video_id,
    'ordinal', next_position,
    'attemptId', attempt_id,
    'ownsProcessing', true
  );
end;
$$;

revoke all on function public.start_project_video_processing(uuid, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_video_processing(uuid, text, bigint)
  to authenticated;

create or replace function public.search_project_transcript_passages(
  p_project_id uuid,
  p_query text,
  p_limit integer default 8
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  search_input as (
    select
      (select auth.uid()) as researcher_id,
      regexp_replace(
        pg_catalog.normalize(lower(btrim(coalesce(p_query, ''))), 'NFC'),
        '[[:space:]]+',
        ' ',
        'g'
      ) as normalized_query,
      greatest(1, least(coalesce(p_limit, 8), 10)) as result_limit
  ),
  owned_project as (
    select projects.id
    from public.projects
    join public.workspaces
      on workspaces.id = projects.workspace_id
    cross join search_input
    where projects.id = p_project_id
      and workspaces.owner_id = search_input.researcher_id
  ),
  source_revision as (
    select coalesce(project_source_sets.revision, 0)::bigint as revision
    from owned_project
    left join public.project_source_sets
      on project_source_sets.project_id = owned_project.id
  ),
  membership_identity as (
    select
      project_videos.video_id,
      project_videos.position,
      project_videos.status,
      project_videos.failure_code,
      videos.title,
      videos.channel_name,
      videos.youtube_url,
      videos.youtube_video_id
    from owned_project
    join public.project_videos
      on project_videos.project_id = owned_project.id
    join public.videos
      on videos.id = project_videos.video_id
  ),
  membership as (
    select
      membership_identity.*,
      (
        membership_identity.status = 'ready'
        and membership_identity.youtube_video_id is not null
        and project_private.video_has_durable_ready_evidence(
          membership_identity.video_id
        )
        and exists (
          select 1
          from public.video_transcripts as searchable_transcript
          cross join lateral jsonb_array_elements(
            case
              when jsonb_typeof(searchable_transcript.segments) = 'array'
                then searchable_transcript.segments
              else '[]'::jsonb
            end
          ) as searchable_segment(value)
          where searchable_transcript.video_id = membership_identity.video_id
            and jsonb_typeof(searchable_segment.value) = 'object'
            and jsonb_typeof(searchable_segment.value -> 'text') = 'string'
            and btrim(searchable_segment.value ->> 'text') <> ''
            and project_private.safe_transcript_seconds(
              searchable_segment.value -> 'start'
            ) is not null
            and project_private.safe_transcript_seconds(
              searchable_segment.value -> 'duration'
            ) is not null
        )
      ) as is_ready
    from membership_identity
  ),
  raw_query_terms as (
    select term, ordinality
    from search_input
    cross join lateral regexp_split_to_table(
      search_input.normalized_query,
      '[[:space:][:punct:]]+'
    ) with ordinality as token(term, ordinality)
    where term <> ''
  ),
  query_terms as (
    select term, min(ordinality) as first_ordinal
    from raw_query_terms
    group by term
    order by min(ordinality)
    limit 12
  ),
  canonical_query as (
    select pg_catalog.string_agg(term, ' ' order by first_ordinal) as value
    from query_terms
  ),
  transcript_segments as (
    select
      membership.video_id,
      membership.position,
      membership.title,
      membership.channel_name,
      membership.youtube_video_id,
      video_transcripts.language,
      segment.ordinality::bigint as segment_ordinal,
      segment.value ->> 'text' as transcript_text,
      project_private.safe_transcript_seconds(
        segment.value -> 'start'
      ) as start_seconds,
      project_private.safe_transcript_seconds(
        segment.value -> 'duration'
      ) as duration_seconds
    from membership
    join public.video_transcripts
      on video_transcripts.video_id = membership.video_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(video_transcripts.segments) = 'array'
          then video_transcripts.segments
        else '[]'::jsonb
      end
    ) with ordinality as segment(value, ordinality)
    where membership.is_ready
      and jsonb_typeof(segment.value) = 'object'
      and jsonb_typeof(segment.value -> 'text') = 'string'
  ),
  usable_segments as (
    select *
    from transcript_segments
    where btrim(transcript_text) <> ''
      and start_seconds is not null
      and start_seconds >= 0
      and duration_seconds is not null
      and duration_seconds >= 0
  ),
  normalized_segments as (
    select
      usable_segments.*,
      pg_catalog.normalize(
        pg_catalog.lower(usable_segments.transcript_text),
        'NFC'
      ) as searchable_text
    from usable_segments
  ),
  scored_segments as (
    select
      normalized_segments.*,
      coalesce(phrase_match.phrase_position, 0) as phrase_position,
      term_matches.matched_terms,
      term_matches.term_occurrences,
      term_matches.first_term_position,
      search_input.result_limit
    from normalized_segments
    cross join search_input
    cross join canonical_query
    cross join lateral (
      select term_summary.first_position as phrase_position
      from project_private.literal_term_summary(
        normalized_segments.searchable_text,
        canonical_query.value
      ) as term_summary
    ) as phrase_match
    cross join lateral (
      select
        (count(*) filter (where term_match.occurrences > 0))::integer
          as matched_terms,
        coalesce(
          sum(least(5, term_match.occurrences))
            filter (where term_match.occurrences > 0),
          0
        )::integer as term_occurrences,
        min(term_match.first_position)
          filter (where term_match.occurrences > 0)
          as first_term_position
      from query_terms
      cross join lateral (
        select
          term_summary.occurrence_count as occurrences,
          term_summary.first_position
        from project_private.literal_term_summary(
          normalized_segments.searchable_text,
          query_terms.term
        ) as term_summary
      ) as term_match
    ) as term_matches
  ),
  matching_segments as (
    select
      scored_segments.*,
      coalesce(
        nullif(scored_segments.phrase_position, 0),
        scored_segments.first_term_position,
        1
      ) as first_match_position,
      (
        case when scored_segments.phrase_position > 0 then 1000 else 0 end
        + scored_segments.matched_terms * 100
        + scored_segments.term_occurrences * 5
      )::integer as relevance_score
    from scored_segments
    where scored_segments.phrase_position > 0
      or scored_segments.matched_terms > 0
  ),
  raw_positioned_matches as (
    select
      matching_segments.*,
      project_private.raw_position_for_normalized_position(
        matching_segments.transcript_text,
        matching_segments.first_match_position
      ) as raw_match_position
    from matching_segments
  ),
  bounded_matches as (
    select
      raw_positioned_matches.*,
      case
        when char_length(raw_positioned_matches.transcript_text) <= 600 then 1
        else greatest(
          1,
          least(
            raw_positioned_matches.raw_match_position - 200,
            char_length(raw_positioned_matches.transcript_text) - 599
          )
        )
      end as snippet_start
    from raw_positioned_matches
    order by
      raw_positioned_matches.relevance_score desc,
      raw_positioned_matches.matched_terms desc,
      raw_positioned_matches.position asc,
      raw_positioned_matches.start_seconds asc,
      raw_positioned_matches.video_id asc,
      raw_positioned_matches.segment_ordinal asc
    limit (select result_limit from search_input)
  ),
  passages as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'passageId',
          bounded_matches.video_id::text || ':'
          || bounded_matches.segment_ordinal::text || ':'
          || (bounded_matches.snippet_start - 1)::text || ':'
          || least(
            char_length(bounded_matches.transcript_text),
            bounded_matches.snippet_start + 599
          )::text,
        'videoId', bounded_matches.video_id,
        'youtubeVideoId', bounded_matches.youtube_video_id,
        'title', bounded_matches.title,
        'channelName', bounded_matches.channel_name,
        'text', substring(bounded_matches.transcript_text from bounded_matches.snippet_start for 600),
        'segmentOrdinal', bounded_matches.segment_ordinal,
        'excerptStartCharacter', bounded_matches.snippet_start - 1,
        'excerptEndCharacter', least(
          char_length(bounded_matches.transcript_text),
          bounded_matches.snippet_start + 599
        ),
        'startSeconds', bounded_matches.start_seconds,
        'endSeconds', case
          when bounded_matches.duration_seconds > 0
            then bounded_matches.start_seconds + bounded_matches.duration_seconds
          else null
        end,
        'language', bounded_matches.language,
        'truncatedStart', bounded_matches.snippet_start > 1,
        'truncatedEnd',
          bounded_matches.snippet_start + 599 < char_length(bounded_matches.transcript_text)
      ) order by
        bounded_matches.relevance_score desc,
        bounded_matches.matched_terms desc,
        bounded_matches.position asc,
        bounded_matches.start_seconds asc,
        bounded_matches.video_id asc,
        bounded_matches.segment_ordinal asc
    ), '[]'::jsonb) as value
    from bounded_matches
  ),
  unavailable_sources as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'videoId', membership.video_id,
        'youtubeVideoId', membership.youtube_video_id,
        'title', membership.title,
        'channelName', membership.channel_name,
        'status', case
          when membership.status = 'processing' then 'processing'
          when membership.status = 'failed' then 'failed'
          else 'unavailable'
        end,
        'failureCode', case
          when membership.status = 'failed' then membership.failure_code
          when membership.status = 'ready'
            and membership.youtube_video_id is null
            then 'identity_unavailable'
          when membership.status = 'ready' and not membership.is_ready
            then 'evidence_unavailable'
          else null
        end
      ) order by membership.position, membership.video_id
    ), '[]'::jsonb) as value
    from membership
    where not membership.is_ready
  ),
  coverage as (
    select jsonb_build_object(
      'totalVideos', (select count(*) from membership),
      'readyVideos', (select count(*) from membership where is_ready),
      'unavailableVideos', (select value from unavailable_sources),
      'passagesExamined', (select count(*) from usable_segments)
    ) as value
  )
  select case
    when (select researcher_id from search_input) is null
      or not exists (select 1 from owned_project)
      then jsonb_build_object('outcome', 'missing')
    when char_length((select normalized_query from search_input)) not between 2 and 200
      or not exists (select 1 from query_terms)
      then jsonb_build_object('outcome', 'invalid')
    when (select count(*) from membership where is_ready) = 0
      then jsonb_build_object(
        'outcome', 'not_ready',
        'sourceSetRevision', (select revision from source_revision),
        'coverage', (select value from coverage),
        'passages', '[]'::jsonb
      )
    when jsonb_array_length((select value from passages)) = 0
      then jsonb_build_object(
        'outcome', 'no_results',
        'sourceSetRevision', (select revision from source_revision),
        'coverage', (select value from coverage),
        'passages', '[]'::jsonb
      )
    else jsonb_build_object(
      'outcome', 'ready',
      'sourceSetRevision', (select revision from source_revision),
      'coverage', (select value from coverage),
      'passages', (select value from passages)
    )
  end;
$$;

revoke all on function public.search_project_transcript_passages(
  uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_project_transcript_passages(
  uuid, text, integer
) to authenticated;

-- Keep the balanced Assessment search wrapper at the same canonical-identity
-- altitude as the base passage search. The pre-canonical definition derived
-- identity from legacy URL/hash shapes and therefore missed embed/live/shorts
-- rows whose deployed hash was NULL or an MD5 value.
create or replace function public.search_project_transcript_passages_balanced(
  p_project_id uuid,
  p_query text,
  p_limit integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  supplemental jsonb;
  merged jsonb;
  result_limit integer := greatest(1, least(coalesce(p_limit, 8), 10));
begin
  base_result := public.search_project_transcript_passages(
    p_project_id,
    p_query,
    p_limit
  );

  if base_result ->> 'outcome' not in ('ready', 'no_results') then
    return base_result;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'passageId', candidate.video_id::text || ':'
        || candidate.segment_ordinal::text || ':0:'
        || pg_catalog.char_length(candidate.transcript_text)::text,
      'videoId', candidate.video_id,
      'youtubeVideoId', candidate.youtube_video_id,
      'title', candidate.title,
      'channelName', candidate.channel_name,
      'text', candidate.transcript_text,
      'segmentOrdinal', candidate.segment_ordinal,
      'excerptStartCharacter', 0,
      'excerptEndCharacter', pg_catalog.char_length(candidate.transcript_text),
      'startSeconds', candidate.start_seconds,
      'endSeconds', case
        when candidate.duration_seconds > 0
          then candidate.start_seconds + candidate.duration_seconds
        else null
      end,
      'language', candidate.language,
      'truncatedStart', false,
      'truncatedEnd', false
    ) order by candidate.position, candidate.video_id
  ), '[]'::jsonb)
  into supplemental
  from (
    with membership_identity as (
      select
        project_videos.video_id,
        project_videos.position,
        project_videos.status,
        project_videos.failure_code,
        videos.title,
        videos.channel_name,
        videos.youtube_video_id
      from public.projects
      join public.workspaces
        on workspaces.id = projects.workspace_id
      join public.project_videos
        on project_videos.project_id = projects.id
      join public.videos
        on videos.id = project_videos.video_id
      where projects.id = p_project_id
        and workspaces.owner_id = (select auth.uid())
    ),
    membership as (
      select
        membership_identity.*,
        (
          membership_identity.status = 'ready'
          and membership_identity.youtube_video_id is not null
          and project_private.video_has_durable_ready_evidence(
            membership_identity.video_id
          )
          and exists (
            select 1
            from public.video_transcripts as searchable_transcript
            cross join lateral jsonb_array_elements(
              case
                when jsonb_typeof(searchable_transcript.segments) = 'array'
                  then searchable_transcript.segments
                else '[]'::jsonb
              end
            ) as searchable_segment(value)
            where searchable_transcript.video_id = membership_identity.video_id
              and jsonb_typeof(searchable_segment.value) = 'object'
              and jsonb_typeof(searchable_segment.value -> 'text') = 'string'
              and btrim(searchable_segment.value ->> 'text') <> ''
              and project_private.safe_transcript_seconds(
                searchable_segment.value -> 'start'
              ) is not null
              and project_private.safe_transcript_seconds(
                searchable_segment.value -> 'start'
              ) >= 0
              and project_private.safe_transcript_seconds(
                searchable_segment.value -> 'duration'
              ) is not null
              and project_private.safe_transcript_seconds(
                searchable_segment.value -> 'duration'
              ) >= 0
          )
        ) as is_ready
      from membership_identity
    ),
    query_input as (
      select pg_catalog.normalize(
        pg_catalog.lower(btrim(coalesce(p_query, ''))),
        'NFC'
      ) as normalized_query
    ),
    query_terms as (
      select distinct term
      from query_input
      cross join lateral regexp_split_to_table(
        query_input.normalized_query,
        '[[:space:][:punct:]]+'
      ) as token(term)
      where term <> ''
    ),
    candidate_segments as (
      select
        membership.video_id,
        membership.position,
        membership.title,
        membership.channel_name,
        membership.youtube_video_id,
        coalesce(video_transcripts.language, 'und') as language,
        segment.ordinality::bigint as segment_ordinal,
        btrim(segment.value ->> 'text') as transcript_text,
        project_private.safe_transcript_seconds(segment.value -> 'start')
          as start_seconds,
        project_private.safe_transcript_seconds(segment.value -> 'duration')
          as duration_seconds
      from membership
      join public.video_transcripts
        on video_transcripts.video_id = membership.video_id
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(video_transcripts.segments) = 'array'
            then video_transcripts.segments
          else '[]'::jsonb
        end
      ) with ordinality as segment(value, ordinality)
      where membership.is_ready
        and jsonb_typeof(segment.value) = 'object'
        and jsonb_typeof(segment.value -> 'text') = 'string'
        and btrim(segment.value ->> 'text') <> ''
        and pg_catalog.char_length(btrim(segment.value ->> 'text')) <= 600
        and project_private.safe_transcript_seconds(segment.value -> 'start') is not null
        and project_private.safe_transcript_seconds(segment.value -> 'start') >= 0
        and project_private.safe_transcript_seconds(segment.value -> 'duration') is not null
        and project_private.safe_transcript_seconds(segment.value -> 'duration') >= 0
        and not exists (
          select 1
          from jsonb_array_elements(
            coalesce(base_result -> 'passages', '[]'::jsonb)
          ) as existing(value)
          where existing.value ->> 'videoId' = membership.video_id::text
        )
    ),
    scored_segments as (
      select
        candidate_segments.*,
        coalesce(phrase_match.first_position, 0) as phrase_position,
        term_matches.matched_terms,
        term_matches.term_occurrences,
        coalesce(
          nullif(phrase_match.first_position, 0),
          term_matches.first_term_position,
          1
        ) as first_match_position
      from candidate_segments
      cross join query_input
      cross join lateral (
        select summary.first_position
        from project_private.literal_term_summary(
          pg_catalog.normalize(
            pg_catalog.lower(candidate_segments.transcript_text),
            'NFC'
          ),
          query_input.normalized_query
        ) as summary
      ) as phrase_match
      cross join lateral (
        select
          (count(*) filter (where term_match.occurrences > 0))::integer
            as matched_terms,
          coalesce(
            sum(least(5, term_match.occurrences))
              filter (where term_match.occurrences > 0),
            0
          )::integer as term_occurrences,
          min(term_match.first_position)
            filter (where term_match.occurrences > 0)
            as first_term_position
        from query_terms
        cross join lateral (
          select summary.occurrence_count as occurrences,
            summary.first_position
          from project_private.literal_term_summary(
            pg_catalog.normalize(
              pg_catalog.lower(candidate_segments.transcript_text),
              'NFC'
            ),
            query_terms.term
          ) as summary
        ) as term_match
      ) as term_matches
    ),
    matching_segments as (
      select
        scored_segments.*,
        (
          case when scored_segments.phrase_position > 0 then 1000 else 0 end
          + scored_segments.matched_terms * 100
          + scored_segments.term_occurrences * 5
        )::integer as relevance_score
      from scored_segments
      where scored_segments.phrase_position > 0
        or scored_segments.matched_terms > 0
    ),
    source_ranked as (
      select
        matching_segments.*,
        row_number() over (
          partition by matching_segments.video_id
          order by
            matching_segments.relevance_score desc,
            matching_segments.matched_terms desc,
            matching_segments.term_occurrences desc,
            matching_segments.position asc,
            matching_segments.start_seconds asc,
            matching_segments.segment_ordinal asc
        ) as source_rank
      from matching_segments
    )
    select *
    from source_ranked
    where source_rank = 1
    order by
      source_ranked.position,
      source_ranked.relevance_score desc,
      source_ranked.start_seconds,
      source_ranked.video_id,
      source_ranked.segment_ordinal
  ) as candidate;

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into merged
  from (
    select value
    from jsonb_array_elements(coalesce(supplemental, '[]'::jsonb))
    union all
    select value
    from jsonb_array_elements(coalesce(base_result -> 'passages', '[]'::jsonb))
    limit result_limit
  ) as bounded;

  if jsonb_array_length(merged) = 0 then
    return base_result;
  end if;

  return base_result
    || jsonb_build_object(
      'outcome', 'ready',
      'passages', merged,
      'coverage', coalesce(base_result -> 'coverage', '{}'::jsonb)
        || jsonb_build_object(
          'passagesExamined', greatest(
            coalesce(
              (base_result #>> '{coverage,passagesExamined}')::integer,
              0
            ),
            jsonb_array_length(merged)
          )
        )
    );
end;
$$;

revoke all on function public.search_project_transcript_passages_balanced(
  uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_project_transcript_passages_balanced(
  uuid, text, integer
) to authenticated;

NOTIFY pgrst, 'reload schema';
