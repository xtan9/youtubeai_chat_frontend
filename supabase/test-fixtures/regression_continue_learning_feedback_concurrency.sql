-- Continue Learning feedback upsert race (Issue #354).
--
-- Two independent database sessions submit the same learner/token judgment at
-- once. The private primary key and row lock must leave exactly one current
-- decision, with one `recorded` response and the rest idempotent.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;

delete from catalog_private.continue_learning_feedback
where learner_id = '35400000-0000-0000-0000-000000000003';
delete from catalog_private.continue_learning_token_bindings
where learner_id = '35400000-0000-0000-0000-000000000003';
delete from auth.users
where id = '35400000-0000-0000-0000-000000000003';

insert into auth.users (id, is_anonymous)
values ('35400000-0000-0000-0000-000000000003', false);

insert into catalog_private.continue_learning_token_bindings (
  token_hash,
  learner_id,
  recommendation_set_id,
  recommendation_ordinal
) values (
  encode(extensions.digest('cl1.' || repeat('b', 43), 'sha256'), 'hex'),
  '35400000-0000-0000-0000-000000000003',
  '35400000-0000-0000-0000-000000000103',
  2
);

do $race$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=postgres password=postgres',
    current_database()
  );
  connection_names text[] := array[
    'continue_learning_feedback_race_1',
    'continue_learning_feedback_race_2',
    'continue_learning_feedback_race_3',
    'continue_learning_feedback_race_4'
  ];
  completed_connections text[] := array[]::text[];
  connection_name text;
  result jsonb;
  recorded_count integer := 0;
  deduplicated_count integer := 0;
  pending_count integer := array_length(connection_names, 1);
  progress boolean;
begin
  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'begin');
    perform extensions.dblink_send_query(
      connection_name,
      $$
        select catalog_private.record_continue_learning_feedback(
          '35400000-0000-0000-0000-000000000003'::uuid,
          'cl1.' || repeat('b', 43),
          'not_useful'
        )
      $$
    );
  end loop;

  -- A blocked session can sit behind the winner's open transaction. Poll for
  -- whichever connection finishes first, commit it, then let the next waiter
  -- proceed; fetching connections in a fixed order would deadlock the race.
  while pending_count > 0 loop
    progress := false;
    foreach connection_name in array connection_names loop
      if connection_name = any(completed_connections) then
        continue;
      end if;
      if extensions.dblink_is_busy(connection_name) = 0 then
        select result_row.result
        into result
        from extensions.dblink_get_result(connection_name)
          as result_row(result jsonb);
        perform cleared_row.result
        from extensions.dblink_get_result(connection_name)
          as cleared_row(result jsonb);
        if result->>'outcome' = 'recorded' then
          recorded_count := recorded_count + 1;
        elsif result->>'outcome' = 'deduplicated' then
          deduplicated_count := deduplicated_count + 1;
        else
          raise exception 'feedback race returned an unsafe result: %', result;
        end if;
        perform extensions.dblink_exec(connection_name, 'commit');
        perform extensions.dblink_disconnect(connection_name);
        completed_connections := array_append(
          completed_connections, connection_name
        );
        pending_count := pending_count - 1;
        progress := true;
      end if;
    end loop;
    if not progress then
      perform pg_sleep(0.05);
    end if;
  end loop;

  if recorded_count <> 1
    or recorded_count + deduplicated_count <> array_length(connection_names, 1)
  then
    raise exception
      'feedback race did not converge to one durable write: recorded %, deduplicated %',
      recorded_count, deduplicated_count;
  end if;
end;
$race$;

do $assert$
declare
  feedback_count integer;
  durable_judgment text;
begin
  select count(*)::integer, min(judgment)
  into feedback_count, durable_judgment
  from catalog_private.continue_learning_feedback
  where learner_id = '35400000-0000-0000-0000-000000000003';
  if feedback_count <> 1 or durable_judgment <> 'not_useful' then
    raise exception 'feedback race left an invalid durable row: %, %',
      feedback_count, durable_judgment;
  end if;
end;
$assert$;

delete from catalog_private.continue_learning_feedback
where learner_id = '35400000-0000-0000-0000-000000000003';
delete from catalog_private.continue_learning_token_bindings
where learner_id = '35400000-0000-0000-0000-000000000003';
delete from auth.users
where id = '35400000-0000-0000-0000-000000000003';
