import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), 'data', 'decisionflow.db');
}

export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath ?? getDbPath();
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'Member',
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'Member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('PASTE', 'TXT', 'MD')),
      source_file_name TEXT,
      raw_transcript TEXT NOT NULL,
      processing_status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (processing_status IN ('UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED')),
      summary TEXT,
      processing_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      speaker_name TEXT NOT NULL,
      speaker_role TEXT,
      speaker_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      start_time TEXT,
      end_time TEXT,
      text TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(meeting_id, sequence_number)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      decision_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED')),
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      owner_name TEXT,
      rationale TEXT,
      effective_date TEXT,
      source_segment_id TEXT REFERENCES transcript_segments(id) ON DELETE SET NULL,
      supersedes_decision_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
      is_proposal INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decision_versions (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      decision_text TEXT NOT NULL,
      effective_date TEXT,
      status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED')),
      source_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      source_segment_id TEXT REFERENCES transcript_segments(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(decision_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      owner_name TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
      status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED')),
      is_open_loop INTEGER NOT NULL DEFAULT 0,
      open_loop_reason TEXT,
      source_segment_id TEXT REFERENCES transcript_segments(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('DECISION', 'ACTION_ITEM')),
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('DECISION', 'ACTION_ITEM')),
      target_id TEXT NOT NULL,
      relationship TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team_id, source_type, source_id, target_type, target_id, relationship)
    );

    CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      conflict_type TEXT NOT NULL CHECK (conflict_type IN ('DECISION_CONFLICT', 'DEADLINE_CONFLICT', 'OWNER_CONFLICT', 'DEPENDENCY_CONFLICT', 'SUPERSESSION', 'REVERSAL')),
      severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
      existing_item_type TEXT NOT NULL CHECK (existing_item_type IN ('DECISION', 'ACTION_ITEM', 'DEPENDENCY')),
      existing_item_id TEXT NOT NULL,
      new_item_type TEXT NOT NULL CHECK (new_item_type IN ('DECISION', 'ACTION_ITEM')),
      new_item_id TEXT NOT NULL,
      explanation TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.85,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS approval_items (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('DECISION', 'ACTION_ITEM', 'DEPENDENCY')),
      reference_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      proposed_payload TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EDITED')),
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(item_type, reference_id)
    );

    CREATE TABLE IF NOT EXISTS external_tasks (
      id TEXT PRIMARY KEY,
      action_item_id TEXT NOT NULL UNIQUE REFERENCES action_items(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'github',
      external_id TEXT NOT NULL,
      external_url TEXT NOT NULL,
      external_status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reminder_type TEXT NOT NULL CHECK (reminder_type IN ('UPCOMING_DEADLINE', 'OVERDUE', 'AT_RISK')),
      message TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACKNOWLEDGED', 'RESOLVED')),
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(action_item_id, reminder_type)
    );

    CREATE TABLE IF NOT EXISTS weekly_digests (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      content TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('TRANSCRIPT', 'DECISION', 'ACTION_ITEM', 'DECISION_EXPLANATION', 'MEETING_SUMMARY')),
      source_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_type, source_id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_meetings_team ON meetings(team_id, meeting_date DESC);
    CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, sequence_number);
    CREATE INDEX IF NOT EXISTS idx_decisions_team_status ON decisions(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_actions_team_status ON action_items(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_conflicts_team_status ON conflicts(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_team_status ON approval_items(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_reminders_team_user ON reminders(team_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_audit_team_created ON audit_events(team_id, created_at DESC);
  `);

  const ensureColumn = (table: string, column: string, definition: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  ensureColumn('transcript_segments', 'speaker_role', 'TEXT');
  ensureColumn('decisions', 'owner_name', 'TEXT');
  ensureColumn('action_items', 'owner_name', 'TEXT');
}
