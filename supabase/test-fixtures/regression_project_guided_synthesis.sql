-- Issue #321 contract fixture. Run after the Project Conversation migrations
-- on both a legacy replay and a fresh schema.

begin;

do $$
declare
  mode_default text;
begin
  if to_regclass('public.project_conversation_messages') is null
    or to_regprocedure('public.start_project_grounded_question(uuid,text,uuid,text)') is null
    or to_regprocedure('public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text)') is null
  then
    raise exception 'REGRESSION: guided Project Conversation RPC seams are missing';
  end if;

  select column_default
  into mode_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'project_conversation_messages'
    and column_name = 'analysis_mode';

  if mode_default <> '''question''::text' then
    raise exception 'REGRESSION: guided mode default drifted: %', mode_default;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_conversation_messages'::regclass
      and conname = 'project_conversation_messages_analysis_mode_check'
  ) then
    raise exception 'REGRESSION: guided mode constraint is missing';
  end if;
end;
$$;

rollback;
