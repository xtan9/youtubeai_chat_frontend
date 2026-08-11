-- Contract test for private, deterministic, bounded Project Transcript search.
-- Run after both legacy and fresh migration replays.

begin;

insert into auth.users (id, is_anonymous)
values
  ('71000000-0000-4000-8000-000000000001', false),
  ('72000000-0000-4000-8000-000000000002', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.user_subscriptions (
  user_id,
  stripe_customer_id,
  tier,
  status
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    'cus_project_search_owner',
    'pro',
    'active'
  )
on conflict (user_id) do update set
  tier = excluded.tier,
  status = excluded.status;

insert into public.projects (id, workspace_id, name)
select project_id, workspaces.id, project_name
from public.workspaces
cross join (values
  ('d1000000-0000-4000-8000-000000000001'::uuid, 'Mixed coverage'),
  ('d1000000-0000-4000-8000-000000000002'::uuid, 'Fully ready'),
  ('d1000000-0000-4000-8000-000000000003'::uuid, 'No ready evidence'),
  ('d1000000-0000-4000-8000-000000000005'::uuid, 'Five material sources')
) as fixture(project_id, project_name)
where workspaces.owner_id = '71000000-0000-4000-8000-000000000001';

insert into public.projects (id, workspace_id, name)
select 'd2000000-0000-4000-8000-000000000004', id, 'Foreign private Project'
from public.workspaces
where owner_id = '72000000-0000-4000-8000-000000000002';

insert into public.videos (
  id,
  youtube_url,
  url_hash,
  title,
  channel_name,
  language
)
values
  (
    '81000000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=aaaaaaa1001',
    'aaaaaaa1001',
    'Solar systems',
    'Evidence Lab',
    'en'
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    'https://youtu.be/bbbbbbb1002',
    'bbbbbbb1002',
    '气候研究',
    '研究频道',
    'zh'
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    'https://www.youtube.com/watch?v=ccccccc1003',
    'ccccccc1003',
    'Processing evidence',
    null,
    'en'
  ),
  (
    '84000000-0000-4000-8000-000000000004',
    'https://www.youtube.com/watch?v=ddddddd1004',
    'ddddddd1004',
    'Failed evidence',
    null,
    'en'
  ),
  (
    '85000000-0000-4000-8000-000000000005',
    'https://www.youtube.com/watch?v=eeeeeee1005',
    'eeeeeee1005',
    'Foreign secret title',
    'Foreign secret channel',
    'en'
  ),
  (
    '87000000-0000-4000-8000-000000000007',
    'https://www.youtube.com/watch?v=ggggggg1007',
    'ggggggg1007',
    'Negative timing readiness evidence',
    'Evidence Boundary Lab',
    'en'
  ),
  (
    '88000000-0000-4000-8000-000000000008',
    'https://www.youtube.com/watch?v=matrlsrc001',
    'matrlsrc001',
    'Material source one',
    'Readiness Lab',
    'en'
  ),
  (
    '89000000-0000-4000-8000-000000000009',
    'https://www.youtube.com/watch?v=matrlsrc002',
    'matrlsrc002',
    'Material source two',
    'Readiness Lab',
    'en'
  ),
  (
    '8a000000-0000-4000-8000-00000000000a',
    'https://www.youtube.com/watch?v=matrlsrc003',
    'matrlsrc003',
    'Material source three',
    'Readiness Lab',
    'en'
  ),
  (
    '8b000000-0000-4000-8000-00000000000b',
    'https://www.youtube.com/watch?v=matrlsrc004',
    'matrlsrc004',
    'Material source four',
    'Readiness Lab',
    'en'
  ),
  (
    '8c000000-0000-4000-8000-00000000000c',
    'https://www.youtube.com/watch?v=matrlsrc005',
    'matrlsrc005',
    'Material source five',
    'Readiness Lab',
    'en'
  );

insert into public.video_transcripts (
  video_id,
  transcript_source,
  language,
  segments
)
values
  (
    '81000000-0000-4000-8000-000000000001',
    'manual_captions',
    'en',
    (
      select pg_catalog.jsonb_agg(segment order by ordinal)
      from (
        values
          (1, pg_catalog.jsonb_build_object(
            'text', '   Solar solar solar evidence is repeated but stable.',
            'start', 42,
            'duration', 5
          )),
          (2, pg_catalog.jsonb_build_object(
            'text', 'Renewable energy improves resilience.',
            'start', 42,
            'duration', 4
          )),
          (3, pg_catalog.jsonb_build_object(
            'text',
              '  ' || repeat('x', 650) || ' '
              || pg_catalog.convert_from(
                pg_catalog.decode('636c696d61cc817469636f', 'hex'),
                'UTF8'
              )
              || ' evidence ' || repeat('y', 650),
            'start', 300,
            'duration', 30
          )),
          (24, pg_catalog.jsonb_build_object(
            'text', 'El análisis climático compara fuentes.',
            'start', 500,
            'duration', 4
          )),
          (25, pg_catalog.jsonb_build_object(
            'text', 'The witness said this plainly.',
            'start', 510,
            'duration', 4
          )),
          (26, pg_catalog.jsonb_build_object(
            'text', 'AI systems require evidence.',
            'start', 520,
            'duration', 4
          )),
          (27, pg_catalog.jsonb_build_object(
            'text', repeat(
              pg_catalog.convert_from(
                pg_catalog.decode('f0a0808b', 'hex'),
                'UTF8'
              ),
              600
            ),
            'start', 530,
            'duration', 4
          )),
          (28, pg_catalog.jsonb_build_object(
            'text', pg_catalog.convert_from(
              pg_catalog.decode(
                '636166c3a974657269612062696fc3a974696361',
                'hex'
              ),
              'UTF8'
            ),
            'start', 535,
            'duration', 4
          )),
          (29, pg_catalog.jsonb_build_object(
            'text', pg_catalog.convert_from(
              pg_catalog.decode('636166c3a920c3a974696361', 'hex'),
              'UTF8'
            ),
            'start', 538,
            'duration', 4
          )),
          (30, pg_catalog.jsonb_build_object(
            'text', repeat('a', 200000),
            'start', 540,
            'duration', 4
          )),
          (31, pg_catalog.jsonb_build_object(
            'text', 'Echo echo echo echo echo.',
            'start', 550,
            'duration', 4
          )),
          (32, pg_catalog.jsonb_build_object(
            'text', 'Echo echo echo echo echo echo echo.',
            'start', 560,
            'duration', 4
          ))
        union all
        select
          generated.ordinal,
          pg_catalog.jsonb_build_object(
            'text', 'Evidence passage number ' || generated.ordinal::text,
            'start', 400 + generated.ordinal,
            'duration', 3
          )
        from pg_catalog.generate_series(4, 23) as generated(ordinal)
      ) as segments(ordinal, segment)
    )
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    'manual_captions',
    'zh',
    '[{"text":"气候变化需要多种证据，气候政策必须比较来源。","start":42,"duration":6}]'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000005',
    'manual_captions',
    'en',
    '[{"text":"Foreign secret Transcript passage","start":42,"duration":5}]'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000007',
    'manual_captions',
    'en',
    '[{"text":"negative timing must never become a passage","start":-4,"duration":3},{"text":"huge numeric timestamp","start":1e1000,"duration":4},{"text":"non-finite timestamp","start":"NaN","duration":"Infinity"}]'::jsonb
  ),
  (
    '88000000-0000-4000-8000-000000000008',
    'manual_captions',
    'en',
    '[{"text":"Unrelated introduction one.","start":0,"duration":3},{"text":"Material launch evidence position one.","start":30,"duration":4}]'::jsonb
  ),
  (
    '89000000-0000-4000-8000-000000000009',
    'manual_captions',
    'en',
    '[{"text":"Unrelated introduction two.","start":0,"duration":3},{"text":"Material launch evidence position two.","start":60,"duration":4}]'::jsonb
  ),
  (
    '8a000000-0000-4000-8000-00000000000a',
    'manual_captions',
    'en',
    '[{"text":"Unrelated introduction three.","start":0,"duration":3},{"text":"Material launch evidence position three.","start":90,"duration":4}]'::jsonb
  ),
  (
    '8b000000-0000-4000-8000-00000000000b',
    'manual_captions',
    'en',
    '[{"text":"Unrelated introduction four.","start":0,"duration":3},{"text":"Material launch evidence position four.","start":120,"duration":4}]'::jsonb
  ),
  (
    '8c000000-0000-4000-8000-00000000000c',
    'manual_captions',
    'en',
    '[{"text":"Unrelated introduction five.","start":0,"duration":3},{"text":"Material launch evidence position five.","start":150,"duration":4}]'::jsonb
  );

insert into public.summaries (
  video_id,
  summary,
  transcript_source,
  output_language
)
values
  (
    '81000000-0000-4000-8000-000000000001',
    'Solar summary',
    'manual_captions',
    null
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '气候摘要',
    'manual_captions',
    null
  ),
  (
    '85000000-0000-4000-8000-000000000005',
    'Foreign summary',
    'manual_captions',
    null
  ),
  (
    '87000000-0000-4000-8000-000000000007',
    'Negative timing readiness summary',
    'manual_captions',
    null
  ),
  ('88000000-0000-4000-8000-000000000008', 'Material one', 'manual_captions', null),
  ('89000000-0000-4000-8000-000000000009', 'Material two', 'manual_captions', null),
  ('8a000000-0000-4000-8000-00000000000a', 'Material three', 'manual_captions', null),
  ('8b000000-0000-4000-8000-00000000000b', 'Material four', 'manual_captions', null),
  ('8c000000-0000-4000-8000-00000000000c', 'Material five', 'manual_captions', null);

insert into public.project_source_sets (project_id, revision)
values
  ('d1000000-0000-4000-8000-000000000001', 11),
  ('d1000000-0000-4000-8000-000000000002', 5),
  ('d1000000-0000-4000-8000-000000000003', 2),
  ('d1000000-0000-4000-8000-000000000005', 1),
  ('d2000000-0000-4000-8000-000000000004', 1);

insert into public.project_videos (
  project_id,
  video_id,
  position,
  status,
  failure_code,
  processing_attempt_id
)
values
  ('d1000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 1, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 2, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000003', 3, 'processing', null, '91000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000004', 4, 'failed', 'transcript_failed', null),
  ('d1000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000007', 5, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 1, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002', 2, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000003', 1, 'processing', null, '91000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000004', 2, 'failed', 'transcript_failed', null),
  ('d1000000-0000-4000-8000-000000000005', '88000000-0000-4000-8000-000000000008', 1, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000005', '89000000-0000-4000-8000-000000000009', 2, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000005', '8a000000-0000-4000-8000-00000000000a', 3, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000005', '8b000000-0000-4000-8000-00000000000b', 4, 'ready', null, null),
  ('d1000000-0000-4000-8000-000000000005', '8c000000-0000-4000-8000-00000000000c', 5, 'ready', null, null),
  ('d2000000-0000-4000-8000-000000000004', '85000000-0000-4000-8000-000000000005', 1, 'ready', null, null);

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.search_project_transcript_passages(uuid,text,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.search_project_transcript_passages(uuid,text,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.search_project_transcript_passages(uuid,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Search grants are not least privilege';
  end if;

  if has_function_privilege(
    'authenticated',
    'project_private.safe_transcript_seconds(jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'project_private.raw_position_for_normalized_position(text,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'project_private.is_boundaryless_search_character(text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'project_private.literal_term_summary(text,text)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Search private helpers are executable by clients';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.search_project_transcript_passages(uuid,text,integer)'::regprocedure
      and prosecdef
      and provolatile = 's'
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: Project Search function is not hardened and stable';
  end if;

  if project_private.safe_transcript_seconds('1e1000'::jsonb) is not null
    or project_private.safe_transcript_seconds('"NaN"'::jsonb) is not null
    or project_private.safe_transcript_seconds('-4'::jsonb) is distinct from -4
    or (select occurrence_count from project_private.literal_term_summary('said', 'ai')) <> 0
    or (select occurrence_count from project_private.literal_term_summary('ai!', 'ai')) <> 1
    or (select first_position from project_private.literal_term_summary('ai!', 'ai')) <> 1
    or (select occurrence_count from project_private.literal_term_summary(
      pg_catalog.convert_from(
        pg_catalog.decode('636166c3a97465726961', 'hex'),
        'UTF8'
      ),
      pg_catalog.convert_from(
        pg_catalog.decode('636166c3a9', 'hex'),
        'UTF8'
      )
    )) <> 0
    or (select occurrence_count from project_private.literal_term_summary(
      pg_catalog.convert_from(
        pg_catalog.decode('62696fc3a974696361', 'hex'),
        'UTF8'
      ),
      pg_catalog.convert_from(
        pg_catalog.decode('c3a974696361', 'hex'),
        'UTF8'
      )
    )) <> 0
    or (select occurrence_count from project_private.literal_term_summary(
      pg_catalog.convert_from(
        pg_catalog.decode('ceb2ceb9cebfceb7ceb8ceb9cebaceae', 'hex'),
        'UTF8'
      ),
      pg_catalog.convert_from(
        pg_catalog.decode('ceb7ceb8ceb9cebaceae', 'hex'),
        'UTF8'
      )
    )) <> 0
    or (select occurrence_count from project_private.literal_term_summary(
      pg_catalog.convert_from(
        pg_catalog.decode('ceb7ceb8ceb9cebaceae21', 'hex'),
        'UTF8'
      ),
      pg_catalog.convert_from(
        pg_catalog.decode('ceb7ceb8ceb9cebaceae', 'hex'),
        'UTF8'
      )
    )) <> 1
    or (select occurrence_count from project_private.literal_term_summary(
      pg_catalog.convert_from(
        pg_catalog.decode('e6b094e58099e58f98e58c96', 'hex'),
        'UTF8'
      ),
      pg_catalog.convert_from(
        pg_catalog.decode('e6b094e58099', 'hex'),
        'UTF8'
      )
    )) <> 1
    or (select occurrence_count from project_private.literal_term_summary(
      'echo echo echo echo echo echo echo',
      'echo'
    )) <> 5
    or project_private.raw_position_for_normalized_position(
      'x' || pg_catalog.convert_from(
        pg_catalog.decode('61cc81', 'hex'),
        'UTF8'
      ) || 'b',
      3
    ) <> 4
  then
    raise exception 'REGRESSION: Project Search private helper semantics drifted';
  end if;

  if (
    select pg_catalog.array_agg(
      namespaces.nspname || '.' || procedures.proname
      order by namespaces.nspname, procedures.proname
    )
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where procedures.oid <>
      'project_private.safe_transcript_seconds(jsonb)'::regprocedure
      and procedures.prosrc like '%project_private.safe_transcript_seconds(%'
  ) is distinct from array[
    'project_private.project_grounded_live_source_projection_v2',
    'public.search_project_transcript_passages',
    'public.search_project_transcript_passages_balanced'
  ]::text[] then
    raise exception 'REGRESSION: safe Transcript timing gained an unaudited function consumer';
  end if;
end;
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  result jsonb;
  repeated_result jsonb;
  astral_character text;
  cafe_query text;
  decomposed_query text;
  ethics_query text;
  long_text text;
  raw_long_text text;
begin
  astral_character := pg_catalog.convert_from(
    pg_catalog.decode('f0a0808b', 'hex'),
    'UTF8'
  );
  cafe_query := pg_catalog.convert_from(
    pg_catalog.decode('636166c3a9', 'hex'),
    'UTF8'
  );
  decomposed_query := pg_catalog.convert_from(
    pg_catalog.decode('636c696d61cc817469636f', 'hex'),
    'UTF8'
  );
  ethics_query := pg_catalog.convert_from(
    pg_catalog.decode('c3a974696361', 'hex'),
    'UTF8'
  );
  raw_long_text := '  ' || repeat('x', 650) || ' '
    || decomposed_query || ' evidence ' || repeat('y', 650);

  result := public.search_project_transcript_passages_balanced(
    'd1000000-0000-4000-8000-000000000005',
    'material launch',
    8
  );

  if result ->> 'outcome' <> 'ready'
    or (result #>> '{coverage,totalVideos}')::integer <> 5
    or (result #>> '{coverage,readyVideos}')::integer <> 5
    or pg_catalog.jsonb_array_length(result -> 'passages') <> 5
    or (
      select pg_catalog.array_agg(
        passage.item ->> 'videoId'
        order by passage.item ->> 'videoId'
      )
      from pg_catalog.jsonb_array_elements(result -> 'passages') as passage(item)
    ) is distinct from array[
      '88000000-0000-4000-8000-000000000008',
      '89000000-0000-4000-8000-000000000009',
      '8a000000-0000-4000-8000-00000000000a',
      '8b000000-0000-4000-8000-00000000000b',
      '8c000000-0000-4000-8000-00000000000c'
    ]::text[]
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(result -> 'passages') as passage(item)
      where passage.item ->> 'text' not like 'Material launch%'
    )
  then
    raise exception 'REGRESSION: balanced five-source material retrieval drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'solar',
    8
  );

  if result ->> 'outcome' <> 'ready'
    or (result ->> 'sourceSetRevision')::integer <> 11
    or (result #>> '{coverage,totalVideos}')::integer <> 5
    or (result #>> '{coverage,readyVideos}')::integer <> 3
    or (result #>> '{coverage,passagesExamined}')::integer <> 33
    or pg_catalog.jsonb_array_length(result #> '{coverage,unavailableVideos}') <> 2
    or result #>> '{passages,0,videoId}' <> '81000000-0000-4000-8000-000000000001'
    or result #>> '{passages,0,youtubeVideoId}' <> 'aaaaaaa1001'
    or (result #>> '{passages,0,startSeconds}')::numeric <> 42
    or result #>> '{passages,0,text}' <> '   Solar solar solar evidence is repeated but stable.'
    or (result #>> '{passages,0,excerptStartCharacter}')::integer <> 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(result -> 'passages') as passage(item)
      where passage.item ->> 'videoId' = '87000000-0000-4000-8000-000000000007'
        or (passage.item ->> 'startSeconds')::numeric < 0
        or (
          passage.item -> 'endSeconds' <> 'null'::jsonb
          and (passage.item ->> 'endSeconds')::numeric < 0
        )
    )
  then
    raise exception 'REGRESSION: owner Search identity, coverage, or exact text drifted: %', result;
  end if;

  repeated_result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'solar solar solar',
    8
  );
  if result -> 'passages' is distinct from repeated_result -> 'passages' then
    raise exception 'REGRESSION: repeated equivalent terms changed stable results';
  end if;

  repeated_result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'solar, solar!!!',
    8
  );
  if result -> 'passages' is distinct from repeated_result -> 'passages' then
    raise exception 'REGRESSION: punctuation/repeated equivalent terms changed stable results';
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'ai',
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(result -> 'passages') <> 1
    or result #>> '{passages,0,text}' <> 'AI systems require evidence.'
  then
    raise exception 'REGRESSION: ASCII word boundaries admitted a substring collision: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'aid',
    8
  );
  if result ->> 'outcome' <> 'no_results' then
    raise exception 'REGRESSION: irrelevant ASCII substring retrieval drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    cafe_query,
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(result -> 'passages') <> 1
    or (result #>> '{passages,0,segmentOrdinal}')::integer <> 29
  then
    raise exception 'REGRESSION: accented Latin suffix boundary drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    ethics_query,
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(result -> 'passages') <> 1
    or (result #>> '{passages,0,segmentOrdinal}')::integer <> 29
  then
    raise exception 'REGRESSION: accented Latin prefix boundary drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'echo',
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(result -> 'passages') <> 2
    or (result #>> '{passages,0,segmentOrdinal}')::integer <> 31
    or (result #>> '{passages,1,segmentOrdinal}')::integer <> 32
  then
    raise exception 'REGRESSION: repeated valid-term cap changed ranking: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    repeat(astral_character, 2),
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.char_length(result #>> '{passages,0,text}') <> 600
    or result #>> '{passages,0,text}' <> repeat(astral_character, 600)
    or (result #>> '{passages,0,excerptEndCharacter}')::integer <> 600
  then
    raise exception 'REGRESSION: non-BMP 600-code-point passage bound drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    repeat(astral_character, 200),
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.char_length(result #>> '{passages,0,text}') <> 600
  then
    raise exception 'REGRESSION: valid 200-code-point non-BMP query was rejected: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    repeat(astral_character, 201),
    8
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: 201-code-point non-BMP query was accepted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'neutrino',
    8
  );
  if result ->> 'outcome' <> 'no_results'
    or pg_catalog.jsonb_array_length(result -> 'passages') <> 0
    or pg_catalog.jsonb_array_length(result #> '{coverage,unavailableVideos}') <> 2
  then
    raise exception 'REGRESSION: partial-coverage no-results classification drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000002',
    'neutrino',
    8
  );
  if result ->> 'outcome' <> 'no_results'
    or pg_catalog.jsonb_array_length(result #> '{coverage,unavailableVideos}') <> 0
  then
    raise exception 'REGRESSION: fully-ready no-results classification drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000003',
    'evidence',
    8
  );
  if result ->> 'outcome' <> 'not_ready'
    or (result #>> '{coverage,readyVideos}')::integer <> 0
    or pg_catalog.jsonb_array_length(result #> '{coverage,unavailableVideos}') <> 2
  then
    raise exception 'REGRESSION: no-ready classification drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    '气候',
    8
  );
  if result ->> 'outcome' <> 'ready'
    or result #>> '{passages,0,language}' <> 'zh'
    or result #>> '{passages,0,youtubeVideoId}' <> 'bbbbbbb1002'
    or pg_catalog.strpos(result #>> '{passages,0,text}', '气候') = 0
  then
    raise exception 'REGRESSION: multilingual literal retrieval drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    decomposed_query,
    8
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.strpos(
      pg_catalog.normalize(result #>> '{passages,0,text}', 'NFC'),
      pg_catalog.convert_from(
        pg_catalog.decode('636c696dc3a17469636f', 'hex'),
        'UTF8'
      )
    ) = 0
  then
    raise exception 'REGRESSION: Unicode-normalized multilingual retrieval drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    decomposed_query || ' evidence',
    8
  );
  long_text := result #>> '{passages,0,text}';
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.char_length(long_text) <> 600
    or (result #>> '{passages,0,truncatedStart}')::boolean is not true
    or (result #>> '{passages,0,truncatedEnd}')::boolean is not true
    or pg_catalog.strpos(long_text, decomposed_query || ' evidence') = 0
    or (
      (result #>> '{passages,0,excerptEndCharacter}')::integer
      - (result #>> '{passages,0,excerptStartCharacter}')::integer
    ) <> pg_catalog.char_length(long_text)
    or pg_catalog.substr(
      raw_long_text,
      (result #>> '{passages,0,excerptStartCharacter}')::integer + 1,
      600
    ) <> long_text
  then
    raise exception 'REGRESSION: bounded exact long excerpt identity drifted: %', result;
  end if;

  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'evidence',
    8
  );
  if pg_catalog.jsonb_array_length(result -> 'passages') <> 8 then
    raise exception 'REGRESSION: Project Search result bound drifted: %', result;
  end if;

  if result is distinct from public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'evidence',
    8
  ) then
    raise exception 'REGRESSION: equivalent Search ordering is unstable';
  end if;
end;
$$;

-- This is deliberately a separate statement so statement_timeout starts its
-- timer before the SECURITY DEFINER search executes.
set local statement_timeout = '1000ms';
do $$
declare
  result jsonb;
begin
  result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'aa',
    8
  );
  if result ->> 'outcome' <> 'no_results' then
    raise exception 'REGRESSION: bounded repetitive search admitted an alnum collision: %', result;
  end if;
end;
$$;
set local statement_timeout = '0';

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '72000000-0000-4000-8000-000000000002',
  true
);

do $$
declare
  foreign_result jsonb;
  absent_result jsonb;
  free_owner_result jsonb;
begin
  foreign_result := public.search_project_transcript_passages(
    'd1000000-0000-4000-8000-000000000001',
    'secret',
    8
  );
  absent_result := public.search_project_transcript_passages(
    'd9000000-0000-4000-8000-000000000009',
    'secret',
    8
  );
  if foreign_result is distinct from absent_result
    or foreign_result <> '{"outcome":"missing"}'::jsonb
    or foreign_result::text ~ 'Foreign|secret|revision|coverage|passage'
  then
    raise exception 'REGRESSION: foreign Project existence oracle leaked: %, %', foreign_result, absent_result;
  end if;

  free_owner_result := public.search_project_transcript_passages(
    'd2000000-0000-4000-8000-000000000004',
    'foreign',
    8
  );
  if free_owner_result ->> 'outcome' <> 'ready'
    or free_owner_result #>> '{passages,0,text}' <> 'Foreign secret Transcript passage'
  then
    raise exception 'REGRESSION: Free Researcher did not receive unmetered owned Project Search: %', free_owner_result;
  end if;
end;
$$;

reset role;
rollback;
