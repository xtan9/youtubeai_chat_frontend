-- Data-only upgrade fixture: this Researcher predates Workspace migrations.
-- Keep schema shape in legacy_schema.sql frozen; backfill scenarios live here.

insert into auth.users (id, is_anonymous)
values ('40000000-0000-4000-8000-000000000004', false);
