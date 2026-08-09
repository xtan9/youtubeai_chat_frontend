-- One owner-scoped, snapshot-coherent passage-search capability. Ranking is
-- deliberately private to this function: callers receive stable, bounded,
-- exact Transcript passages and Source Coverage, never implementation scores.

create function project_private.safe_transcript_seconds(p_value jsonb)
returns double precision
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  numeric_value numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) operator(pg_catalog.<>) 'number' then
    return null;
  end if;

  begin
    numeric_value := p_value::text::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return null;
  end;

  -- Far beyond any YouTube runtime while still preventing float overflow.
  if numeric_value operator(pg_catalog.<) 0
    or numeric_value operator(pg_catalog.>) 1000000000
  then
    return null;
  end if;
  return numeric_value::double precision;
end;
$$;

create function project_private.raw_position_for_normalized_position(
  p_text text,
  p_normalized_position integer
)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  lower_bound integer := 1;
  upper_bound integer := pg_catalog.char_length(p_text);
  midpoint integer;
begin
  if upper_bound operator(pg_catalog.=) 0
    or p_normalized_position operator(pg_catalog.<=) 1
  then
    return 1;
  end if;

  -- NFC can combine multiple raw code points. Binary-search the first raw
  -- prefix whose normalized length reaches the normalized match position.
  while lower_bound operator(pg_catalog.<) upper_bound loop
    midpoint := (
      lower_bound operator(pg_catalog.+) upper_bound
    ) operator(pg_catalog./) 2;
    if pg_catalog.char_length(
      pg_catalog.normalize(
        pg_catalog.lower(pg_catalog.substr(p_text, 1, midpoint)),
        'NFC'
      )
    ) operator(pg_catalog.>=) p_normalized_position then
      upper_bound := midpoint;
    else
      lower_bound := midpoint operator(pg_catalog.+) 1;
    end if;
  end loop;
  return lower_bound;
end;
$$;

create function project_private.is_boundaryless_search_character(
  p_character text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when pg_catalog.char_length(p_character) operator(pg_catalog.<>) 1
      then false
    else
      -- CJK ideographs, Hiragana, Katakana, and Hangul are conventionally
      -- searched as literal substrings rather than whitespace-delimited words.
      exists (
        select 1
        from (values
          (13312, 19903),
          (19968, 40959),
          (63744, 64255),
          (131072, 192095),
          (194560, 195103),
          (12352, 12543),
          (12784, 12799),
          (65381, 65439),
          (110592, 111359),
          (4352, 4607),
          (12592, 12687),
          (43360, 43391),
          (44032, 55295)
        ) as boundaryless_range(first_codepoint, last_codepoint)
        where pg_catalog.ascii(p_character)
          operator(pg_catalog.>=) boundaryless_range.first_codepoint
          and pg_catalog.ascii(p_character)
          operator(pg_catalog.<=) boundaryless_range.last_codepoint
      )
  end;
$$;

create function project_private.literal_term_summary(
  p_text text,
  p_term text
)
returns table(first_position integer, occurrence_count integer)
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  character_index integer;
  escaped_term text := '';
  first_character text;
  first_requires_boundary boolean;
  last_character text;
  last_requires_boundary boolean;
  match_position integer;
  occurrence_index integer;
  search_position integer := 1;
  search_pattern text;
  term_character text;
  term_length integer;
begin
  if p_term operator(pg_catalog.=) '' then
    first_position := null;
    occurrence_count := 0;
    return next;
    return;
  end if;

  term_length := pg_catalog.char_length(p_term);
  for character_index in 1..term_length loop
    term_character := pg_catalog.substr(p_term, character_index, 1);
    if pg_catalog.strpos(E'\\.^$|()[]{}*+?', term_character)
      operator(pg_catalog.>) 0
    then
      escaped_term := escaped_term
        operator(pg_catalog.||) E'\\'
        operator(pg_catalog.||) term_character;
    else
      escaped_term := escaped_term operator(pg_catalog.||) term_character;
    end if;
  end loop;

  first_character := pg_catalog.substr(p_term, 1, 1);
  last_character := pg_catalog.substr(
    p_term,
    term_length,
    1
  );
  -- Supabase Postgres ships ICU. Pin the root ICU collation so POSIX alnum
  -- classes recognize every Unicode script regardless of database LC_CTYPE.
  first_requires_boundary :=
    first_character collate pg_catalog."und-x-icu"
      operator(pg_catalog.~) '^[[:alnum:]_]$'
    and not project_private.is_boundaryless_search_character(first_character);
  last_requires_boundary :=
    last_character collate pg_catalog."und-x-icu"
      operator(pg_catalog.~) '^[[:alnum:]_]$'
    and not project_private.is_boundaryless_search_character(last_character);

  search_pattern := case
    when first_requires_boundary then '(?<![[:alnum:]_])'
    else ''
  end operator(pg_catalog.||) escaped_term operator(pg_catalog.||) case
    when last_requires_boundary then '(?![[:alnum:]_])'
    else ''
  end;

  first_position := null;
  occurrence_count := 0;
  for occurrence_index in 1..5 loop
    match_position := pg_catalog.regexp_instr(
      p_text collate pg_catalog."und-x-icu",
      search_pattern,
      search_position,
      1,
      0,
      ''
    );
    exit when match_position operator(pg_catalog.=) 0;

    if first_position is null then
      first_position := match_position;
    end if;
    occurrence_count := occurrence_count operator(pg_catalog.+) 1;
    -- Continue from the end of this literal match. This scans the original
    -- text forward at most five times without constructing suffix strings.
    search_position := match_position operator(pg_catalog.+) term_length;
  end loop;

  return next;
end;
$$;

revoke all on function project_private.safe_transcript_seconds(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function project_private.raw_position_for_normalized_position(
  text, integer
) from public, anon, authenticated, service_role;
revoke all on function project_private.is_boundaryless_search_character(text)
  from public, anon, authenticated, service_role;
revoke all on function project_private.literal_term_summary(text, text)
  from public, anon, authenticated, service_role;

create function public.search_project_transcript_passages(
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
      case
        when videos.url_hash ~ '^[A-Za-z0-9_-]{11}$' then videos.url_hash
        when videos.youtube_url ~ '[?&]v=[A-Za-z0-9_-]{11}'
          then substring(videos.youtube_url from '[?&]v=([A-Za-z0-9_-]{11})')
        when videos.youtube_url ~ 'youtu[.]be/[A-Za-z0-9_-]{11}'
          then substring(videos.youtube_url from 'youtu[.]be/([A-Za-z0-9_-]{11})')
        else null
      end as youtube_video_id
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

notify pgrst, 'reload schema';
