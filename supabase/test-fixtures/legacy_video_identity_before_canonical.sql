-- Representative deployed-data shape for the canonical Video identity
-- migration. CI loads this after every existing migration and immediately
-- before the forward-only canonical migration.

begin;

-- Some deployed rows predate the NOT NULL hash contract. Preserve that drift
-- in this staged fixture so the migration must handle NULL and legacy MD5
-- values rather than relying on a clean current schema.
alter table public.videos alter column url_hash drop not null;

insert into auth.users (id, is_anonymous)
values
  ('a3471000-0000-4000-8000-000000000001', false),
  ('a3471000-0000-4000-8000-000000000002', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.projects (id, workspace_id, name)
select fixture.id::uuid, workspaces.id, fixture.name
from public.workspaces
join (values
  (
    'a3474000-0000-4000-8000-000000000001',
    'a3471000-0000-4000-8000-000000000001',
    'Canonical repoint Project'
  ),
  (
    'a3474000-0000-4000-8000-000000000002',
    'a3471000-0000-4000-8000-000000000002',
    'Canonical conflict Project'
  )
  ) as fixture(id, owner_id, name)
  on workspaces.owner_id = fixture.owner_id::uuid
on conflict (id) do nothing;

insert into public.project_source_sets (project_id, revision)
values
  ('a3474000-0000-4000-8000-000000000001', 1),
  ('a3474000-0000-4000-8000-000000000002', 2)
on conflict (project_id) do update set revision = excluded.revision;

-- The lowest UUID is the deterministic survivor. Its legacy hash is MD5;
-- the equivalent rows exercise a NULL hash and a second MD5 hash.
insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
)
values
  (
    'a3472000-0000-4000-8000-000000000001',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    '0123456789abcdef0123456789abcdef',
    'Deterministic survivor',
    'Canonical Fixture',
    'en'
  ),
  (
    'a3472000-0000-4000-8000-000000000002',
    'https://youtu.be/dQw4w9WgXcQ?si=legacy',
    null,
    'NULL-hash duplicate',
    'Canonical Fixture',
    'en'
  ),
  (
    'a3472000-0000-4000-8000-000000000003',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'fedcba9876543210fedcba9876543210',
    'MD5-hash duplicate',
    'Canonical Fixture',
    'en'
  ),
  (
    'a3472000-0000-4000-8000-000000000004',
    'https://www.youtube.com/live/9bZkp7q19f0',
    null,
    'NULL-hash live Video',
    'Canonical Fixture',
    'en'
  ),
  (
    'a3472000-0000-4000-8000-000000000005',
    'https://www.youtube.com/shorts/M7lc1UVf-VE',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'MD5-hash Shorts Video',
    'Canonical Fixture',
    'en'
  );

-- Production incident rows. The redirect has one deterministic Video ID;
-- channel URLs do not identify a Video and must be preserved outside the
-- active cache rather than assigned a synthetic identity.
insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language, created_at
)
values
  (
    '8a37686a-e461-4388-a087-ac030d0bf7f0',
    'https://www.youtube.com/redirect?event=video_description&redir_token=QUFFLUhqa2psQ1R6aVdtR2R3eFczRnpZUDI2cmQxbUMzZ3xBQ3Jtc0tuNXU1UXowb2F2b3VzbkhHY0R4VWxsUDlwQjNMNUdqU0JqM2hEdEJoWTF3dVlWU3hsR2labDZsNDVfdERpTUVtcnBWYXY5bnlYVkUtcnE0eDlQUEN6eFhsRG5nY1YwSWtVMFdzZUg0RHFNZUQ0cFk1UQ&q=https%3A%2F%2Funogeeks.com%2Foracle-fusion-hcm-online-training%2F&v=_b1b-uMuzKQ',
    '34aef0dd8636c55d3c23a6fa334b2001',
    'Recoverable redirect Video',
    'Incident Fixture',
    'en',
    '2026-08-04T00:00:00Z'
  ),
  (
    'a456bf8d-5413-452c-82d2-6f4d6923101d',
    'https://youtube.com/@waseemiq1?si=WGN0uguYUo-ivemT',
    '9e45ba7aa82c74c496bbd9d412e8fe13',
    'Unsupported channel one',
    'Incident Fixture',
    'en',
    '2026-08-05T00:00:00Z'
  ),
  (
    'f83123c7-4e6a-4a95-9554-1978dac3e535',
    'https://youtube.com/@richmovies-k3q?si=iolcO_gyLvcEMBYq',
    '1ac8645240c853aba638dfba8364a9cf',
    'Unsupported channel two',
    'Incident Fixture',
    'zh',
    '2026-08-06T00:00:00Z'
  );

insert into public.summaries (
  id, video_id, summary, transcript_source, output_language
)
values
  (
    'a3476000-0000-4000-8000-000000000001',
    'a3472000-0000-4000-8000-000000000001',
    'Survivor native Summary',
    'manual_captions',
    null
  ),
  (
    'a3476000-0000-4000-8000-000000000002',
    'a3472000-0000-4000-8000-000000000002',
    'Duplicate native Summary must lose deterministically',
    'manual_captions',
    null
  ),
  (
    'a3476000-0000-4000-8000-000000000003',
    'a3472000-0000-4000-8000-000000000002',
    'Spanish Summary must be repointed',
    'manual_captions',
    'es'
  ),
  (
    'a3476000-0000-4000-8000-000000000004',
    'a3472000-0000-4000-8000-000000000003',
    'French Summary must be repointed',
    'manual_captions',
    'fr'
  ),
  (
    'a3476000-0000-4000-8000-000000000005',
    'a3472000-0000-4000-8000-000000000004',
    'Legacy live evidence Summary',
    'manual_captions',
    null
  ),
  (
    'a3476000-0000-4000-8000-000000000006',
    'a3472000-0000-4000-8000-000000000005',
    'Legacy Shorts evidence Summary',
    'manual_captions',
    null
  );

insert into public.video_transcripts (
  video_id, transcript_source, language, segments
)
values
  (
    'a3472000-0000-4000-8000-000000000002',
    'manual_captions',
    'en',
    '[{"text":"Legacy duplicate evidence Transcript","start":3,"duration":4}]'::jsonb
  ),
  (
    'a3472000-0000-4000-8000-000000000004',
    'manual_captions',
    'en',
    '[{"text":"Legacy live evidence Transcript","start":7,"duration":4}]'::jsonb
  ),
  (
    'a3472000-0000-4000-8000-000000000005',
    'manual_captions',
    'en',
    '[{"text":"Legacy Shorts evidence Transcript","start":11,"duration":4}]'::jsonb
  );

insert into public.video_transcripts (
  video_id, transcript_source, language, segments, created_at
)
values
  (
    '8a37686a-e461-4388-a087-ac030d0bf7f0',
    'manual_captions',
    'en',
    '[{"text":"Recoverable redirect Transcript","start":13,"duration":4}]'::jsonb,
    '2026-08-04T00:01:00Z'
  ),
  (
    'a456bf8d-5413-452c-82d2-6f4d6923101d',
    'auto_captions',
    'en',
    '[{"text":"Quarantined channel one Transcript","start":17,"duration":4}]'::jsonb,
    '2026-08-05T00:01:00Z'
  ),
  (
    'f83123c7-4e6a-4a95-9554-1978dac3e535',
    'whisper',
    'zh',
    '[{"text":"Quarantined channel two Transcript","start":19,"duration":4}]'::jsonb,
    '2026-08-06T00:01:00Z'
  );

insert into public.user_video_history (id, user_id, video_id, accessed_at)
values
  (
    'a3477000-0000-4000-8000-000000000001',
    'a3471000-0000-4000-8000-000000000001',
    'a3472000-0000-4000-8000-000000000001',
    '2026-08-01T00:00:00Z'
  ),
  (
    'a3477000-0000-4000-8000-000000000002',
    'a3471000-0000-4000-8000-000000000001',
    'a3472000-0000-4000-8000-000000000002',
    '2026-08-02T00:00:00Z'
  ),
  (
    'a3477000-0000-4000-8000-000000000003',
    'a3471000-0000-4000-8000-000000000002',
    'a3472000-0000-4000-8000-000000000003',
    '2026-08-03T00:00:00Z'
  );

insert into public.chat_messages (id, user_id, video_id, role, content)
values (
  'a3475000-0000-4000-8000-000000000001',
  'a3471000-0000-4000-8000-000000000001',
  'a3472000-0000-4000-8000-000000000003',
  'user',
  'Preserve this Video Chat message relationship.'
);

-- Seed the exact dependent rows without manufacturing audit events from the
-- fixture writes themselves. The migration must preserve the explicit events.
select pg_catalog.set_config('project_private.audit_skip', 'on', true);
insert into public.project_videos (
  project_id, video_id, position, status
)
values
  (
    'a3474000-0000-4000-8000-000000000001',
    'a3472000-0000-4000-8000-000000000002',
    1,
    'ready'
  ),
  (
    'a3474000-0000-4000-8000-000000000002',
    'a3472000-0000-4000-8000-000000000001',
    1,
    'ready'
  ),
  (
    'a3474000-0000-4000-8000-000000000002',
    'a3472000-0000-4000-8000-000000000003',
    2,
    'ready'
  ),
  (
    'a3474000-0000-4000-8000-000000000001',
    'a3472000-0000-4000-8000-000000000004',
    2,
    'ready'
  ),
  (
    'a3474000-0000-4000-8000-000000000001',
    'a3472000-0000-4000-8000-000000000005',
    3,
    'ready'
  );

insert into public.project_source_set_events (
  id,
  project_id,
  revision,
  event_kind,
  video_id,
  video_title,
  from_position,
  to_position,
  from_status,
  to_status
)
values
  (
    'a3478000-0000-4000-8000-000000000001',
    'a3474000-0000-4000-8000-000000000001',
    1,
    'added',
    'a3472000-0000-4000-8000-000000000002',
    'NULL-hash duplicate',
    null,
    1,
    null,
    'ready'
  ),
  (
    'a3478000-0000-4000-8000-000000000002',
    'a3474000-0000-4000-8000-000000000002',
    1,
    'added',
    'a3472000-0000-4000-8000-000000000001',
    'Deterministic survivor',
    null,
    1,
    null,
    'ready'
  ),
  (
    'a3478000-0000-4000-8000-000000000003',
    'a3474000-0000-4000-8000-000000000002',
    2,
    'added',
    'a3472000-0000-4000-8000-000000000003',
    'MD5-hash duplicate',
    null,
    2,
    null,
    'ready'
  );

commit;
