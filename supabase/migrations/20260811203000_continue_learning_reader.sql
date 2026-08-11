-- Dormant Continue Learning reader seam (Issue #353).
--
-- This is a service-owned projection over the exact current Recommendation Set
-- and rollout contracts from Issues #351/#352. It deliberately adds no new
-- learner table or write path; it reads the existing private History only
-- inside this service-owned projection. There is no worker, Gateway call,
-- cohort policy, or automatic promotion. The application route adds an
-- explicit disabled-by-default flag and only signs browser tokens after this
-- projection reports effective `on`.

create or replace function catalog_private.read_continue_learning_recommendations(
  p_learner_id uuid,
  p_source_youtube_video_id text,
  p_limit integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rollout jsonb;
  effective_state text;
  source_row record;
  set_row record;
  quality_row record;
  quality_report_id uuid;
  source_gate_ok boolean;
  item_rows jsonb;
  safe_limit integer := least(greatest(coalesce(p_limit, 6), 1), 50);
begin
  if p_learner_id is null
    or p_source_youtube_video_id is null
    or p_source_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
  then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'source_not_ready'
    );
  end if;

  -- get_recommendation_rollout takes the shared quality/rollout locks. The
  -- current Set query below therefore observes one coherent gate snapshot;
  -- Set mutations take the same quality lock through their trigger.
  rollout := catalog_private.get_recommendation_rollout();
  if rollout->>'outcome' is distinct from 'read' then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'rollout_unverifiable'
    );
  end if;

  effective_state := rollout->>'effectiveState';
  if effective_state = 'off' then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'rollout_off',
      'effectiveState', effective_state
    );
  elsif effective_state = 'shadow' then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'rollout_shadow',
      'effectiveState', effective_state
    );
  elsif effective_state = 'pilot' then
    -- #352 intentionally has no learner cohort membership contract yet.
    -- Never turn a pilot control into an all-learner read by inference.
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'pilot_cohort_unconfigured',
      'effectiveState', effective_state
    );
  elsif effective_state is distinct from 'on' then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'rollout_unverifiable',
      'effectiveState', effective_state
    );
  end if;

  -- Effective `on` is meaningful only for the exact approved quality report
  -- and its Set policy fingerprint. Do not infer approval from any other
  -- active policy that might coexist during a policy transition.
  if rollout->>'qualityCurrent' is distinct from 'true'
    or rollout->>'qualityReportId' !~
      '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
    or rollout->>'qualityInputFingerprint' !~ '^[a-f0-9]{64}$'
  then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'rollout_unverifiable',
      'effectiveState', effective_state
    );
  end if;

  quality_report_id := (rollout->>'qualityReportId')::uuid;
  select report.*
  into quality_row
  from catalog_private.recommendation_quality_reports as report
  where report.id = quality_report_id
    and report.eligible
    and report.input_fingerprint = rollout->>'qualityInputFingerprint';

  if quality_row.id is null then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'rollout_unverifiable',
      'effectiveState', effective_state
    );
  end if;

  -- Hold the same shared activation lock used by Set publication while
  -- checking the source/candidate tuple below. Retirement therefore cannot
  -- race a read into serving a now-unapproved semantic profile.
  perform pg_advisory_xact_lock_shared(hashtext('semantic-profile-activation'));

  select video.*
  into source_row
  from public.videos as video
  where video.youtube_video_id = p_source_youtube_video_id
    and video.catalog_state = 'active'
    and exists (
      select 1
      from public.summaries as summary
      where summary.video_id = video.id
    )
  limit 1;

  if source_row.id is null then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'source_not_ready',
      'effectiveState', effective_state
    );
  end if;

  select recommendation_set.*
  into set_row
  from catalog_private.recommendation_sets as recommendation_set
  join catalog_private.recommendation_review_policies as review_policy
    on review_policy.set_policy_fingerprint =
      recommendation_set.set_policy_fingerprint
   and review_policy.status = 'active'
  where recommendation_set.source_video_id = source_row.id
    and recommendation_set.status = 'current'
    and recommendation_set.set_policy_fingerprint =
      quality_row.set_policy_fingerprint
  order by recommendation_set.published_at desc, recommendation_set.id
  limit 1;

  if set_row.id is null then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'source_not_ready',
      'effectiveState', effective_state
    );
  end if;

  -- Re-check the exact source profile, active approved semantic tuple, and
  -- latest independently verified Catalog Admission at read time. Set
  -- publication proves these conditions once; a later retirement or evidence
  -- expiry must suppress the reader until a new quality report is approved.
  select exists (
    select 1
    from catalog_private.semantic_profile_versions as source_profile
    join lateral (
      select latest_admission.id
      from catalog_private.catalog_admissions as latest_admission
      where latest_admission.video_id = source_profile.video_id
      order by latest_admission.decided_at desc, latest_admission.id desc
      limit 1
    ) as latest_source_admission on true
    join catalog_private.catalog_admissions as source_admission
      on source_admission.id = latest_source_admission.id
     and source_admission.id = set_row.source_catalog_admission_id
    join catalog_private.youtube_provider_evidence as source_evidence
      on source_evidence.id = source_admission.provider_evidence_id
     and source_evidence.video_id = source_admission.video_id
    where source_profile.id = set_row.source_profile_id
      and source_profile.video_id = source_row.id
      and source_profile.status = 'active'
      and source_profile.generator_model = set_row.semantic_model_identifier
      and source_profile.profile_schema_version = set_row.profile_schema_version
      and source_profile.prompt_version = set_row.semantic_prompt_version
      and source_profile.evaluation_fingerprint =
        set_row.semantic_evaluation_fingerprint
      and catalog_private.semantic_profile_activation_is_available(
        source_profile.generator_model,
        source_profile.profile_schema_version,
        source_profile.prompt_version,
        source_profile.evaluation_fingerprint
      )
      and source_admission.policy_version =
        set_row.source_catalog_admission_policy_version
      and source_admission.decision = 'admitted'
      and source_admission.reason_code is null
      and source_evidence.provider_outcome = 'verified'
      and source_evidence.provider_path = 'youtube_data_api_v3_videos_list'
      and source_evidence.provider_verified_at <=
        statement_timestamp() + interval '5 minutes'
      and source_evidence.evidence_expires_at > statement_timestamp()
      and source_row.catalog_state = 'active'
      and source_row.catalog_inactive_reason is null
      and source_row.privacy_status = 'public'
      and source_row.embeddable is true
      and source_row.live_status = 'none'
      and source_row.age_restricted is false
      and source_row.provider_evidence_path = source_evidence.provider_path
      and source_row.provider_verified_at = source_evidence.provider_verified_at
      and source_row.provider_evidence_expires_at =
        source_evidence.evidence_expires_at
  ) into source_gate_ok;

  if not source_gate_ok then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'source_not_ready',
      'effectiveState', effective_state
    );
  end if;

  -- Candidate metadata is projected from the public Catalog only after the
  -- current Set and all rollout gates are locked. Learner history is used only
  -- as a ranking predicate; it is never returned to the caller.
  with candidate_rows as (
    select
      recommendation.recommendation_set_id,
      recommendation.ordinal,
      recommendation.candidate_video_id,
      candidate.youtube_url,
      candidate.title,
      candidate.channel_name,
      candidate.thumbnail_url,
      recommendation.continuation_relationship,
      recommendation.explanation,
      exists (
        select 1
        from public.user_video_history as history
        where history.user_id = p_learner_id
          and history.video_id = recommendation.candidate_video_id
      ) as is_history_match
    from catalog_private.recommendations as recommendation
  join public.videos as candidate
    on candidate.id = recommendation.candidate_video_id
   and candidate.catalog_state = 'active'
  join catalog_private.semantic_profile_versions as candidate_profile
    on candidate_profile.id = recommendation.candidate_profile_id
   and candidate_profile.video_id = candidate.id
   and candidate_profile.status = 'active'
  join lateral (
    select latest_admission.id
    from catalog_private.catalog_admissions as latest_admission
    where latest_admission.video_id = candidate.id
    order by latest_admission.decided_at desc, latest_admission.id desc
    limit 1
  ) as latest_candidate_admission on true
  join catalog_private.catalog_admissions as candidate_admission
    on candidate_admission.id = recommendation.candidate_catalog_admission_id
   and candidate_admission.id = latest_candidate_admission.id
   and candidate_admission.video_id = candidate.id
  join catalog_private.youtube_provider_evidence as candidate_evidence
    on candidate_evidence.id = candidate_admission.provider_evidence_id
   and candidate_evidence.video_id = candidate.id
    where recommendation.recommendation_set_id = set_row.id
      and recommendation.candidate_video_id <> source_row.id
      and candidate_profile.generator_model = set_row.semantic_model_identifier
      and candidate_profile.profile_schema_version = set_row.profile_schema_version
      and candidate_profile.prompt_version = set_row.semantic_prompt_version
      and candidate_profile.evaluation_fingerprint =
        set_row.semantic_evaluation_fingerprint
      and catalog_private.semantic_profile_activation_is_available(
        candidate_profile.generator_model,
        candidate_profile.profile_schema_version,
        candidate_profile.prompt_version,
        candidate_profile.evaluation_fingerprint
      )
      and candidate_admission.decision = 'admitted'
      and candidate_admission.reason_code is null
      and candidate_evidence.provider_outcome = 'verified'
      and candidate_evidence.provider_path =
        'youtube_data_api_v3_videos_list'
      and candidate_evidence.provider_verified_at <=
        statement_timestamp() + interval '5 minutes'
      and candidate_evidence.evidence_expires_at > statement_timestamp()
      and candidate.catalog_inactive_reason is null
      and candidate.privacy_status = 'public'
      and candidate.embeddable is true
      and candidate.live_status = 'none'
      and candidate.age_restricted is false
      and candidate.provider_evidence_path = candidate_evidence.provider_path
      and candidate.provider_verified_at = candidate_evidence.provider_verified_at
      and candidate.provider_evidence_expires_at =
        candidate_evidence.evidence_expires_at
  ),
  one_per_channel as (
    select candidate_rows.*,
      row_number() over (
        partition by coalesce(candidate_rows.channel_name, '')
        order by candidate_rows.is_history_match, candidate_rows.ordinal
      ) as channel_rank
    from candidate_rows
  ),
  relationship_first as (
    select one_per_channel.*,
      row_number() over (
        partition by one_per_channel.continuation_relationship
        order by one_per_channel.is_history_match, one_per_channel.ordinal
      ) as relationship_rank
    from one_per_channel
    where one_per_channel.channel_rank = 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'setId', relationship_first.recommendation_set_id,
        'ordinal', relationship_first.ordinal,
        'candidateVideoId', relationship_first.candidate_video_id,
        'canonicalUrl', relationship_first.youtube_url,
        'title', relationship_first.title,
        'channelName', relationship_first.channel_name,
        'thumbnailUrl', relationship_first.thumbnail_url,
        'relationship', relationship_first.continuation_relationship,
        'explanation', relationship_first.explanation
      )
      -- Prefer an unseen item, then give each supported relationship one slot
      -- before filling remaining slots in Set ordinal order.
      order by relationship_first.is_history_match,
        relationship_first.relationship_rank,
        relationship_first.ordinal
    ) filter (where relationship_first.ordinal is not null),
    '[]'::jsonb
  )
  into item_rows
  from (
    select relationship_first.*
    from relationship_first
    order by relationship_first.is_history_match,
      relationship_first.relationship_rank,
      relationship_first.ordinal
    limit safe_limit
  ) as relationship_first;

  if jsonb_array_length(item_rows) = 0 then
    return jsonb_build_object(
      'outcome', 'unavailable',
      'reason', 'no_recommendations',
      'effectiveState', effective_state
    );
  end if;

  return jsonb_build_object(
    'outcome', 'ready',
    'effectiveState', effective_state,
    'items', item_rows
  );
end;
$$;

create or replace function public.read_continue_learning_recommendations(
  p_learner_id uuid,
  p_source_youtube_video_id text,
  p_limit integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.read_continue_learning_recommendations(
    p_learner_id,
    p_source_youtube_video_id,
    p_limit
  );
end;
$$;

revoke all on function catalog_private.read_continue_learning_recommendations(
  uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function catalog_private.read_continue_learning_recommendations(
  uuid, text, integer
) to service_role;

revoke all on function public.read_continue_learning_recommendations(
  uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.read_continue_learning_recommendations(
  uuid, text, integer
) to service_role;

notify pgrst, 'reload schema';
