-- Run after fresh or upgraded migrations. All data is rolled back.
begin;
insert into auth.users(id,is_anonymous) values
 ('98000000-0000-4000-8000-000000000001',false),
 ('98000000-0000-4000-8000-000000000002',false);
insert into public.projects(id,workspace_id,name)
select '98000000-0000-4000-8000-000000000003',id,'Seed oil research'
from public.workspaces where owner_id='98000000-0000-4000-8000-000000000001';
insert into public.project_source_sets(project_id,revision) values ('98000000-0000-4000-8000-000000000003',0);
insert into public.videos(id,youtube_url,url_hash,title,language)
values ('98000000-0000-4000-8000-000000000004','https://www.youtube.com/watch?v=seedOil0001','seedOil0001','Seed oil trial','en');
insert into public.video_transcripts(video_id,transcript_source,language,segments)
values ('98000000-0000-4000-8000-000000000004','manual_captions','en','[
 {"text":"The trial found no harm from seed oil","start":10,"duration":4},
 {"text":"but the sample was small","start":14,"duration":4},
 {"text":"and follow-up lasted only six months.","start":18,"duration":4}
]');
insert into public.summaries(video_id,summary,transcript_source,output_language)
values ('98000000-0000-4000-8000-000000000004','Research fixture','manual_captions',null);
insert into public.project_videos(project_id,video_id,position,status)
values ('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000004',1,'ready');

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","is_anonymous":false}',true);
do $$
declare result jsonb; literal jsonb; question jsonb;
begin
 result := public.search_project_research_passages('98000000-0000-4000-8000-000000000003','seed oil',10);
 if result ->> 'outcome' <> 'ready' or result #>> '{passages,0,text}' <>
  'The trial found no harm from seed oil but the sample was small and follow-up lasted only six months.'
  or result #>> '{passages,0,endSegmentOrdinal}' <> '3'
  or result -> 'sourceLanguages' <> '["en"]'::jsonb
 then raise exception 'Research must retain qualifiers in full context: %',result; end if;
 literal := public.search_project_transcript_passages('98000000-0000-4000-8000-000000000003','seed oil',10);
 if literal #>> '{passages,0,text}' <> 'The trial found no harm from seed oil'
 then raise exception 'Literal Search contract changed'; end if;
 if public.search_project_research_passages('98000000-0000-4000-8000-000000000003','种子油',10) -> 'sourceLanguages' <> '["en"]'::jsonb
 then raise exception 'No-match response must retain languages for query translation'; end if;
 question := public.start_project_grounded_question_v2(
  '98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000005',repeat('研究',1500),null,'question');
 if question ->> 'outcome' <> 'started' then raise exception 'Detailed research question rejected: %',question; end if;
 perform set_config('research.result',result::text,true);
 perform set_config('research.question',question::text,true);
end;
$$;

reset role;
do $$
declare r jsonb := current_setting('research.result')::jsonb; snapshot jsonb; tampered jsonb; manifest jsonb; coverage jsonb;
begin
 snapshot := jsonb_build_object('projectId','98000000-0000-4000-8000-000000000003','sourceSetRevision',r->'sourceSetRevision','passages',r->'passages');
 manifest := jsonb_build_object('projectId',snapshot->'projectId','sourceSetRevision',r->'sourceSetRevision','sources',jsonb_build_array(jsonb_build_object(
  'sourceId','S1','videoId',r#>'{passages,0,videoId}','youtubeVideoId',r#>'{passages,0,youtubeVideoId}',
  'title',r#>'{passages,0,title}','channelName',r#>'{passages,0,channelName}',
  'passages',jsonb_build_array(jsonb_build_object('passageId',r#>'{passages,0,passageId}','startSeconds',10,'endSeconds',22)))));
 coverage := (r->'coverage') || '{"usedVideos":1,"passagesUsed":1}'::jsonb;
 if not project_private.project_grounded_artifact_is_coherent_v2('98000000-0000-4000-8000-000000000003',(r->>'sourceSetRevision')::bigint,'supported',manifest,coverage,snapshot)
  or not project_private.project_grounded_artifact_matches_evidence_v2('98000000-0000-4000-8000-000000000003',manifest,coverage,snapshot)
 then raise exception 'Canonical context rejected by durable evidence validation'; end if;
 tampered := jsonb_set(snapshot,'{passages,0,text}','"Seed oil kills everyone."');
 if project_private.project_research_windows_match_evidence('98000000-0000-4000-8000-000000000003',tampered)
 then raise exception 'Invented context accepted'; end if;
 tampered := jsonb_set(snapshot,'{passages,0,endSegmentOrdinal}','2');
 if project_private.project_research_windows_match_evidence('98000000-0000-4000-8000-000000000003',tampered)
 then raise exception 'Missing qualification accepted'; end if;
 -- NULL usability must fail closed: bool_and otherwise ignores the invalid
 -- interior row while accepting the two usable endpoints.
 update public.video_transcripts
 set segments=jsonb_set(segments,'{1,duration}','null')
 where video_id='98000000-0000-4000-8000-000000000004';
 if project_private.project_research_windows_match_evidence('98000000-0000-4000-8000-000000000003',snapshot)
 then raise exception 'Context with invalid interior timing accepted'; end if;
 update public.video_transcripts
 set segments=jsonb_set(segments,'{1,duration}','4')
 where video_id='98000000-0000-4000-8000-000000000004';
 if not project_private.project_research_windows_match_evidence('98000000-0000-4000-8000-000000000003',snapshot)
 then raise exception 'Restored canonical context rejected'; end if;
 tampered := jsonb_set(snapshot,'{passages,0,title}','"A different source"');
 if project_private.project_research_windows_match_evidence('98000000-0000-4000-8000-000000000003',tampered)
 then raise exception 'Forged context metadata accepted'; end if;
 perform set_config('research.snapshot',snapshot::text,true);
 perform set_config('research.manifest',manifest::text,true);
 perform set_config('research.coverage',coverage::text,true);
end;
$$;
set local role service_role;
do $$
declare q jsonb := current_setting('research.question')::jsonb; result jsonb;
begin
 result := public.complete_project_grounded_answer_v2(
  '98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000003',
  (q->>'conversationId')::uuid,(q->>'userMessageId')::uuid,(q->>'attemptToken')::uuid,
  'The speaker describes a small, short trial; its limits matter [S1 @ 00:10].','supported',
  (current_setting('research.result')::jsonb->>'sourceSetRevision')::bigint,
  current_setting('research.manifest')::jsonb,current_setting('research.coverage')::jsonb,current_setting('research.snapshot')::jsonb,'question');
 if result->>'outcome' <> 'completed' then raise exception 'Context could not be persisted: %',result; end if;
end;
$$;

-- Nine strong hits from one video and one weaker hit from a second fill the
-- base top ten. Three more sources need supplementation. Prepending those
-- three and then truncating used to evict the second source at rank ten.
reset role;
update public.video_transcripts
set segments=(select jsonb_agg(jsonb_build_object(
 'text','seed oil seed oil seed oil seed oil seed oil.',
 'start',i*4,'duration',4) order by i) from generate_series(1,9) i)
where video_id='98000000-0000-4000-8000-000000000004';
insert into public.videos(id,youtube_url,url_hash,title,language)
select ('98000000-0000-4000-8000-'||lpad((i+4)::text,12,'0'))::uuid,
 'https://www.youtube.com/watch?v=seedOil000'||i,'seedOil000'||i,
 'Research perspective '||i,'en'
from generate_series(2,5) i;
insert into public.video_transcripts(video_id,transcript_source,language,segments)
select ('98000000-0000-4000-8000-'||lpad((i+4)::text,12,'0'))::uuid,
 'manual_captions','en',jsonb_build_array(jsonb_build_object(
  'text',case when i=2 then 'The seed oil research describes a controlled trial.'
    else 'The seed research describes another perspective.' end,
  'start',10,'duration',4))
from generate_series(2,5) i;
insert into public.summaries(video_id,summary,transcript_source,output_language)
select ('98000000-0000-4000-8000-'||lpad((i+4)::text,12,'0'))::uuid,
 'Research fixture','manual_captions',null
from generate_series(2,5) i;
insert into public.project_videos(project_id,video_id,position,status)
select '98000000-0000-4000-8000-000000000003',
 ('98000000-0000-4000-8000-'||lpad((i+4)::text,12,'0'))::uuid,i,'ready'
from generate_series(2,5) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","is_anonymous":false}',true);
do $$
declare result jsonb; used_sources integer;
begin
 result:=public.search_project_transcript_passages('98000000-0000-4000-8000-000000000003','seed oil',10);
 if jsonb_array_length(result->'passages')<>10
  or result#>>'{passages,9,videoId}'<>'98000000-0000-4000-8000-000000000006'
 then raise exception 'Source-balancing fixture does not exercise the top-ten boundary'; end if;
 result:=public.search_project_transcript_passages_balanced('98000000-0000-4000-8000-000000000003','seed oil',10);
 select count(distinct p->>'videoId') into used_sources from jsonb_array_elements(result->'passages')p;
 if used_sources<>5 then raise exception 'Supplementation evicted a matched source: expected 5, got %',used_sources; end if;
 result:=public.search_project_research_passages('98000000-0000-4000-8000-000000000003','seed oil',10);
 select count(distinct p->>'videoId') into used_sources from jsonb_array_elements(result->'passages')p;
 if used_sources<>5 then raise exception 'Context deduplication dropped a source: expected 5, got %',used_sources; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","is_anonymous":false}',true);
do $$
begin
 if public.search_project_research_passages('98000000-0000-4000-8000-000000000003','seed oil',10) <> '{"outcome":"missing"}'::jsonb
 then raise exception 'Another owner can read research context'; end if;
end;
$$;
rollback;
