-- DecisionFlow PostgreSQL + pgvector Reference Migration
-- Compatible with Supabase PostgreSQL

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'Member',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'Member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('PASTE', 'TXT', 'MD')),
  source_file_name TEXT,
  raw_transcript TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (processing_status IN ('UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED')),
  summary TEXT,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_name TEXT NOT NULL,
  speaker_id UUID REFERENCES users(id) ON DELETE SET NULL,
  start_time TEXT,
  end_time TEXT,
  text TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  decision_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED')),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rationale TEXT,
  effective_date DATE,
  source_segment_id UUID REFERENCES transcript_segments(id) ON DELETE SET NULL,
  supersedes_decision_id UUID REFERENCES decisions(id) ON DELETE SET NULL,
  is_proposal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  decision_text TEXT NOT NULL,
  effective_date DATE,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED')),
  source_meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source_segment_id UUID REFERENCES transcript_segments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(decision_id, version_number)
);

CREATE TABLE IF NOT EXISTS action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED')),
  is_open_loop BOOLEAN NOT NULL DEFAULT FALSE,
  open_loop_reason TEXT,
  source_segment_id UUID REFERENCES transcript_segments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('DECISION', 'ACTION_ITEM')),
  source_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('DECISION', 'ACTION_ITEM')),
  target_id UUID NOT NULL,
  relationship TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('DECISION_CONFLICT', 'DEADLINE_CONFLICT', 'OWNER_CONFLICT', 'DEPENDENCY_CONFLICT', 'SUPERSESSION', 'REVERSAL')),
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  existing_item_type TEXT NOT NULL CHECK (existing_item_type IN ('DECISION', 'ACTION_ITEM', 'DEPENDENCY')),
  existing_item_id UUID NOT NULL,
  new_item_type TEXT NOT NULL CHECK (new_item_type IN ('DECISION', 'ACTION_ITEM')),
  new_item_id UUID NOT NULL,
  explanation TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.85,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS approval_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('DECISION', 'ACTION_ITEM', 'DEPENDENCY')),
  reference_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  proposed_payload JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EDITED')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id UUID NOT NULL UNIQUE REFERENCES action_items(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  external_id TEXT NOT NULL,
  external_url TEXT NOT NULL,
  external_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_item_id UUID NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('UPCOMING_DEADLINE', 'OVERDUE', 'AT_RISK')),
  message TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('TRANSCRIPT', 'DECISION', 'ACTION_ITEM', 'DECISION_EXPLANATION', 'MEETING_SUMMARY')),
  source_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_vec ON memory_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
