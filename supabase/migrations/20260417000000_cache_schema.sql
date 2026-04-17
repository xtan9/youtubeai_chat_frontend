-- Videos table for cache lookup
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_url TEXT NOT NULL,
    url_hash TEXT NOT NULL UNIQUE,
    title TEXT,
    channel_name TEXT,
    language TEXT DEFAULT 'en' CHECK (language IN ('en', 'zh')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Summaries table for cached results
CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    transcript TEXT,
    summary TEXT NOT NULL,
    thinking TEXT,
    transcript_source TEXT NOT NULL DEFAULT 'auto_captions'
        CHECK (transcript_source IN ('manual_captions', 'auto_captions', 'whisper')),
    enable_thinking BOOLEAN NOT NULL DEFAULT FALSE,
    model TEXT,
    processing_time_seconds NUMERIC(10, 2),
    transcribe_time_seconds NUMERIC(10, 2),
    summarize_time_seconds NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(video_id, enable_thinking),
    -- Mirror the in-memory ThinkingState discriminated union at the DB layer.
    CONSTRAINT summaries_thinking_consistent
        CHECK (enable_thinking = TRUE OR thinking IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_summaries_video_id ON summaries(video_id);

-- User video history
CREATE TABLE IF NOT EXISTS user_video_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_user_video_history_user_id ON user_video_history(user_id);

-- Rate limits table
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_window ON rate_limits(user_id, window_start);

-- RLS
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_video_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Videos: public read, service_role write
DROP POLICY IF EXISTS "videos_select" ON videos;
CREATE POLICY "videos_select" ON videos FOR SELECT USING (true);
DROP POLICY IF EXISTS "videos_insert" ON videos;
CREATE POLICY "videos_insert" ON videos FOR INSERT TO service_role WITH CHECK (true);

-- Summaries: public read, service_role write
DROP POLICY IF EXISTS "summaries_select" ON summaries;
CREATE POLICY "summaries_select" ON summaries FOR SELECT USING (true);
DROP POLICY IF EXISTS "summaries_insert" ON summaries;
CREATE POLICY "summaries_insert" ON summaries FOR INSERT TO service_role WITH CHECK (true);

-- User history: private to owner
DROP POLICY IF EXISTS "history_select" ON user_video_history;
CREATE POLICY "history_select" ON user_video_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "history_insert" ON user_video_history;
CREATE POLICY "history_insert" ON user_video_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Rate limits: deny all non-service-role access. service_role bypasses RLS,
-- so no ALLOW policy is needed; the REVOKEs below make the denial explicit.
REVOKE ALL ON rate_limits FROM anon, authenticated;
