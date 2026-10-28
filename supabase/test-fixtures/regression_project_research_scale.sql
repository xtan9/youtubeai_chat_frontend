-- Exercise the real research boundary with a five-video, 5,000-segment
-- project. Keep the same per-statement deadline as hosted authenticated RPCs.
begin;
insert into auth.users(id,is_anonymous) values
 ('97000000-0000-4000-8000-000000000001',false),
 ('97000000-0000-4000-8000-000000000002',false);
insert into public.projects(id,workspace_id,name)
select '97000000-0000-4000-8000-000000000003',id,'Large research fixture'
from public.workspaces where owner_id='97000000-0000-4000-8000-000000000001';
insert into public.project_source_sets(project_id,revision)
values ('97000000-0000-4000-8000-000000000003',0);
insert into public.videos(id,youtube_url,url_hash,title,language)
select ('97000000-0000-4000-8000-'||lpad((i+3)::text,12,'0'))::uuid,
 'https://www.youtube.com/watch?v=scaleOil00'||i,'scaleOil00'||i,
 'Research source '||i,case when i=1 then 'zh' else 'en' end
from generate_series(1,5) i;
insert into public.video_transcripts(video_id,transcript_source,language,segments)
select ('97000000-0000-4000-8000-'||lpad((i+3)::text,12,'0'))::uuid,
 'manual_captions',case when i=1 then 'zh' else 'en' end,
 (select jsonb_agg(jsonb_build_object(
   'text','Seed oil study '||n||' discusses evidence, limitations, and the need for controlled human trials.',
   'start',n*4,'duration',4) order by n) from generate_series(1,1000) n)
from generate_series(1,5) i;
insert into public.summaries(video_id,summary,transcript_source,output_language)
select ('97000000-0000-4000-8000-'||lpad((i+3)::text,12,'0'))::uuid,
 'Scale fixture','manual_captions',null from generate_series(1,5) i;
insert into public.project_videos(project_id,video_id,position,status)
select '97000000-0000-4000-8000-000000000003',
 ('97000000-0000-4000-8000-'||lpad((i+3)::text,12,'0'))::uuid,i,'ready'
from generate_series(1,5) i;

set local statement_timeout='8s';
set local track_functions='all';
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","is_anonymous":false}',true);
do $$
declare result jsonb; ready_before bigint; ready_after bigint;
begin
 select coalesce(sum(calls),0) into ready_before from pg_stat_xact_user_functions
 where funcid='project_private.video_has_durable_ready_evidence(uuid)'::regprocedure;
 result:=public.search_project_research_passages('97000000-0000-4000-8000-000000000003','种子油的证据',10);
 select coalesce(sum(calls),0) into ready_after from pg_stat_xact_user_functions
 where funcid='project_private.video_has_durable_ready_evidence(uuid)'::regprocedure;
 -- Bound work by sources, not transcript length, independently of CI speed.
 if ready_after-ready_before>50 then
   raise exception 'Readiness repeated per transcript segment: % calls',ready_after-ready_before;
 end if;
 if result->>'outcome'<>'no_results'
   or result->'sourceLanguages'<>'["en","zh"]'::jsonb
   or jsonb_array_length(result->'sourceTitles')<>5
   or result#>>'{coverage,passagesExamined}'<>'5000'
 then raise exception 'Large no-match research lost ready source metadata or coverage'; end if;
end;
$$;
do $$
declare result jsonb; source_count integer; windows_before bigint; windows_after bigint;
begin
 select coalesce(sum(calls),0) into windows_before from pg_stat_xact_user_functions
 where funcid='project_private.project_research_context_window(uuid,uuid,bigint)'::regprocedure;
 result:=public.search_project_research_passages('97000000-0000-4000-8000-000000000003','seed oil',10);
 select coalesce(sum(calls),0) into windows_after from pg_stat_xact_user_functions
 where funcid='project_private.project_research_context_window(uuid,uuid,bigint)'::regprocedure;
 if windows_after-windows_before>10 then
   raise exception 'Research recomputed contextual windows: % calls',windows_after-windows_before;
 end if;
 select count(distinct p->>'videoId') into source_count from jsonb_array_elements(result->'passages')p;
 if result->>'outcome'<>'ready' or source_count<>5
   or result#>>'{coverage,passagesExamined}'<>'5000'
 then raise exception 'Large research lost balanced sources or exact coverage'; end if;
 perform set_config('research.scale_result',result::text,true);
end;
$$;
reset role;
do $$
declare result jsonb:=current_setting('research.scale_result')::jsonb; rows bigint;
 ready_before bigint; ready_after bigint;
begin
 select coalesce(sum(calls),0) into ready_before from pg_stat_xact_user_functions
 where funcid='project_private.video_has_durable_ready_evidence(uuid)'::regprocedure;
 select count(*) into rows from project_private.project_grounded_live_source_projection_v2(
  '97000000-0000-4000-8000-000000000003') where is_ready and segment_is_usable;
 if rows<>5000 or not project_private.project_research_windows_match_evidence(
  '97000000-0000-4000-8000-000000000003',jsonb_build_object(
   'projectId','97000000-0000-4000-8000-000000000003',
   'sourceSetRevision',result->'sourceSetRevision','passages',result->'passages'))
 then raise exception 'Large contextual evidence could not be validated'; end if;
 select coalesce(sum(calls),0) into ready_after from pg_stat_xact_user_functions
 where funcid='project_private.video_has_durable_ready_evidence(uuid)'::regprocedure;
 if ready_after-ready_before>50 then
   raise exception 'Evidence validation repeated readiness per segment: % calls',ready_after-ready_before;
 end if;
end;
$$;

-- Metadata must follow the base search's readiness decision, even when a
-- membership still says ready but its durable evidence is absent.
delete from public.summaries where video_id='97000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
declare result jsonb;
begin
 result:=public.search_project_research_passages('97000000-0000-4000-8000-000000000003','种子油的证据',10);
 if result->'sourceLanguages'<>'["en"]'::jsonb
   or result->'sourceTitles' ? 'Research source 1'
   or jsonb_array_length(result->'sourceTitles')<>4
   or result#>>'{coverage,readyVideos}'<>'4'
 then raise exception 'Research metadata leaked a source without ready evidence'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","is_anonymous":false}',true);
do $$
begin
 if public.search_project_research_passages('97000000-0000-4000-8000-000000000003','seed oil',10)<>'{"outcome":"missing"}'::jsonb
 then raise exception 'Research metadata exposed another owner''s project'; end if;
end;
$$;
rollback;
