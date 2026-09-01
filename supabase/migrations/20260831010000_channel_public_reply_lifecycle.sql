-- Simulated Public Reply lifecycle controls.
--
-- This migration extends the inert Channel foundation with durable state for
-- the provider/local reconciliation seam. It does not call YouTube and it
-- never schedules or performs a delete without an explicit user confirmation.

alter table public.channel_work_items
  add column if not exists final_text text,
  add column if not exists provider_reply_id text,
  add column if not exists published_text text,
  add column if not exists published_text_hash text,
  add column if not exists published_at timestamptz,
  add column if not exists last_observed_text text,
  add column if not exists last_observed_text_hash text,
  add column if not exists last_observed_at timestamptz,
  add column if not exists externally_edited boolean not null default false,
  add column if not exists lifecycle_revision bigint not null default 0,
  add column if not exists publication_failure text,
  add column if not exists retry_authorized_by text,
  add column if not exists deletion_status text not null default 'not_requested',
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_completed_at timestamptz,
  add column if not exists deletion_failure text;

alter table public.channel_work_items
  add constraint channel_work_items_reply_provider_id_ck
    check (
      status not in ('published', 'deleted')
      or nullif(btrim(provider_reply_id), '') is not null
    ),
  add constraint channel_work_items_lifecycle_revision_ck
    check (lifecycle_revision >= 0),
  add constraint channel_work_items_retry_authorized_by_ck
    check (
      retry_authorized_by is null
      or retry_authorized_by in ('provider_rejection', 'verified_absence')
    ),
  add constraint channel_work_items_uncertain_retry_ck
    check (
      status <> 'publication_uncertain'
      or retry_authorized_by is null
    ),
  add constraint channel_work_items_deletion_status_ck
    check (
      deletion_status in (
        'not_requested',
        'in_progress',
        'uncertain',
        'failed',
        'completed'
      )
    ),
  add constraint channel_work_items_deleted_status_ck
    check (
      status <> 'deleted'
      or deletion_status = 'completed'
    );

create index if not exists channel_work_items_publication_uncertain_idx
  on public.channel_work_items (owner_id, updated_at desc)
  where status = 'publication_uncertain';

create index if not exists channel_work_items_deletion_work_idx
  on public.channel_work_items (owner_id, updated_at desc)
  where deletion_status in ('in_progress', 'uncertain', 'failed');

-- A provider rejection or a verified absence is retryable. An uncertain
-- publication is deliberately absent from this predicate.
create or replace function public.channel_work_item_can_retry_publication(
  p_owner_id uuid,
  p_work_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.channel_work_items as work
    where work.id = p_work_item_id
      and work.owner_id = p_owner_id
      and (
        work.status = 'draft_ready'
        or (
          work.status = 'failed'
          and work.retry_authorized_by = 'provider_rejection'
        )
      )
      and work.status <> 'publication_uncertain'
      and nullif(btrim(work.final_text), '') is not null
      and exists (
        select 1
        from public.active_connected_channel_selections as active
        join public.connected_youtube_channels as connected
          on connected.id = active.connected_channel_id
         and connected.owner_id = active.owner_id
         and connected.channel_id = active.channel_id
        join public.channel_oauth_grants as grant_record
          on grant_record.id = connected.oauth_grant_id
         and grant_record.owner_id = connected.owner_id
        where active.owner_id = work.owner_id
          and active.channel_id = work.channel_id
          and active.connected_channel_id = work.connected_channel_id
          and connected.oauth_grant_id = work.oauth_grant_id
          and connected.status = 'active'
          and connected.supported_creator is true
          and grant_record.status = 'active'
          and grant_record.write_scope_granted is true
      )
      and exists (
        select 1
        from public.user_subscriptions as subscription
        where subscription.user_id = work.owner_id
          and subscription.tier = 'pro'
      )
  );
$$;

revoke all on function public.channel_work_item_can_retry_publication(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.channel_work_item_can_retry_publication(uuid, uuid)
  to service_role;

-- Claim publication locally before #477's one provider write. The claim is
-- atomic, so a second caller cannot issue another write for the same item.
create or replace function public.channel_work_item_claim_publication(
  p_owner_id uuid,
  p_work_item_id uuid,
  p_current_comment_id text default null,
  p_current_comment_hash text default null,
  p_final_text_validated boolean default false,
  p_remaining_daily_publications integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  update public.channel_work_items as work
     set status = 'publishing',
         lifecycle_revision = work.lifecycle_revision + 1,
         updated_at = clock_timestamp()
   where work.id = p_work_item_id
     and work.owner_id = p_owner_id
     and public.channel_work_item_can_retry_publication(
       p_owner_id,
       p_work_item_id
     )
     and p_final_text_validated is true
     and p_remaining_daily_publications > 0
     and btrim(p_current_comment_id) = btrim(work.comment_id)
     and btrim(p_current_comment_hash) = btrim(work.comment_hash)
  returning work.id into claimed_id;

  if claimed_id is null then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'publication_claim_lost'
    );
  end if;

  return jsonb_build_object(
    'outcome', 'attempt_started',
    'workItemId', claimed_id
  );
end;
$$;

revoke all on function public.channel_work_item_claim_publication(
  uuid, uuid, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.channel_work_item_claim_publication(
  uuid, uuid, text, text, boolean, integer
)
  to service_role;

-- Apply the result of the one provider write. An ambiguous or malformed
-- completion is persisted as Publication Uncertain and is never retryable.
create or replace function public.channel_work_item_record_publication_completion(
  p_owner_id uuid,
  p_work_item_id uuid,
  p_outcome text,
  p_reason text default null,
  p_provider_reply_id text default null,
  p_published_text text default null,
  p_published_text_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  work_item record;
  saved_id uuid;
  failure_reason text := coalesce(
    nullif(btrim(p_reason), ''),
    'provider completion was ambiguous'
  );
begin
  if p_outcome not in ('accepted', 'rejected', 'ambiguous') then
    raise exception 'publication provider outcome is invalid'
      using errcode = '22023';
  end if;

  select *
    into work_item
  from public.channel_work_items
  where id = p_work_item_id
    and owner_id = p_owner_id
  for update;

  if work_item.id is null or work_item.status <> 'publishing' then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'publication_not_in_flight',
      'retryAllowed', false
    );
  end if;

  if p_outcome = 'ambiguous' then
    update public.channel_work_items
       set status = 'publication_uncertain',
           lifecycle_revision = lifecycle_revision + 1,
           publication_failure = left(failure_reason, 240),
           retry_authorized_by = null,
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Publication Uncertain state was not persisted';
    end if;

    return jsonb_build_object(
      'outcome', 'publication_uncertain',
      'retryAllowed', false,
      'completionReported', false
    );
  end if;

  if p_outcome = 'rejected' then
    update public.channel_work_items
       set status = 'failed',
           lifecycle_revision = lifecycle_revision + 1,
           publication_failure = left(failure_reason, 240),
           retry_authorized_by = 'provider_rejection',
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'provider rejection was not persisted';
    end if;

    return jsonb_build_object(
      'outcome', 'rejected',
      'retryAllowed', true,
      'completionReported', false
    );
  end if;

  -- An accepted result without a durable provider identity or text is not a
  -- verified publication. Keep it uncertain rather than inventing a receipt.
  if nullif(btrim(work_item.final_text), '') is null
    or nullif(btrim(p_provider_reply_id), '') is null
    or nullif(btrim(p_published_text), '') is null
  then
    update public.channel_work_items
       set status = 'publication_uncertain',
           lifecycle_revision = lifecycle_revision + 1,
           publication_failure = left(
             'accepted provider result was incomplete',
             240
           ),
           retry_authorized_by = null,
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'incomplete publication result was not persisted';
    end if;

    return jsonb_build_object(
      'outcome', 'publication_uncertain',
      'retryAllowed', false,
      'completionReported', false
    );
  end if;

  update public.channel_work_items
     set status = 'published',
         lifecycle_revision = lifecycle_revision + 1,
         provider_reply_id = btrim(p_provider_reply_id),
         published_text = work_item.final_text,
         published_text_hash = nullif(btrim(p_published_text_hash), ''),
         published_at = clock_timestamp(),
         last_observed_text = p_published_text,
         last_observed_text_hash = nullif(btrim(p_published_text_hash), ''),
         last_observed_at = clock_timestamp(),
         externally_edited = (
           p_published_text is distinct from work_item.final_text
         ),
         publication_failure = null,
         retry_authorized_by = null,
         deletion_status = 'not_requested',
         deletion_requested_at = null,
         deletion_completed_at = null,
         deletion_failure = null,
         updated_at = clock_timestamp()
   where id = work_item.id
     and owner_id = p_owner_id
  returning id into saved_id;

  if saved_id is null then
    raise exception 'published Public Reply was not persisted';
  end if;

  return jsonb_build_object(
    'outcome', 'published',
    'providerReplyId', btrim(p_provider_reply_id),
    'retryAllowed', false,
    'completionReported', true
  );
end;
$$;

revoke all on function public.channel_work_item_record_publication_completion(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.channel_work_item_record_publication_completion(
  uuid, uuid, text, text, text, text, text
) to service_role;

-- Reconcile only an uncertain publication. Presence and absence are distinct
-- verified states; all other observations remain uncertain and non-retryable.
create or replace function public.channel_work_item_reconcile_publication(
  p_owner_id uuid,
  p_work_item_id uuid,
  p_provider_state text,
  p_provider_reply_id text default null,
  p_observed_text text default null,
  p_observed_text_hash text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  work_item record;
  saved_id uuid;
  failure_reason text := coalesce(
    nullif(btrim(p_reason), ''),
    'provider recheck remained uncertain'
  );
begin
  select *
    into work_item
  from public.channel_work_items
  where id = p_work_item_id
    and owner_id = p_owner_id
  for update;

  if work_item.id is null then
    return jsonb_build_object('outcome', 'reply_not_found');
  end if;
  if work_item.status <> 'publication_uncertain' then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'reconciliation_not_required'
    );
  end if;
  if p_provider_state not in (
    'verified_presence',
    'verified_absence',
    'continued_uncertainty'
  ) then
    p_provider_state := 'continued_uncertainty';
    failure_reason := 'provider recheck response was invalid';
  end if;

  if p_provider_state = 'continued_uncertainty' then
    update public.channel_work_items
       set publication_failure = left(failure_reason, 240),
           lifecycle_revision = lifecycle_revision + 1,
           retry_authorized_by = null,
           last_observed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'continued uncertainty was not persisted';
    end if;
    return jsonb_build_object(
      'outcome', 'continued_uncertainty',
      'retryAllowed', false
    );
  end if;

  if p_provider_state = 'verified_absence' then
    if work_item.provider_reply_id is not null
      and btrim(p_provider_reply_id) <> btrim(work_item.provider_reply_id)
    then
      update public.channel_work_items
         set publication_failure = left(
               'provider absence did not match the uncertain reply',
               240
             ),
             lifecycle_revision = lifecycle_revision + 1,
             retry_authorized_by = null,
             last_observed_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where id = work_item.id
         and owner_id = p_owner_id
      returning id into saved_id;

      if saved_id is null then
        raise exception 'mismatched absence was not persisted';
      end if;
      return jsonb_build_object(
        'outcome', 'continued_uncertainty',
        'retryAllowed', false
      );
    end if;

    update public.channel_work_items
       set status = 'draft_ready',
           lifecycle_revision = lifecycle_revision + 1,
           provider_reply_id = null,
           published_text = null,
           published_text_hash = null,
           published_at = null,
           last_observed_text = null,
           last_observed_text_hash = null,
           last_observed_at = clock_timestamp(),
           externally_edited = false,
           publication_failure = null,
           retry_authorized_by = 'verified_absence',
           deletion_status = 'not_requested',
           deletion_requested_at = null,
           deletion_completed_at = null,
           deletion_failure = null,
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'verified absence was not persisted';
    end if;
    return jsonb_build_object(
      'outcome', 'verified_absence',
      'retryAllowed', true
    );
  end if;

  if nullif(btrim(p_provider_reply_id), '') is null
    or nullif(btrim(p_observed_text), '') is null
  then
    update public.channel_work_items
       set publication_failure = left(
             'verified presence response was incomplete',
             240
           ),
           lifecycle_revision = lifecycle_revision + 1,
           retry_authorized_by = null,
           last_observed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
  returning id into saved_id;

    if saved_id is null then
      raise exception 'incomplete presence was not persisted';
    end if;
    return jsonb_build_object(
      'outcome', 'continued_uncertainty',
      'retryAllowed', false
    );
  end if;

  update public.channel_work_items
     set status = 'published',
         lifecycle_revision = lifecycle_revision + 1,
         provider_reply_id = btrim(p_provider_reply_id),
         published_text = coalesce(
           nullif(work_item.published_text, ''),
           work_item.final_text
         ),
         published_text_hash = coalesce(
           work_item.published_text_hash,
           nullif(btrim(p_observed_text_hash), '')
         ),
         published_at = coalesce(work_item.published_at, clock_timestamp()),
         last_observed_text = p_observed_text,
         last_observed_text_hash = nullif(btrim(p_observed_text_hash), ''),
         last_observed_at = clock_timestamp(),
         externally_edited = coalesce(work_item.externally_edited, false)
           or p_observed_text is distinct from coalesce(
             nullif(work_item.published_text, ''),
             work_item.final_text
           ),
         publication_failure = null,
         retry_authorized_by = null,
         deletion_status = 'not_requested',
         deletion_requested_at = null,
         deletion_completed_at = null,
         deletion_failure = null,
         updated_at = clock_timestamp()
   where id = work_item.id
     and owner_id = p_owner_id
  returning id into saved_id;

  if saved_id is null then
    raise exception 'verified presence was not persisted';
  end if;
  return jsonb_build_object(
    'outcome', 'verified_presence',
    'providerReplyId', btrim(p_provider_reply_id),
    'currentText', p_observed_text,
    'externallyEdited', (
      p_observed_text is distinct from coalesce(
        nullif(work_item.published_text, ''),
        work_item.final_text
      )
    ),
    'retryAllowed', false
  );
end;
$$;

revoke all on function public.channel_work_item_reconcile_publication(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.channel_work_item_reconcile_publication(
  uuid, uuid, text, text, text, text, text
) to service_role;

-- Deletion is deliberately separate from publication allowance and does not
-- require Pro entitlement. The original active grant and refreshed provenance
-- are still required, including during the seven-day downgrade grace period.
create or replace function public.channel_work_item_prepare_reply_deletion(
  p_owner_id uuid,
  p_work_item_id uuid,
  p_confirmation boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prepared_id uuid;
begin
  if p_confirmation is not true then
    return jsonb_build_object(
      'outcome', 'confirmation_required',
      'completionReported', false
    );
  end if;

  update public.channel_work_items as work
     set deletion_status = 'in_progress',
         lifecycle_revision = work.lifecycle_revision + 1,
         deletion_requested_at = coalesce(
           work.deletion_requested_at,
           clock_timestamp()
         ),
         deletion_failure = null,
         updated_at = clock_timestamp()
    from public.connected_youtube_channels as connected
    join public.channel_oauth_grants as grant_record
      on grant_record.id = connected.oauth_grant_id
     and grant_record.owner_id = connected.owner_id
   where work.id = p_work_item_id
     and work.owner_id = p_owner_id
     and work.status = 'published'
     and nullif(btrim(work.provider_reply_id), '') is not null
     and work.deletion_status in ('not_requested', 'uncertain', 'failed')
     and connected.id = work.connected_channel_id
     and connected.owner_id = work.owner_id
     and connected.status = 'active'
     and grant_record.id = work.oauth_grant_id
     and grant_record.status = 'active'
     and grant_record.write_scope_granted is true
     and work.last_observed_at is not null
     and work.last_observed_at >= clock_timestamp() - interval '30 days'
  returning work.id into prepared_id;

  if prepared_id is null then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'deletion_authorization_required',
      'completionReported', false
    );
  end if;

  -- No publication allowance or publication counter is touched here.
  return jsonb_build_object(
    'outcome', 'deletion_started',
    'workItemId', prepared_id,
    'completionReported', false
  );
end;
$$;

revoke all on function public.channel_work_item_prepare_reply_deletion(
  uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.channel_work_item_prepare_reply_deletion(
  uuid, uuid, boolean
) to service_role;

-- A successful delete is reported only after a confirmed provider result and
-- the local terminal update are both complete. Verified absence is also a
-- safe terminal provider result; ambiguity remains retryable and visible.
create or replace function public.channel_work_item_complete_reply_deletion(
  p_owner_id uuid,
  p_work_item_id uuid,
  p_provider_outcome text,
  p_provider_reply_id text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  work_item record;
  saved_id uuid;
  failure_reason text := coalesce(
    nullif(btrim(p_reason), ''),
    'provider deletion remained uncertain'
  );
begin
  if p_provider_outcome not in (
    'confirmed',
    'verified_absence',
    'rejected',
    'ambiguous'
  ) then
    p_provider_outcome := 'ambiguous';
    failure_reason := 'provider deletion response was invalid';
  end if;

  select *
    into work_item
  from public.channel_work_items
  where id = p_work_item_id
    and owner_id = p_owner_id
  for update;

  if work_item.id is null then
    return jsonb_build_object(
      'outcome', 'reply_not_found',
      'completionReported', false
    );
  end if;
  if work_item.status = 'deleted'
    or work_item.deletion_status = 'completed'
  then
    return jsonb_build_object(
      'outcome', 'already_deleted',
      'completionReported', false
    );
  end if;
  if work_item.status <> 'published'
    or work_item.deletion_status <> 'in_progress'
  then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'deletion_in_progress',
      'completionReported', false
    );
  end if;

  if p_provider_outcome in ('ambiguous', 'rejected') then
    update public.channel_work_items
       set deletion_status = case
             when p_provider_outcome = 'rejected' then 'failed'
             else 'uncertain'
           end,
           lifecycle_revision = lifecycle_revision + 1,
           deletion_failure = left(failure_reason, 240),
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'deletion outcome was not persisted';
    end if;
    return jsonb_build_object(
      'outcome', case
        when p_provider_outcome = 'rejected' then 'deletion_failed'
        else 'deletion_uncertain'
      end,
      'completionReported', false,
      'retryAllowed', true
    );
  end if;

  if nullif(btrim(p_provider_reply_id), '') is null
    or btrim(p_provider_reply_id) <> btrim(work_item.provider_reply_id)
  then
    update public.channel_work_items
       set deletion_status = 'uncertain',
           lifecycle_revision = lifecycle_revision + 1,
           deletion_failure = left(
             'provider deletion identity did not match the published reply',
             240
           ),
           updated_at = clock_timestamp()
     where id = work_item.id
       and owner_id = p_owner_id
  returning id into saved_id;

    if saved_id is null then
      raise exception 'mismatched deletion was not persisted';
    end if;
    return jsonb_build_object(
      'outcome', 'deletion_uncertain',
      'completionReported', false,
      'retryAllowed', true
    );
  end if;

  update public.channel_work_items
     set status = 'deleted',
         lifecycle_revision = lifecycle_revision + 1,
         deletion_status = 'completed',
         deletion_completed_at = clock_timestamp(),
         deletion_failure = null,
         updated_at = clock_timestamp()
   where id = work_item.id
     and owner_id = p_owner_id
  returning id into saved_id;

  if saved_id is null then
    raise exception 'deleted Public Reply was not persisted';
  end if;

  -- Keep the provider identity and bounded provenance until policy cleanup;
  -- they are needed to explain the confirmed operation and are not a second
  -- publication allowance.
  return jsonb_build_object(
    'outcome', 'deleted',
    'completionReported', true,
    'retryAllowed', false
  );
end;
$$;

revoke all on function public.channel_work_item_complete_reply_deletion(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.channel_work_item_complete_reply_deletion(
  uuid, uuid, text, text, text
) to service_role;

notify pgrst, 'reload schema';
