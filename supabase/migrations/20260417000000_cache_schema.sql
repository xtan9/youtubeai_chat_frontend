-- Videos table for cache lookup
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_url TEXT NOT NULL,
    url_hash TEXT NOT NULL UNIQUE,
    youtube_id VARCHAR(20),
    title TEXT,
    channel_name TEXT,
    language TEXT DEFAULT 'en',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_url_hash ON videos(url_hash);

-- Summaries table for cached results
CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    transcript TEXT,
    summary TEXT NOT NULL,
    thinking TEXT,
    transcript_source TEXT NOT NULL DEFAULT 'auto_captions',
    enable_thinking BOOLEAN NOT NULL DEFAULT FALSE,
    model TEXT,
    processing_time_seconds NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(video_id, enable_thinking)
);

CREATE INDEX IF NOT EXISTS idx_summaries_video_id ON summaries(video_id);

-- User video history
CREATE TABLE IF NOT EXISTS user_video_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
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

-- RLS policies
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_video_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Videos: public read, authenticated write
CREATE POLICY "videos_select" ON videos FOR SELECT USING (true);
CREATE POLICY "videos_insert" ON videos FOR INSERT TO authenticated WITH CHECK (true);

-- Summaries: public read, authenticated write
CREATE POLICY "summaries_select" ON summaries FOR SELECT USING (true);
CREATE POLICY "summaries_insert" ON summaries FOR INSERT TO authenticated WITH CHECK (true);

-- User history: private to owner
CREATE POLICY "history_select" ON user_video_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "history_insert" ON user_video_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Rate limits: service role only (accessed via server-side Supabase client)
CREATE POLICY "rate_limits_all" ON rate_limits FOR ALL TO service_role USING (true);
