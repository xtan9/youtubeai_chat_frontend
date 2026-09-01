-- Issue #473: bounded Interaction Assessments for the private Review Queue.
--
-- This migration is intentionally inert: it adds no route, provider call, or
-- scan scheduler. Issue #472 must supply the durable scan caller and pass a
-- complete bounded context before these RPCs are reachable from product code.

create schema if not exists channel_private;

create or replace function channel_private.jsonb_text_array_within_limits(
  p_value jsonb,
  p_max_items integer,
  p_max_characters integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) <> 'array' then false
    else jsonb_array_length(p_value) <= p_max_items
      and not exists (
        select 1
        from jsonb_array_elements(p_value) as item(value)
        where jsonb_typeof(item.value) <> 'string'
          or char_length(item.value #>> '{}') > p_max_characters
      )
  end;
$$;

create table channel_private.interaction_assessments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  connected_channel_id text not null check (
    btrim(connected_channel_id) <> ''
    and connected_channel_id = btrim(connected_channel_id)
    and char_length(connected_channel_id) <= 200
  ),
  scan_run_id uuid,
  comment_id text not null check (
    btrim(comment_id) <> ''
    and comment_id = btrim(comment_id)
    and char_length(comment_id) <= 200
  ),
  comment_text_hash text not null check (
    comment_text_hash ~ '^[a-f0-9]{64}$'
  ),
  video_id text not null check (
    btrim(video_id) <> ''
    and video_id = btrim(video_id)
    and char_length(video_id) <= 200
  ),
  video_title text not null check (
    char_length(btrim(video_title)) between 1 and 300
    and video_title = btrim(video_title)
  ),
  category text not null check (
    category in (
      'allowed_criticism',
      'reviewable_interaction',
      'actionable_abuse',
      'safety_flag'
    )
  ),
  language text not null check (
    language in (
      'english',
      'simplified_chinese',
      'traditional_chinese',
      'chinese_english_code_switch',
      'other'
    )
  ),
  target text not null check (
    target in ('channel_steward', 'other_participant', 'ambiguous')
  ),
  target_evidence jsonb not null default '[]'::jsonb check (
    channel_private.jsonb_text_array_within_limits(target_evidence, 4, 80)
  ),
  candidate_text text check (candidate_text is null or char_length(candidate_text) <= 2000),
  top_level_comment_text text check (
    top_level_comment_text is null
    or char_length(top_level_comment_text) <= 2000
  ),
  neighboring_replies jsonb not null default '[]'::jsonb check (
    channel_private.jsonb_text_array_within_limits(neighboring_replies, 8, 1000)
  ),
  draft_eligible boolean not null default false,
  status text not null check (
    status in (
      'reviewable',
      'actionable',
      'safety_flag',
      'dismissed',
      'marked_criticism',
      'draft_requested',
      'draft_ready',
      'stale',
      'failed',
      'published',
      'publication_uncertain',
      'deleted'
    )
  ),
  assessed_at timestamptz not null,
  superseded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint interaction_assessments_unique_revision
    unique (account_id, connected_channel_id, comment_id, comment_text_hash),
  constraint interaction_assessments_allowed_criticism_text_check check (
    category <> 'allowed_criticism'
    or (
      candidate_text is null
      and top_level_comment_text is null
      and neighboring_replies = '[]'::jsonb
      and draft_eligible = false
      and status = 'marked_criticism'
    )
  ),
  constraint interaction_assessments_safety_draft_check check (
    category <> 'safety_flag' or draft_eligible = false
  ),
  constraint interaction_assessments_other_language_draft_check check (
    language <> 'other' or draft_eligible = false
  ),
  constraint interaction_assessments_draft_policy_check check (
    not draft_eligible
    or (
      category = 'actionable_abuse'
      and language <> 'other'
      and target = 'channel_steward'
      and jsonb_array_length(target_evidence) > 0
      and status in ('actionable', 'draft_requested', 'draft_ready', 'stale')
    )
  ),
  constraint interaction_assessments_deleted_redaction_check check (
    status <> 'deleted'
    or (
      deleted_at is not null
      and candidate_text is null
      and top_level_comment_text is null
      and neighboring_replies = '[]'::jsonb
      and target_evidence = '[]'::jsonb
      and draft_eligible = false
    )
  ),
  constraint interaction_assessments_non_deleted_timestamp_check check (
    status = 'deleted' or deleted_at is null
  )
);

create index interaction_assessments_queue_idx
  on channel_private.interaction_assessments (
    connected_channel_id,
    status,
    assessed_at desc
  )
  where superseded_at is null and deleted_at is null;

create index interaction_assessments_account_comment_idx
  on channel_private.interaction_assessments (
    account_id,
    connected_channel_id,
    comment_id,
    assessed_at desc
  );

alter table channel_private.interaction_assessments enable row level security;

-- The table contains retained YouTube API Data and is only reachable through
-- service-owned RPCs. In particular, no browser role receives queue text.
revoke all on table channel_private.interaction_assessments
  from public, anon, authenticated, service_role;

create or replace function channel_private.record_interaction_assessment(
  p_assessment_id uuid,
  p_account_id uuid,
  p_connected_channel_id text,
  p_scan_run_id uuid,
  p_comment_id text,
  p_comment_text_hash text,
  p_video_id text,
  p_video_title text,
  p_category text,
  p_language text,
  p_target text,
  p_target_evidence jsonb,
  p_candidate_text text,
  p_top_level_comment_text text,
  p_neighboring_replies jsonb,
  p_draft_eligible boolean,
  p_assessed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_id uuid;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  if p_assessment_id is null
    or p_account_id is null
    or p_connected_channel_id is null
    or p_comment_id is null
    or p_comment_text_hash is null
    or p_video_id is null
    or p_video_title is null
    or p_category not in (
      'allowed_criticism',
      'reviewable_interaction',
      'actionable_abuse',
      'safety_flag'
    )
    or p_language not in (
      'english',
      'simplified_chinese',
      'traditional_chinese',
      'chinese_english_code_switch',
      'other'
    )
    or p_target not in ('channel_steward', 'other_participant', 'ambiguous')
    or p_assessed_at is null
    or not channel_private.jsonb_text_array_within_limits(
      coalesce(p_target_evidence, '[]'::jsonb), 4, 80
    )
    or not channel_private.jsonb_text_array_within_limits(
      coalesce(p_neighboring_replies, '[]'::jsonb), 8, 1000
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'malformed_assessment'
    );
  end if;

  if p_category = 'allowed_criticism'
    and (
      p_candidate_text is not null
      or p_top_level_comment_text is not null
      or coalesce(p_neighboring_replies, '[]'::jsonb) <> '[]'::jsonb
      or coalesce(p_draft_eligible, false)
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'allowed_criticism_text_or_draft'
    );
  end if;

  if p_category <> 'allowed_criticism'
    and (p_candidate_text is null or p_top_level_comment_text is null)
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'review_text_missing'
    );
  end if;

  if coalesce(p_draft_eligible, false)
    and (
      p_category <> 'actionable_abuse'
      or p_language = 'other'
      or p_target <> 'channel_steward'
      or jsonb_array_length(coalesce(p_target_evidence, '[]'::jsonb)) = 0
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'draft_policy'
    );
  end if;

  -- A changed text hash is a new assessment. The previous revision remains
  -- available only as bounded provenance and cannot remain the current queue
  -- item for this comment.
  update channel_private.interaction_assessments
  set status = 'stale',
      superseded_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where account_id = p_account_id
    and connected_channel_id = p_connected_channel_id
    and comment_id = p_comment_id
    and comment_text_hash <> p_comment_text_hash
    and superseded_at is null
    and deleted_at is null
    and status in (
      'reviewable',
      'actionable',
      'safety_flag',
      'draft_requested',
      'draft_ready',
      'stale',
      'failed'
    );

  insert into channel_private.interaction_assessments (
    id,
    account_id,
    connected_channel_id,
    scan_run_id,
    comment_id,
    comment_text_hash,
    video_id,
    video_title,
    category,
    language,
    target,
    target_evidence,
    candidate_text,
    top_level_comment_text,
    neighboring_replies,
    draft_eligible,
    status,
    assessed_at
  ) values (
    p_assessment_id,
    p_account_id,
    p_connected_channel_id,
    p_scan_run_id,
    p_comment_id,
    p_comment_text_hash,
    p_video_id,
    p_video_title,
    p_category,
    p_language,
    case when p_category = 'allowed_criticism' then 'ambiguous' else p_target end,
    case when p_category = 'allowed_criticism'
      then '[]'::jsonb else coalesce(p_target_evidence, '[]'::jsonb) end,
    case when p_category = 'allowed_criticism' then null else p_candidate_text end,
    case when p_category = 'allowed_criticism'
      then null else p_top_level_comment_text end,
    case when p_category = 'allowed_criticism'
      then '[]'::jsonb else coalesce(p_neighboring_replies, '[]'::jsonb) end,
    case when p_category = 'actionable_abuse'
      then coalesce(p_draft_eligible, false) else false end,
    case p_category
      when 'allowed_criticism' then 'marked_criticism'
      when 'reviewable_interaction' then 'reviewable'
      when 'actionable_abuse' then 'actionable'
      when 'safety_flag' then 'safety_flag'
    end,
    p_assessed_at
  )
  on conflict (account_id, connected_channel_id, comment_id, comment_text_hash)
  do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select assessment.id
    into inserted_id
    from channel_private.interaction_assessments as assessment
    where assessment.account_id = p_account_id
      and assessment.connected_channel_id = p_connected_channel_id
      and assessment.comment_id = p_comment_id
      and assessment.comment_text_hash = p_comment_text_hash;
    return jsonb_build_object(
      'outcome', 'already_stored',
      'assessmentId', inserted_id
    );
  end if;

  return jsonb_build_object(
    'outcome', 'stored',
    'assessmentId', inserted_id
  );
end;
$$;

create or replace function channel_private.redact_deleted_interaction_comment(
  p_account_id uuid,
  p_connected_channel_id text,
  p_comment_id text,
  p_deleted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  redacted_count integer;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  update channel_private.interaction_assessments
  set candidate_text = null,
      top_level_comment_text = null,
      neighboring_replies = '[]'::jsonb,
      target_evidence = '[]'::jsonb,
      draft_eligible = false,
      status = 'deleted',
      deleted_at = coalesce(p_deleted_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where account_id = p_account_id
    and connected_channel_id = p_connected_channel_id
    and comment_id = p_comment_id
    and status <> 'deleted';

  get diagnostics redacted_count = row_count;
  return jsonb_build_object(
    'outcome', 'redacted',
    'redactedCount', redacted_count
  );
end;
$$;

create or replace function channel_private.list_interaction_review_queue(
  p_account_id uuid,
  p_connected_channel_id text,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'assessmentId', queue.id,
        'channelId', queue.connected_channel_id,
        'commentId', queue.comment_id,
        'videoId', queue.video_id,
        'videoTitle', queue.video_title,
        'category', queue.category,
        'language', queue.language,
        'candidateText', queue.candidate_text,
        'topLevelCommentText', queue.top_level_comment_text,
        'neighboringReplies', queue.neighboring_replies,
        'draftEligible', queue.draft_eligible,
        'status', queue.status,
        'assessedAt', queue.assessed_at
      )
      order by
        case queue.category
          when 'safety_flag' then 0
          when 'actionable_abuse' then 1
          when 'reviewable_interaction' then 2
        end,
        queue.assessed_at desc,
        queue.id
    ),
    '[]'::jsonb
  )
  from (
    select assessment.*
    from channel_private.interaction_assessments as assessment
    where assessment.account_id = p_account_id
      and assessment.connected_channel_id = p_connected_channel_id
      and assessment.category in (
        'safety_flag',
        'actionable_abuse',
        'reviewable_interaction'
      )
      and assessment.status in (
        'reviewable',
        'actionable',
        'safety_flag',
        'draft_requested',
        'draft_ready',
        'stale',
        'failed',
        'publication_uncertain'
      )
      and assessment.superseded_at is null
      and assessment.deleted_at is null
      and assessment.candidate_text is not null
      and assessment.top_level_comment_text is not null
    order by
      case assessment.category
        when 'safety_flag' then 0
        when 'actionable_abuse' then 1
        when 'reviewable_interaction' then 2
      end,
      assessment.assessed_at desc,
      assessment.id
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
  ) as queue;
$$;

create or replace function public.record_interaction_assessment(
  p_assessment_id uuid,
  p_account_id uuid,
  p_connected_channel_id text,
  p_scan_run_id uuid,
  p_comment_id text,
  p_comment_text_hash text,
  p_video_id text,
  p_video_title text,
  p_category text,
  p_language text,
  p_target text,
  p_target_evidence jsonb,
  p_candidate_text text,
  p_top_level_comment_text text,
  p_neighboring_replies jsonb,
  p_draft_eligible boolean,
  p_assessed_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return channel_private.record_interaction_assessment(
    p_assessment_id,
    p_account_id,
    p_connected_channel_id,
    p_scan_run_id,
    p_comment_id,
    p_comment_text_hash,
    p_video_id,
    p_video_title,
    p_category,
    p_language,
    p_target,
    p_target_evidence,
    p_candidate_text,
    p_top_level_comment_text,
    p_neighboring_replies,
    p_draft_eligible,
    p_assessed_at
  );
end;
$$;

create or replace function public.redact_deleted_interaction_comment(
  p_account_id uuid,
  p_connected_channel_id text,
  p_comment_id text,
  p_deleted_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return channel_private.redact_deleted_interaction_comment(
    p_account_id,
    p_connected_channel_id,
    p_comment_id,
    p_deleted_at
  );
end;
$$;

create or replace function public.list_interaction_review_queue(
  p_account_id uuid,
  p_connected_channel_id text,
  p_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return channel_private.list_interaction_review_queue(
    p_account_id,
    p_connected_channel_id,
    p_limit
  );
end;
$$;

revoke all on function channel_private.jsonb_text_array_within_limits(jsonb, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function channel_private.record_interaction_assessment(
  uuid, uuid, text, uuid, text, text, text, text, text, text, text, jsonb,
  text, text, jsonb, boolean, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function channel_private.redact_deleted_interaction_comment(
  uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function channel_private.list_interaction_review_queue(
  uuid, text, integer
) from public, anon, authenticated, service_role;

revoke all on function public.record_interaction_assessment(
  uuid, uuid, text, uuid, text, text, text, text, text, text, text, jsonb,
  text, text, jsonb, boolean, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.redact_deleted_interaction_comment(
  uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.list_interaction_review_queue(uuid, text, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.record_interaction_assessment(
  uuid, uuid, text, uuid, text, text, text, text, text, text, text, jsonb,
  text, text, jsonb, boolean, timestamptz
) to service_role;
grant execute on function public.redact_deleted_interaction_comment(
  uuid, text, text, timestamptz
) to service_role;
grant execute on function public.list_interaction_review_queue(uuid, text, integer)
  to service_role;

notify pgrst, 'reload schema';
