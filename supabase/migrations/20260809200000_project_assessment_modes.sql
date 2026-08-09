-- Issue #322: add grounded gap-finding and Project Assessment modes to the
-- existing Project Conversation path. Retrieval, quota, ownership, Source Set
-- revision, and Evidence Snapshot persistence remain shared with ordinary and
-- earlier guided questions.

alter table public.project_conversation_messages
  drop constraint project_conversation_messages_analysis_mode_check;
alter table public.project_conversation_messages
  add constraint project_conversation_messages_analysis_mode_check
  check (
    analysis_mode in (
      'question',
      'compare_viewpoints',
      'common_themes',
      'find_gaps',
      'project_assessment'
    )
  );

-- Keep the authenticated reservation seam atomic and owner-scoped by
-- delegating to the established three-argument implementation, then stamp the
-- newly reserved row in the same transaction.
create or replace function public.start_project_grounded_question(
  p_project_id uuid,
  p_question text,
  p_conversation_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_mode text := coalesce(nullif(btrim(p_mode), ''), 'question');
  base_result jsonb;
  enriched_history jsonb;
  stamped_count integer;
begin
  if normalized_mode not in (
    'question',
    'compare_viewpoints',
    'common_themes',
    'find_gaps',
    'project_assessment'
  ) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  base_result := public.start_project_grounded_question(
    p_project_id,
    p_question,
    p_conversation_id
  );

  if base_result ->> 'outcome' <> 'started' then
    return base_result;
  end if;

  update public.project_conversation_messages
  set analysis_mode = normalized_mode
  where id = (base_result ->> 'userMessageId')::uuid
    and role = 'user'
    and completion_state = 'reserved';
  get diagnostics stamped_count = row_count;
  if stamped_count <> 1 then
    raise exception 'Project question reservation mode stamp was not atomic';
  end if;

  select coalesce(
    jsonb_agg(
      message.value || jsonb_build_object(
        'mode', coalesce(messages.analysis_mode, 'question')
      )
      order by message.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_history
  from jsonb_array_elements(base_result -> 'history')
    with ordinality as message(value, ordinality)
  left join public.project_conversation_messages as messages
    on messages.id = (message.value ->> 'id')::uuid;

  return base_result
    || jsonb_build_object(
      'mode', normalized_mode,
      'history', enriched_history
    );
end;
$$;

revoke all on function public.start_project_grounded_question(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_grounded_question(uuid, text, uuid, text)
  to authenticated;

-- Keep the service-role completion boundary aligned with reservation metadata.
-- This replacement is required for deployments that already applied the
-- #321 overload; editing that earlier migration would not update them.
create or replace function public.complete_project_grounded_answer(
  p_owner_id uuid,
  p_project_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_attempt_token uuid,
  p_assistant_content text,
  p_answer_classification text,
  p_source_set_revision bigint,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb,
  p_citation_diagnostics jsonb,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_mode text := coalesce(nullif(btrim(p_mode), ''), 'question');
  stored_mode text;
  base_result jsonb;
begin
  if current_setting('role', true) <> 'service_role'
    or normalized_mode not in (
      'question',
      'compare_viewpoints',
      'common_themes',
      'find_gaps',
      'project_assessment'
    )
  then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select analysis_mode
  into stored_mode
  from public.project_conversation_messages
  where id = p_user_message_id
    and conversation_id = p_conversation_id
    and role = 'user'
    and completion_attempt_token = p_attempt_token
  for update;

  if stored_mode is null then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if stored_mode <> normalized_mode then
    return jsonb_build_object('outcome', 'stale');
  end if;

  base_result := public.complete_project_grounded_answer(
    p_owner_id,
    p_project_id,
    p_conversation_id,
    p_user_message_id,
    p_attempt_token,
    p_assistant_content,
    p_answer_classification,
    p_source_set_revision,
    p_source_manifest,
    p_source_coverage,
    p_evidence_snapshot,
    p_citation_diagnostics
  );

  if base_result ->> 'outcome' in ('completed', 'already_completed') then
    update public.project_conversation_messages
    set analysis_mode = normalized_mode
    where id = coalesce(
      (base_result ->> 'assistantMessageId')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
      and role = 'assistant'
      and in_reply_to_message_id = p_user_message_id;
  end if;

  return base_result;
end;
$$;

revoke all on function public.complete_project_grounded_answer(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_grounded_answer(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, text
) to service_role;

-- Assessment retrieval must not let a dense first source crowd every other
-- source out of the bounded Evidence Snapshot. The normal lexical search is
-- retained for ranking; this owner-scoped wrapper supplements it with one
-- query-relevant, material segment from every ready source that was absent,
-- then keeps the same ten-passage output bound and metadata contract. Keep the
-- readiness predicates in lockstep with search_project_transcript_passages so
-- unavailable identity/evidence and invalid timing never become evidence.
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
        case
          when videos.url_hash ~ '^[A-Za-z0-9_-]{11}$' then videos.url_hash
          when videos.youtube_url ~ '[?&]v=[A-Za-z0-9_-]{11}'
            then substring(videos.youtube_url from '[?&]v=([A-Za-z0-9_-]{11})')
          when videos.youtube_url ~ 'youtu[.]be/[A-Za-z0-9_-]{11}'
            then substring(videos.youtube_url from 'youtu[.]be/([A-Za-z0-9_-]{11})')
          else null
        end as youtube_video_id
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
          from jsonb_array_elements(coalesce(base_result -> 'passages', '[]'::jsonb)) as existing(value)
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
            coalesce((base_result #>> '{coverage,passagesExamined}')::integer, 0),
            jsonb_array_length(merged)
          )
        )
    );
end;
$$;

revoke all on function public.search_project_transcript_passages_balanced(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_project_transcript_passages_balanced(uuid, text, integer)
  to authenticated;

notify pgrst, 'reload schema';
