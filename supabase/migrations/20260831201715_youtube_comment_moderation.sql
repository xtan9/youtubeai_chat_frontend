create table public.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  youtube_channel_id text not null,
  youtube_channel_title text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz not null,
  granted_scopes text[] not null default '{}',
  auto_reply_enabled boolean not null default false,
  auto_reply_threshold numeric(4, 3) not null default 0.920,
  reply_template text not null default '本条回复被 YouTubeAI 检测为疑似包含人身攻击或恶意挑衅。为维护讨论秩序，AI 代为回复：{{reply}}',
  last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_connections_threshold_check
    check (auto_reply_threshold >= 0.800 and auto_reply_threshold <= 0.990),
  constraint youtube_connections_template_check
    check (
      char_length(reply_template) between 10 and 800
      and position('{{reply}}' in reply_template) > 0
    )
);

create table public.youtube_comment_moderation_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.youtube_connections(user_id) on delete cascade,
  youtube_comment_id text not null,
  youtube_parent_comment_id text not null,
  youtube_video_id text not null,
  author_channel_id text,
  author_display_name text not null,
  comment_text text not null,
  published_at timestamptz,
  source_mode text not null,
  classification text not null,
  confidence numeric(4, 3) not null,
  reason_codes text[] not null default '{}',
  suggested_reply text not null,
  rendered_reply text not null,
  status text not null,
  youtube_reply_id text,
  error_code text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_comment_moderation_items_source_check
    check (source_mode in ('creator', 'consumer')),
  constraint youtube_comment_moderation_items_classification_check
    check (classification in ('hostile', 'critical', 'benign')),
  constraint youtube_comment_moderation_items_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint youtube_comment_moderation_items_status_check
    check (status in ('draft', 'ignored', 'publishing', 'replied', 'failed')),
  constraint youtube_comment_moderation_items_unique_comment
    unique (user_id, youtube_comment_id)
);

create index youtube_comment_moderation_items_user_created_idx
  on public.youtube_comment_moderation_items (user_id, created_at desc);

create index youtube_comment_moderation_items_user_status_idx
  on public.youtube_comment_moderation_items (user_id, status, created_at desc);

alter table public.youtube_connections enable row level security;
alter table public.youtube_comment_moderation_items enable row level security;

-- Credentials and moderation records are server-only. The application reads
-- them after validating the Supabase user, through its service-role boundary.
-- Do not add browser policies: even encrypted provider tokens are not client data.
revoke all on table public.youtube_connections from anon, authenticated;
revoke all on table public.youtube_comment_moderation_items from anon, authenticated;
