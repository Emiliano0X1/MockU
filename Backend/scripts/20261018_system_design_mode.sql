-- ============================================================================
-- Migration: 20261018_system_design_mode.sql
-- Description: Adds System Design practice mode (single-attempt), diagram 
--              versioning, and per-prompt rubrics.
-- ============================================================================

-- 1. Extend interview_sessions table with mode and attempt bounds
ALTER TABLE interview_sessions
ADD COLUMN IF NOT EXISTS mode VARCHAR(32) NOT NULL DEFAULT 'behavioral',
ADD COLUMN IF NOT EXISTS current_attempt INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 1;

-- Update session status constraints to allow system design interactive review lifecycle
ALTER TABLE interview_sessions
DROP CONSTRAINT IF EXISTS interview_sessions_status_check;

ALTER TABLE interview_sessions
ADD CONSTRAINT interview_sessions_status_check 
CHECK (status IN ('recording', 'interpreting', 'awaiting_review', 'grading', 'done', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_sessions_mode ON interview_sessions(mode);

-- 2. Rubrics Table for System Design Prompts
CREATE TABLE IF NOT EXISTS system_design_rubrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
    required_components JSONB NOT NULL DEFAULT '[]'::jsonb,
    expected_tradeoffs JSONB NOT NULL DEFAULT '[]'::jsonb,
    scaling_concerns JSONB NOT NULL DEFAULT '[]'::jsonb,
    scoring_weights JSONB NOT NULL DEFAULT '{"architecture": 40, "scalability": 30, "tradeoffs": 20, "communication": 10}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_rubrics_question_id ON system_design_rubrics(question_id);

-- 3. Diagram Versions Table (Persists each attempt's audio, transcript, and graph)
CREATE TABLE IF NOT EXISTS system_design_diagram_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL DEFAULT 1,
    storage_path VARCHAR(512),
    audio_duration_ms INT,
    transcript_text TEXT,
    graph_data JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'ready', 'accepted', 'rejected', 'failed'
    rejected_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    accepted_at TIMESTAMPTZ,
    CONSTRAINT uq_session_attempt UNIQUE (session_id, attempt_number),
    CONSTRAINT chk_diagram_status CHECK (status IN ('pending', 'ready', 'accepted', 'rejected', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_diagram_versions_session ON system_design_diagram_versions(session_id);

-- 4. Ensure report_findings category check constraint supports new architectural categories
ALTER TABLE report_findings
DROP CONSTRAINT IF EXISTS report_findings_category_check;

-- 5. Seed System Design Questions and Rubrics
DO $$
DECLARE
    q_url_id UUID := gen_random_uuid();
    q_twitter_id UUID := gen_random_uuid();
    q_chat_id UUID := gen_random_uuid();
    q_rate_id UUID := gen_random_uuid();
    q_video_id UUID := gen_random_uuid();
    q_flash_id UUID := gen_random_uuid();
BEGIN
    -- 1. URL Shortener
    INSERT INTO questions (id, text, category)
    VALUES (q_url_id, 'Design a URL Shortener like TinyURL or Bitly', 'System Design')
    ON CONFLICT DO NOTHING;

    INSERT INTO system_design_rubrics (question_id, required_components, expected_tradeoffs, scaling_concerns, scoring_weights)
    VALUES (
        q_url_id,
        '[
            {"type": "api_service", "name": "URL Service", "purpose": "Handle creation and redirection"},
            {"type": "database", "name": "Persistent Store", "purpose": "Store short_code to original_url mapping"},
            {"type": "cache", "name": "Memory Cache", "purpose": "Cache hot redirect URLs (80/20 rule)"},
            {"type": "load_balancer", "name": "Load Balancer", "purpose": "Distribute incoming HTTP redirect requests"}
        ]'::jsonb,
        '[
            {"topic": "Hash Generation", "options": ["MD5/SHA256 truncate", "Base62 counter", "Key Generation Service (KGS)"]},
            {"topic": "Database Choice", "options": ["Relational (PostgreSQL)", "NoSQL (DynamoDB/Cassandra)"]},
            {"topic": "HTTP Status", "options": ["301 Permanent Redirect", "302 Temporary Redirect"]}
        ]'::jsonb,
        '[
            "Read-heavy ratio (50:1 to 100:1 read to write)",
            "Memory estimation for 20% hot links caching",
            "Database indexing on short_code"
        ]'::jsonb,
        '{"architecture": 35, "scalability": 30, "tradeoffs": 25, "communication": 10}'::jsonb
    ) ON CONFLICT DO NOTHING;

    -- 2. Twitter News Feed
    INSERT INTO questions (id, text, category)
    VALUES (q_twitter_id, 'Design Twitter / X News Feed', 'System Design')
    ON CONFLICT DO NOTHING;

    INSERT INTO system_design_rubrics (question_id, required_components, expected_tradeoffs, scaling_concerns, scoring_weights)
    VALUES (
        q_twitter_id,
        '[
            {"type": "api_service", "name": "Tweet Service", "purpose": "Post and retrieve tweets"},
            {"type": "api_service", "name": "Timeline/Feed Service", "purpose": "Aggregate user feeds"},
            {"type": "cache", "name": "Timeline Cache", "purpose": "In-memory feed lists for fast reads"},
            {"type": "queue", "name": "Fan-out Queue", "purpose": "Async worker distribution for timeline delivery"},
            {"type": "worker", "name": "Fan-out Worker", "purpose": "Push tweets to follower timeline caches"}
        ]'::jsonb,
        '[
            {"topic": "Fan-out Model", "options": ["Fan-out on Write (Push)", "Fan-out on Read (Pull)", "Hybrid (Celebrity exception)"]},
            {"topic": "Storage", "options": ["Relational with sharding", "Graph DB for followers", "Wide-column store for tweets"]}
        ]'::jsonb,
        '[
            "Handling users with millions of followers (celebrity bottleneck)",
            "Timeline generation latency < 200ms",
            "Active vs inactive user caching"
        ]'::jsonb,
        '{"architecture": 35, "scalability": 35, "tradeoffs": 20, "communication": 10}'::jsonb
    ) ON CONFLICT DO NOTHING;

    -- 3. Real-Time Chat App
    INSERT INTO questions (id, text, category)
    VALUES (q_chat_id, 'Design a Real-Time Chat Application like WhatsApp or Slack', 'System Design')
    ON CONFLICT DO NOTHING;

    INSERT INTO system_design_rubrics (question_id, required_components, expected_tradeoffs, scaling_concerns, scoring_weights)
    VALUES (
        q_chat_id,
        '[
            {"type": "load_balancer", "name": "WebSocket Gateway LB", "purpose": "Distribute persistent socket connections"},
            {"type": "api_service", "name": "Chat Connection Service", "purpose": "Maintain active bi-directional sockets"},
            {"type": "queue", "name": "Message Broker", "purpose": "Route messages between distributed socket servers"},
            {"type": "database", "name": "Message Store", "purpose": "Store historical chat records"},
            {"type": "cache", "name": "User Session/Presence Cache", "purpose": "Track online/offline status"}
        ]'::jsonb,
        '[
            {"topic": "Protocol", "options": ["WebSocket", "HTTP Long Polling", "SSE"]},
            {"topic": "Database Store", "options": ["NoSQL Key-Value (HBase/Cassandra)", "Relational (PostgreSQL)"]},
            {"topic": "Delivery Guarantees", "options": ["At least once", "Exactly once with deduplication"]}
        ]'::jsonb,
        '[
            "High concurrent persistent TCP connections",
            "Cross-cluster message routing",
            "Offline message buffering"
        ]'::jsonb,
        '{"architecture": 40, "scalability": 30, "tradeoffs": 20, "communication": 10}'::jsonb
    ) ON CONFLICT DO NOTHING;

    -- 4. Distributed Rate Limiter
    INSERT INTO questions (id, text, category)
    VALUES (q_rate_id, 'Design an API Rate Limiter', 'System Design')
    ON CONFLICT DO NOTHING;

    INSERT INTO system_design_rubrics (question_id, required_components, expected_tradeoffs, scaling_concerns, scoring_weights)
    VALUES (
        q_rate_id,
        '[
            {"type": "load_balancer", "name": "API Gateway", "purpose": "Intercept inbound traffic for quota validation"},
            {"type": "api_service", "name": "Rate Limiter Middleware", "purpose": "Execute rate limit algorithm"},
            {"type": "cache", "name": "Distributed Redis Cache", "purpose": "Maintain atomic client counters and timestamps"}
        ]'::jsonb,
        '[
            {"topic": "Algorithm", "options": ["Token Bucket", "Leaky Bucket", "Sliding Window Log", "Sliding Window Counter"]},
            {"topic": "Concurrency", "options": ["Redis Lua Scripts", "Redis Locks", "Local memory synchronization"]}
        ]'::jsonb,
        '[
            "Sub-millisecond verification overhead",
            "Race conditions under high concurrent bursts",
            "Distributed cache synchronization"
        ]'::jsonb,
        '{"architecture": 35, "scalability": 35, "tradeoffs": 20, "communication": 10}'::jsonb
    ) ON CONFLICT DO NOTHING;

    -- 5. Video Streaming Service
    INSERT INTO questions (id, text, category)
    VALUES (q_video_id, 'Design a Video Streaming Platform like YouTube or Netflix', 'System Design')
    ON CONFLICT DO NOTHING;

    INSERT INTO system_design_rubrics (question_id, required_components, expected_tradeoffs, scaling_concerns, scoring_weights)
    VALUES (
        q_video_id,
        '[
            {"type": "cdn", "name": "Edge Video CDN", "purpose": "Deliver cached video segments close to users"},
            {"type": "object_storage", "name": "Raw & Processed Video Store", "purpose": "Store video files in S3/Blob"},
            {"type": "worker", "name": "Transcoding Workers", "purpose": "Encode video into multiple bitrates (HLS/DASH)"},
            {"type": "queue", "name": "Transcode Job Queue", "purpose": "Distribute video processing jobs"},
            {"type": "api_service", "name": "Metadata & Auth Service", "purpose": "Handle user auth, search, and video metadata"}
        ]'::jsonb,
        '[
            {"topic": "Streaming Protocol", "options": ["HLS", "DASH", "WebRTC"]},
            {"topic": "Storage Tiering", "options": ["Hot edge caching vs Cold object storage archival"]}
        ]'::jsonb,
        '[
            "Petabyte-scale video ingestion and storage",
            "Network bandwidth optimization via adaptive bitrate streaming",
            "Cache hit ratio optimization at edge CDNs"
        ]'::jsonb,
        '{"architecture": 35, "scalability": 35, "tradeoffs": 20, "communication": 10}'::jsonb
    ) ON CONFLICT DO NOTHING;

    -- 6. Flash Sale System
    INSERT INTO questions (id, text, category)
    VALUES (q_flash_id, 'Design an E-Commerce Flash Sale System', 'System Design')
    ON CONFLICT DO NOTHING;

    INSERT INTO system_design_rubrics (question_id, required_components, expected_tradeoffs, scaling_concerns, scoring_weights)
    VALUES (
        q_flash_id,
        '[
            {"type": "load_balancer", "name": "Traffic Shield LB", "purpose": "Filter bot traffic and rate-limit checkout calls"},
            {"type": "cache", "name": "Pre-warmed Inventory Cache", "purpose": "In-memory atomic stock decrement"},
            {"type": "queue", "name": "Order Creation Queue", "purpose": "Smooth spikes into downstream databases"},
            {"type": "worker", "name": "Order Fulfillment Worker", "purpose": "Process orders asynchronously"},
            {"type": "database", "name": "Transactional Order DB", "purpose": "Persist final order receipts"}
        ]'::jsonb,
        '[
            {"topic": "Stock Decrement", "options": ["Atomic Redis DECR", "Pessimistic DB lock (SELECT FOR UPDATE)", "Optimistic DB lock (version number)"]},
            {"topic": "Order Lifecycle", "options": ["Immediate synchronous checkout", "Async queue-based reservation with TTL"]}
        ]'::jsonb,
        '[
            "Preventing overselling under high concurrency",
            "Shielding the primary database from read/write stampedes",
            "Automatic stock release on payment timeout"
        ]'::jsonb,
        '{"architecture": 40, "scalability": 30, "tradeoffs": 20, "communication": 10}'::jsonb
    ) ON CONFLICT DO NOTHING;
END $$;
