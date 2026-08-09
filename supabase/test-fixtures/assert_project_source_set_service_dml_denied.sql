-- Run after every migration during legacy and fresh replays. Once either
-- Source Set table exists, service_role must never gain direct mutation
-- privileges that could bypass revision-aware RPCs.

-- Model Supabase's permissive service defaults before later Source Set tables
-- are created. Their own creation migrations must explicitly start closed.
alter default privileges in schema public
  grant insert, update, delete, truncate on tables to service_role;

do $$
begin
  if to_regclass('public.project_source_sets') is not null then
    if (
      has_table_privilege('service_role', 'public.project_source_sets', 'INSERT')
      or has_table_privilege('service_role', 'public.project_source_sets', 'UPDATE')
      or has_table_privilege('service_role', 'public.project_source_sets', 'DELETE')
      or has_table_privilege('service_role', 'public.project_source_sets', 'TRUNCATE')
    ) then
      raise exception
        'REGRESSION: intermediate migration grants service Source Set DML';
    end if;
  end if;

  if to_regclass('public.project_videos') is not null then
    if (
      has_table_privilege('service_role', 'public.project_videos', 'INSERT')
      or has_table_privilege('service_role', 'public.project_videos', 'UPDATE')
      or has_table_privilege('service_role', 'public.project_videos', 'DELETE')
      or has_table_privilege('service_role', 'public.project_videos', 'TRUNCATE')
    ) then
      raise exception
        'REGRESSION: intermediate migration grants service membership DML';
    end if;
  end if;
end;
$$;
