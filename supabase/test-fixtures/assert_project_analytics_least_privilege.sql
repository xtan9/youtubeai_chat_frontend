-- Each Project analytics migration must leave every object introduced so far
-- at its final least-privilege boundary. Safe to run after every ordered step.

do $$
declare
  relation_oid oid;
  function_oid oid;
  principal text;
  privilege text;
  signature text;
  row_security_enabled boolean;
begin
  foreach signature in array array[
    'public.project_analytics_state',
    'public.project_activation_outbox',
    'public.project_generation_usage',
    'public.project_message_analytics_ordinals',
    'public.project_answer_feedback'
  ] loop
    relation_oid := to_regclass(signature);
    if relation_oid is null then continue; end if;

    select relrowsecurity into row_security_enabled
    from pg_class
    where oid = relation_oid;
    if not coalesce(row_security_enabled, false) then
      raise exception 'REGRESSION: analytics table % does not have RLS enabled', signature;
    end if;

    foreach principal in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] loop
        if has_table_privilege(principal, relation_oid, privilege) then
          raise exception 'REGRESSION: % retains % on analytics table %',
            principal, privilege, signature;
        end if;
      end loop;
    end loop;
  end loop;

  foreach signature in array array[
    'public.record_project_analytics_transition(uuid,uuid,text,timestamptz)',
    'public.claim_project_activation_exports(integer)',
    'public.ack_project_activation_export(uuid,bigint,uuid)',
    'public.record_project_generation_usage(uuid,uuid,uuid,text,text,text,text,bigint,bigint,bigint,bigint,integer,text,text,date,text)',
    'public.record_project_activated_generation_usage(uuid,uuid,uuid,text,text,text,text,bigint,bigint,bigint,bigint,integer,text,text,date,text,text,timestamptz)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then continue; end if;
    if has_function_privilege('anon', function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or not has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'REGRESSION: service-only analytics RPC boundary is wrong for %', signature;
    end if;
  end loop;

  foreach signature in array array[
    'project_private.stamp_project_message_analytics_ordinal()',
    'project_private.with_project_message_analytics_ordinal(jsonb)',
    'public.start_project_grounded_question_v2_before_analytics(uuid,uuid,text,uuid,text)',
    'public.load_project_conversation_page_v2_before_analytics(uuid,uuid,timestamptz,uuid,integer)',
    'public.load_project_grounded_attempt_v2_before_analytics(uuid,uuid,uuid)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then continue; end if;
    if has_function_privilege('anon', function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'REGRESSION: private analytics helper remains callable: %', signature;
    end if;
  end loop;

  foreach signature in array array[
    'public.start_project_grounded_question_v2(uuid,uuid,text,uuid,text)',
    'public.load_project_conversation_page_v2(uuid,uuid,timestamptz,uuid,integer)',
    'public.load_project_grounded_attempt_v2(uuid,uuid,uuid)',
    'public.record_project_answer_feedback(uuid,uuid,text)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then continue; end if;
    if has_function_privilege('anon', function_oid, 'EXECUTE')
      or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'REGRESSION: authenticated analytics wrapper boundary is wrong for %', signature;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'project_analytics_state',
        'project_activation_outbox',
        'project_generation_usage',
        'project_message_analytics_ordinals',
        'project_answer_feedback'
      )
      and column_name in (
        'project_name', 'project_goal', 'video_title', 'youtube_url', 'query',
        'prompt', 'answer', 'transcript', 'artifact_content', 'content'
      )
  ) then
    raise exception 'REGRESSION: Project analytics table contains a prohibited content column';
  end if;
end;
$$;

begin;
set local role service_role;

do $$
declare
  relation_name text;
  operation text;
  denied boolean;
begin
  foreach relation_name in array array[
    'public.project_analytics_state',
    'public.project_activation_outbox',
    'public.project_generation_usage',
    'public.project_message_analytics_ordinals',
    'public.project_answer_feedback'
  ] loop
    if to_regclass(relation_name) is null then continue; end if;

    foreach operation in array array[
      'select', 'insert', 'update', 'delete'
    ] loop
      denied := false;
      begin
        case operation
          when 'select' then
            execute format('select 1 from %s limit 0', relation_name);
          when 'insert' then
            execute format('insert into %s default values', relation_name);
          when 'update' then
            execute format(
              'update %s set project_id = project_id where false',
              relation_name
            );
          when 'delete' then
            execute format('delete from %s where false', relation_name);
        end case;
      exception when insufficient_privilege then
        denied := true;
      end;
      if not denied then
        raise exception 'REGRESSION: service_role direct % succeeded on %',
          operation, relation_name;
      end if;
    end loop;
  end loop;
end;
$$;

rollback;
