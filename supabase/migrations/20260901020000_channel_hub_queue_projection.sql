-- Expose the stored assessment facts needed by the production Channel Hub.
-- The projection remains service-role-only and keeps the account plus active
-- Connected Channel predicates from the original queue function.

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
        'target', queue.target,
        'targetEvidence', queue.target_evidence,
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

revoke all on function channel_private.list_interaction_review_queue(
  uuid, text, integer
) from public, anon, authenticated, service_role;
