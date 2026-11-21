var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/ai/client.ts
var client_exports = {};
__export(client_exports, {
  GeminiUnavailableError: () => GeminiUnavailableError,
  generateContentResilient: () => generateContentResilient,
  getEmbeddingModel: () => getEmbeddingModel,
  getGeminiClient: () => getGeminiClient,
  getGeminiFallbackModel: () => getGeminiFallbackModel,
  getGeminiFallbackStatus: () => getGeminiFallbackStatus,
  getGeminiModel: () => getGeminiModel,
  isAuthOrConfigError: () => isAuthOrConfigError,
  isDailyQuotaError: () => isDailyQuotaError,
  isGeminiConfigured: () => isGeminiConfigured,
  isModelQuotaExhausted: () => isModelQuotaExhausted,
  isQuotaExhaustedError: () => isQuotaExhaustedError,
  isRetryableGeminiError: () => isRetryableGeminiError,
  resetGeminiFallbackState: () => resetGeminiFallbackState,
  runWithGeminiContext: () => runWithGeminiContext,
  sanitizeGeminiErrorMessage: () => sanitizeGeminiErrorMessage
});
import { AsyncLocalStorage } from "async_hooks";
import { GoogleGenAI } from "@google/genai";
function getGeminiModel() {
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured || DEFAULT_MODEL;
}
function getGeminiFallbackModel() {
  const configured = process.env.GEMINI_FALLBACK_MODEL?.trim();
  return configured || DEFAULT_FALLBACK_MODEL;
}
function getEmbeddingModel() {
  return EMBEDDING_MODEL;
}
function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}
function resetGeminiFallbackState() {
  quotaExhaustedUntilByModel.clear();
}
function isModelQuotaExhausted(model, now = Date.now()) {
  const entry = quotaExhaustedUntilByModel.get(model);
  if (!entry) return false;
  if (now >= entry.until) {
    quotaExhaustedUntilByModel.delete(model);
    return false;
  }
  return true;
}
function getGeminiFallbackStatus(now = Date.now()) {
  const primaryModel = getGeminiModel();
  const entry = quotaExhaustedUntilByModel.get(primaryModel);
  const active = Boolean(entry && now < entry.until);
  if (entry && !active) {
    quotaExhaustedUntilByModel.delete(primaryModel);
  }
  return {
    primaryModel,
    fallbackModel: getGeminiFallbackModel(),
    primaryInQuotaCooldown: active,
    cooldownReason: active ? entry.reason : null
  };
}
async function runWithGeminiContext(fn) {
  const ctx = {
    fallbackEvents: [],
    modelsUsed: []
  };
  const result = await geminiContextStorage.run(ctx, fn);
  return {
    result,
    fallbackEvents: ctx.fallbackEvents,
    modelsUsed: Array.from(new Set(ctx.modelsUsed))
  };
}
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets to run AI extraction and reasoning."
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 3e4,
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return cachedClient;
}
function extractErrorDetails(err) {
  if (!err || typeof err !== "object") {
    return { message: String(err ?? "") };
  }
  const e = err;
  const cause = e.cause && typeof e.cause === "object" ? e.cause : void 0;
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : typeof cause?.status === "number" ? cause.status : void 0;
  const code = typeof e.code === "string" ? e.code : typeof cause?.code === "string" ? cause.code : void 0;
  const message = typeof e.message === "string" ? e.message : String(err);
  return { status, code, message };
}
function isQuotaExhaustedError(err) {
  const { status, code, message } = extractErrorDetails(err);
  if (status === 429) return true;
  const upper = `${code ?? ""} ${message}`.toUpperCase();
  return upper.includes("429") || upper.includes("RESOURCE_EXHAUSTED") || upper.includes("QUOTA") || upper.includes("RATE_LIMIT") || upper.includes("RATE LIMIT") || upper.includes("TOO MANY REQUESTS");
}
function isDailyQuotaError(err) {
  const { message } = extractErrorDetails(err);
  const lower = message.toLowerCase();
  return lower.includes("perday") || lower.includes("per_day") || lower.includes("requestsperday") || lower.includes("daily") || lower.includes("free_tier") || lower.includes("exceeded your current quota");
}
function isAuthOrConfigError(err) {
  const { status, message } = extractErrorDetails(err);
  if (status === 401 || status === 403) return true;
  const upper = message.toUpperCase();
  return upper.includes("GEMINI_API_KEY") || upper.includes("API_KEY_INVALID") || upper.includes("PERMISSION_DENIED") || upper.includes("API KEY NOT VALID");
}
function isRetryableGeminiError(err) {
  if (isAuthOrConfigError(err)) return false;
  if (isQuotaExhaustedError(err)) return true;
  const { status, code, message } = extractErrorDetails(err);
  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const normalizedCode = (code ?? "").toUpperCase();
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "ABORT_ERR"].includes(
    normalizedCode
  )) {
    return true;
  }
  const upper = message.toUpperCase();
  return upper.includes("503") || upper.includes("504") || upper.includes("502") || upper.includes("500") || upper.includes("408") || upper.includes("UNAVAILABLE") || upper.includes("HIGH DEMAND") || upper.includes("OVERLOADED") || upper.includes("DEADLINE_EXCEEDED") || upper.includes("TIMEOUT") || upper.includes("TIMED OUT") || upper.includes("ABORT") || upper.includes("FETCH FAILED") || upper.includes("ECONNRESET") || upper.includes("ETIMEDOUT") || upper.includes("INTERNAL");
}
function sanitizeGeminiErrorMessage(err) {
  if (err instanceof GeminiUnavailableError) {
    return err.message;
  }
  if (isAuthOrConfigError(err)) {
    return "Gemini API key is missing or invalid. Please check GEMINI_API_KEY in Settings > Secrets.";
  }
  if (isRetryableGeminiError(err)) {
    return new GeminiUnavailableError().message;
  }
  const msg = err?.message?.trim() ?? "";
  if (!msg || msg.startsWith("{") || msg.includes('"error":') || msg.includes("RESOURCE_EXHAUSTED")) {
    return new GeminiUnavailableError().message;
  }
  return msg;
}
function recordModelUsed(model) {
  const ctx = geminiContextStorage.getStore();
  if (ctx) {
    ctx.modelsUsed.push(model);
  }
}
function recordFallbackEvent(fromModel, toModel, reason) {
  const ctx = geminiContextStorage.getStore();
  if (ctx) {
    ctx.fallbackEvents.push({
      fromModel,
      toModel,
      reason,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
}
function buildFallbackParams(params, fallbackModel) {
  const rawThinking = params.config?.thinkingConfig;
  if (rawThinking?.thinkingLevel === "XHIGH" && fallbackModel.startsWith("gemini-3")) {
    return {
      ...params,
      model: fallbackModel,
      config: {
        ...params.config,
        thinkingConfig: {
          ...rawThinking,
          thinkingLevel: "HIGH"
        }
      }
    };
  }
  return {
    ...params,
    model: fallbackModel
  };
}
async function generateContentResilient(params, options) {
  const ai = options?.client ?? getGeminiClient();
  const nowFn = options?.now ?? Date.now;
  const primaryModel = params.model ?? getGeminiModel();
  const fallbackModel = options?.fallbackModel ?? getGeminiFallbackModel();
  const { model: _ignoredModel, ...requestParams } = params;
  const canFallback = Boolean(fallbackModel && fallbackModel !== primaryModel);
  if (canFallback && isModelQuotaExhausted(primaryModel, nowFn())) {
    recordFallbackEvent(primaryModel, fallbackModel, "Primary model in quota cooldown");
    try {
      const response = await ai.models.generateContent(buildFallbackParams(requestParams, fallbackModel));
      recordModelUsed(fallbackModel);
      return response;
    } catch (fallbackErr) {
      if (isAuthOrConfigError(fallbackErr)) {
        throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
      }
      if (isRetryableGeminiError(fallbackErr)) {
        throw new GeminiUnavailableError();
      }
      throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
    }
  }
  try {
    const response = await ai.models.generateContent({
      ...requestParams,
      model: primaryModel
    });
    recordModelUsed(primaryModel);
    return response;
  } catch (err) {
    if (isAuthOrConfigError(err)) {
      throw new Error(sanitizeGeminiErrorMessage(err));
    }
    if (!canFallback || !isRetryableGeminiError(err)) {
      if (isRetryableGeminiError(err)) {
        throw new GeminiUnavailableError();
      }
      throw new Error(sanitizeGeminiErrorMessage(err));
    }
    const quotaHit = isQuotaExhaustedError(err);
    const reason = quotaHit ? "Quota exhausted (429)" : "Transient upstream failure";
    if (quotaHit) {
      const cooldownMs = isDailyQuotaError(err) ? DAILY_QUOTA_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS;
      quotaExhaustedUntilByModel.set(primaryModel, {
        until: nowFn() + cooldownMs,
        reason
      });
    }
    recordFallbackEvent(primaryModel, fallbackModel, reason);
    try {
      const fallbackResponse = await ai.models.generateContent(
        buildFallbackParams(requestParams, fallbackModel)
      );
      recordModelUsed(fallbackModel);
      return fallbackResponse;
    } catch (fallbackErr) {
      if (isAuthOrConfigError(fallbackErr)) {
        throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
      }
      if (isRetryableGeminiError(fallbackErr)) {
        throw new GeminiUnavailableError();
      }
      throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
    }
  }
}
var DEFAULT_MODEL, DEFAULT_FALLBACK_MODEL, EMBEDDING_MODEL, DAILY_QUOTA_COOLDOWN_MS, RATE_LIMIT_COOLDOWN_MS, geminiContextStorage, cachedClient, quotaExhaustedUntilByModel, GeminiUnavailableError;
var init_client = __esm({
  "server/ai/client.ts"() {
    DEFAULT_MODEL = "gemini-4-hydrogen";
    DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";
    EMBEDDING_MODEL = "gemini-embedding-2";
    DAILY_QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1e3;
    RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1e3;
    geminiContextStorage = new AsyncLocalStorage();
    cachedClient = null;
    quotaExhaustedUntilByModel = /* @__PURE__ */ new Map();
    GeminiUnavailableError = class extends Error {
      constructor(message = "AI processing is temporarily unavailable. Your transcript and existing workspace data have not been corrupted. Please try again shortly.") {
        super(message);
        this.statusCode = 503;
        this.code = "AI_UNAVAILABLE";
        this.name = "GeminiUnavailableError";
      }
    };
  }
});

// server.ts
import "dotenv/config";
import express2 from "express";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// server/db/schema.ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
var dbInstance = null;
function getDbPath() {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), "data", "decisionflow.db");
}
function getDb(customPath) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }
  const dbPath = customPath ?? getDbPath();
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  if (!customPath) {
    dbInstance = db;
  }
  return db;
}
function initializeSchema(db) {
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
  const ensureColumn = (table, column, definition) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  ensureColumn("transcript_segments", "speaker_role", "TEXT");
  ensureColumn("decisions", "owner_name", "TEXT");
  ensureColumn("action_items", "owner_name", "TEXT");
}

// server/db/seed.ts
import { randomUUID } from "crypto";
var ACME_TEAM_ID = "11111111-1111-1111-1111-111111111111";
var DEMO_USERS = [
  {
    id: "22222222-2222-2222-2222-222222222201",
    name: "Priya Sharma",
    email: "priya@acme.dev",
    role: "Product Lead"
  },
  {
    id: "22222222-2222-2222-2222-222222222202",
    name: "Rahul Mehta",
    email: "rahul@acme.dev",
    role: "Engineering Lead"
  },
  {
    id: "22222222-2222-2222-2222-222222222203",
    name: "Ananya Krishnan",
    email: "ananya@acme.dev",
    role: "Security Lead"
  },
  {
    id: "22222222-2222-2222-2222-222222222204",
    name: "Arjun Verma",
    email: "arjun@acme.dev",
    role: "Platform Engineer"
  }
];
var MEETING_3_SAMPLE = {
  title: "Payment Launch Review",
  meetingDate: "2026-11-21",
  sourceType: "PASTE",
  sourceFileName: "payment-launch-review-nov21.txt",
  transcript: `Priya:
"We need to accelerate the payment launch."

Rahul:
"Engineering can support December 5."

Priya:
"Let's move the launch to December 5."

Ananya:
"Wait, security certification is currently scheduled for December 8."

Priya:
"Okay, then we need to see if security can bring that forward. Rahul, can you prepare the updated launch checklist?"

Rahul:
"Yes, I'll do that by November 23."`
};
function seedDemoWorkspace(db) {
  const existingTeam = db.prepare("SELECT id FROM teams WHERE id = ?").get(ACME_TEAM_ID);
  if (existingTeam) {
    return;
  }
  const runSeed = db.transaction(() => {
    db.prepare("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)").run(
      ACME_TEAM_ID,
      "Acme Product Team",
      "2026-11-15T09:00:00Z"
    );
    const insertUser = db.prepare(
      "INSERT INTO users (id, name, email, role, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
    );
    const insertMember = db.prepare(
      "INSERT INTO team_members (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const user of DEMO_USERS) {
      insertUser.run(user.id, user.name, user.email, user.role, "2026-11-15T09:00:00Z");
      insertMember.run(randomUUID(), ACME_TEAM_ID, user.id, user.role, "2026-11-15T09:00:00Z");
    }
    const priyaId = DEMO_USERS[0].id;
    const rahulId = DEMO_USERS[1].id;
    const ananyaId = DEMO_USERS[2].id;
    const meeting1Id = "33333333-3333-3333-3333-333333333301";
    const meeting1Transcript = `Priya:
"Let's make December 10 our payment launch date."

Rahul:
"Engineering can be ready by December 10."

Ananya:
"Security certification will also be completed before December 10."

Priya:
"Okay, let's make December 10 the launch date."

Rahul:
"I'll prepare the payment API documentation before then."

Priya:
"Rahul, please have that ready by November 25."`;
    db.prepare(
      `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, source_file_name, raw_transcript, processing_status, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?, ?, ?)`
    ).run(
      meeting1Id,
      ACME_TEAM_ID,
      "Payment Launch Planning",
      "2026-11-18",
      "TXT",
      "payment-launch-planning-nov18.txt",
      meeting1Transcript,
      "Team aligned on launching the payment service on December 10, 2026, with engineering readiness and security certification expected prior to launch. Rahul committed to preparing payment API documentation by November 25.",
      "2026-11-18T10:00:00Z",
      "2026-11-18T10:05:00Z"
    );
    const m1Segments = [
      { id: "44444444-4444-4444-4444-444444444401", speaker: "Priya", speakerId: priyaId, seq: 1, text: "Let's make December 10 our payment launch date." },
      { id: "44444444-4444-4444-4444-444444444402", speaker: "Rahul", speakerId: rahulId, seq: 2, text: "Engineering can be ready by December 10." },
      { id: "44444444-4444-4444-4444-444444444403", speaker: "Ananya", speakerId: ananyaId, seq: 3, text: "Security certification will also be completed before December 10." },
      { id: "44444444-4444-4444-4444-444444444404", speaker: "Priya", speakerId: priyaId, seq: 4, text: "Okay, let's make December 10 the launch date." },
      { id: "44444444-4444-4444-4444-444444444405", speaker: "Rahul", speakerId: rahulId, seq: 5, text: "I'll prepare the payment API documentation before then." },
      { id: "44444444-4444-4444-4444-444444444406", speaker: "Priya", speakerId: priyaId, seq: 6, text: "Rahul, please have that ready by November 25." }
    ];
    const insertSegment = db.prepare(
      `INSERT INTO transcript_segments (id, meeting_id, speaker_name, speaker_id, start_time, end_time, text, sequence_number, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
    );
    for (const seg of m1Segments) {
      insertSegment.run(seg.id, meeting1Id, seg.speaker, seg.speakerId, seg.text, seg.seq, "2026-11-18T10:01:00Z");
    }
    const dec10DecisionId = "55555555-5555-5555-5555-555555555501";
    db.prepare(
      `INSERT INTO decisions (id, team_id, meeting_id, topic, decision_text, status, owner_id, rationale, effective_date, source_segment_id, supersedes_decision_id, is_proposal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, NULL, 0, ?, ?)`
    ).run(
      dec10DecisionId,
      ACME_TEAM_ID,
      meeting1Id,
      "Payment launch",
      "Launch payment service on December 10, 2026",
      priyaId,
      "Engineering and security readiness aligned for December 10.",
      "2026-12-10",
      m1Segments[3].id,
      "2026-11-18T10:02:00Z",
      "2026-11-18T10:05:00Z"
    );
    db.prepare(
      `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
       VALUES (?, ?, 1, ?, ?, 'ACTIVE', ?, ?, ?)`
    ).run(
      "66666666-6666-6666-6666-666666666601",
      dec10DecisionId,
      "Launch payment service on December 10, 2026",
      "2026-12-10",
      meeting1Id,
      m1Segments[3].id,
      "2026-11-18T10:05:00Z"
    );
    const apiDocActionId = "77777777-7777-7777-7777-777777777701";
    db.prepare(
      `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'HIGH', 'OPEN', 0, NULL, ?, ?, ?)`
    ).run(
      apiDocActionId,
      ACME_TEAM_ID,
      meeting1Id,
      "Prepare payment API documentation",
      "Prepare complete payment API documentation prior to the payment launch.",
      rahulId,
      "2026-11-25",
      m1Segments[5].id,
      "2026-11-18T10:03:00Z",
      "2026-11-18T10:05:00Z"
    );
    db.prepare(
      `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, status, reviewed_by, reviewed_at, created_at)
       VALUES (?, ?, 'ACTION_ITEM', ?, ?, ?, 'APPROVED', ?, ?, ?)`
    ).run(
      "88888888-8888-8888-8888-888888888801",
      ACME_TEAM_ID,
      apiDocActionId,
      "Prepare payment API documentation",
      "Action extracted from Payment Launch Planning (Nov 18)",
      priyaId,
      "2026-11-18T10:05:00Z",
      "2026-11-18T10:04:00Z"
    );
    const meeting2Id = "33333333-3333-3333-3333-333333333302";
    const meeting2Transcript = `Rahul:
"Security certification will complete by December 8."`;
    db.prepare(
      `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, source_file_name, raw_transcript, processing_status, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?, ?, ?)`
    ).run(
      meeting2Id,
      ACME_TEAM_ID,
      "Security Review",
      "2026-11-20",
      "TXT",
      "security-review-nov20.txt",
      meeting2Transcript,
      "Confirmed security certification target completion date of December 8, 2026 as a prerequisite before the payment launch.",
      "2026-11-20T14:00:00Z",
      "2026-11-20T14:03:00Z"
    );
    const m2Seg1Id = "44444444-4444-4444-4444-444444444410";
    insertSegment.run(
      m2Seg1Id,
      meeting2Id,
      "Rahul",
      rahulId,
      "Security certification will complete by December 8.",
      1,
      "2026-11-20T14:01:00Z"
    );
    const secCertActionId = "77777777-7777-7777-7777-777777777702";
    db.prepare(
      `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'HIGH', 'IN_PROGRESS', 0, NULL, ?, ?, ?)`
    ).run(
      secCertActionId,
      ACME_TEAM_ID,
      meeting2Id,
      "Complete security certification",
      "Complete security certification required ahead of payment launch.",
      rahulId,
      "2026-12-08",
      m2Seg1Id,
      "2026-11-20T14:02:00Z",
      "2026-11-20T14:03:00Z"
    );
    db.prepare(
      `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, status, reviewed_by, reviewed_at, created_at)
       VALUES (?, ?, 'ACTION_ITEM', ?, ?, ?, 'APPROVED', ?, ?, ?)`
    ).run(
      "88888888-8888-8888-8888-888888888802",
      ACME_TEAM_ID,
      secCertActionId,
      "Complete security certification",
      "Action extracted from Security Review (Nov 20)",
      priyaId,
      "2026-11-20T14:03:00Z",
      "2026-11-20T14:02:30Z"
    );
    db.prepare(
      `INSERT INTO dependencies (id, team_id, source_type, source_id, target_type, target_id, relationship, description, created_at)
       VALUES (?, ?, 'ACTION_ITEM', ?, 'DECISION', ?, 'MUST_HAPPEN_BEFORE', ?, ?)`
    ).run(
      "99999999-9999-9999-9999-999999999901",
      ACME_TEAM_ID,
      secCertActionId,
      dec10DecisionId,
      "Security certification must be completed before Payment launch can go live.",
      "2026-11-20T14:03:00Z"
    );
    const insertMemory = db.prepare(
      `INSERT INTO memory_embeddings (id, team_id, source_type, source_id, content, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      "DECISION",
      dec10DecisionId,
      `Decision: Payment launch \u2014 Launch payment service on December 10, 2026 (effective 2026-12-10). Owner: Priya Sharma. Rationale: Engineering and security readiness aligned for December 10. Source quote: "Okay, let's make December 10 the launch date."`,
      JSON.stringify({ meetingId: meeting1Id, meetingTitle: "Payment Launch Planning", meetingDate: "2026-11-18", speaker: "Priya" }),
      "2026-11-18T10:05:00Z"
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      "ACTION_ITEM",
      apiDocActionId,
      "Action: Prepare payment API documentation. Owner: Rahul Mehta. Due: 2026-11-25. Status: OPEN.",
      JSON.stringify({ meetingId: meeting1Id, meetingTitle: "Payment Launch Planning", meetingDate: "2026-11-18", speaker: "Priya" }),
      "2026-11-18T10:05:00Z"
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      "ACTION_ITEM",
      secCertActionId,
      "Action: Complete security certification. Owner: Rahul Mehta. Due: 2026-12-08. Status: IN_PROGRESS. Dependency: Must happen before Payment launch.",
      JSON.stringify({ meetingId: meeting2Id, meetingTitle: "Security Review", meetingDate: "2026-11-20", speaker: "Rahul" }),
      "2026-11-20T14:03:00Z"
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      "MEETING_SUMMARY",
      meeting1Id,
      "Payment Launch Planning (2026-11-18): Team aligned on launching the payment service on December 10, 2026. Rahul will prepare payment API documentation by November 25.",
      JSON.stringify({ meetingId: meeting1Id, meetingTitle: "Payment Launch Planning", meetingDate: "2026-11-18" }),
      "2026-11-18T10:05:00Z"
    );
    insertMemory.run(
      randomUUID(),
      ACME_TEAM_ID,
      "MEETING_SUMMARY",
      meeting2Id,
      "Security Review (2026-11-20): Rahul confirmed security certification will complete by December 8, which must happen before Payment launch.",
      JSON.stringify({ meetingId: meeting2Id, meetingTitle: "Security Review", meetingDate: "2026-11-20" }),
      "2026-11-20T14:03:00Z"
    );
    const insertAudit = db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAudit.run(
      randomUUID(),
      ACME_TEAM_ID,
      priyaId,
      "MEETING_PROCESSED",
      "MEETING",
      meeting1Id,
      'Processed "Payment Launch Planning" (6 transcript segments analyzed, 1 decision and 1 action extracted).',
      JSON.stringify({ meetingDate: "2026-11-18" }),
      "2026-11-18T10:05:00Z"
    );
    insertAudit.run(
      randomUUID(),
      ACME_TEAM_ID,
      priyaId,
      "APPROVAL_GRANTED",
      "DECISION",
      dec10DecisionId,
      "Confirmed active decision: Payment launch on December 10, 2026.",
      JSON.stringify({ effectiveDate: "2026-12-10" }),
      "2026-11-18T10:05:30Z"
    );
    insertAudit.run(
      randomUUID(),
      ACME_TEAM_ID,
      rahulId,
      "MEETING_PROCESSED",
      "MEETING",
      meeting2Id,
      'Processed "Security Review" and linked dependency: Complete security certification (Dec 8) must happen before Payment launch.',
      JSON.stringify({ meetingDate: "2026-11-20" }),
      "2026-11-20T14:03:00Z"
    );
  });
  runSeed();
}
function resetAndSeedDemoWorkspace(db) {
  const clearAll = db.transaction(() => {
    db.exec(`
      DELETE FROM audit_events;
      DELETE FROM memory_embeddings;
      DELETE FROM weekly_digests;
      DELETE FROM reminders;
      DELETE FROM external_tasks;
      DELETE FROM approval_items;
      DELETE FROM conflicts;
      DELETE FROM dependencies;
      DELETE FROM action_items;
      DELETE FROM decision_versions;
      DELETE FROM decisions;
      DELETE FROM transcript_segments;
      DELETE FROM meetings;
      DELETE FROM team_members;
      DELETE FROM users;
      DELETE FROM teams;
    `);
  });
  clearAll();
  seedDemoWorkspace(db);
}

// server/agents/followup-agent.ts
import { randomUUID as randomUUID2 } from "crypto";
function daysBetween(isoFrom, isoTo) {
  const from = (/* @__PURE__ */ new Date(`${isoFrom}T00:00:00Z`)).getTime();
  const to = (/* @__PURE__ */ new Date(`${isoTo}T00:00:00Z`)).getTime();
  return Math.round((to - from) / (1e3 * 60 * 60 * 24));
}
function getCurrentIsoDate(referenceDate) {
  if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return referenceDate;
  }
  const now = /* @__PURE__ */ new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function evaluateReminders(db, teamId, referenceDate) {
  const today = getCurrentIsoDate(referenceDate);
  const actions = db.prepare(
    `SELECT a.*, COALESCE(u.name, a.owner_name) AS owner_name
       FROM action_items a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.team_id = ?
         AND a.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')`
  ).all(teamId);
  const upsertReminder = db.prepare(
    `INSERT INTO reminders (id, team_id, action_item_id, user_id, reminder_type, message, scheduled_for, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'), datetime('now'))
     ON CONFLICT(action_item_id, reminder_type) DO UPDATE SET
       message = excluded.message,
       user_id = excluded.user_id,
       scheduled_for = excluded.scheduled_for`
  );
  const openConflicts = db.prepare(`SELECT existing_item_id, new_item_id, conflict_type FROM conflicts WHERE team_id = ? AND status = 'OPEN'`).all(teamId);
  const conflictedIds = /* @__PURE__ */ new Set();
  for (const c of openConflicts) {
    conflictedIds.add(c.existing_item_id);
    conflictedIds.add(c.new_item_id);
  }
  for (const action of actions) {
    if (action.is_open_loop === 1 || !action.owner_id && !action.owner_name) {
      const reason = action.open_loop_reason || "Owner not confirmed";
      upsertReminder.run(
        randomUUID2(),
        teamId,
        action.id,
        action.owner_id,
        "AT_RISK",
        `At risk: "${action.title}" \u2014 ${reason}.`,
        today
      );
      continue;
    }
    if (!action.due_date) {
      continue;
    }
    const diff = daysBetween(today, action.due_date);
    if (diff < 0 && action.status !== "PROPOSED") {
      if (action.status !== "OVERDUE") {
        db.prepare(`UPDATE action_items SET status = 'OVERDUE', updated_at = datetime('now') WHERE id = ?`).run(
          action.id
        );
      }
      const overdueDays = Math.abs(diff);
      upsertReminder.run(
        randomUUID2(),
        teamId,
        action.id,
        action.owner_id,
        "OVERDUE",
        `Overdue by ${overdueDays} ${overdueDays === 1 ? "day" : "days"}: "${action.title}" (due ${action.due_date}).`,
        action.due_date
      );
    } else if (diff >= 0 && diff <= 1) {
      const whenLabel = diff === 0 ? "today" : "tomorrow";
      upsertReminder.run(
        randomUUID2(),
        teamId,
        action.id,
        action.owner_id,
        "AT_RISK",
        `At risk: "${action.title}" is due ${whenLabel} (${action.due_date}) and is still ${action.status.toLowerCase().replace("_", " ")}.`,
        action.due_date
      );
    } else if (diff >= 2 && diff <= 4) {
      upsertReminder.run(
        randomUUID2(),
        teamId,
        action.id,
        action.owner_id,
        "UPCOMING_DEADLINE",
        `Deadline approaching in ${diff} days (${action.due_date}): "${action.title}".`,
        action.due_date
      );
    } else if (conflictedIds.has(action.id)) {
      upsertReminder.run(
        randomUUID2(),
        teamId,
        action.id,
        action.owner_id,
        "AT_RISK",
        `At risk due to schedule dependency conflict: "${action.title}" (due ${action.due_date}).`,
        action.due_date
      );
    }
  }
  return db.prepare(
    `SELECT r.*,
              COALESCE(u.name, a.owner_name) AS user_name,
              a.title AS action_title,
              a.due_date AS due_date,
              a.status AS action_status
       FROM reminders r
       LEFT JOIN users u ON u.id = r.user_id
       JOIN action_items a ON a.id = r.action_item_id
       WHERE r.team_id = ?
         AND a.status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY
         CASE r.reminder_type WHEN 'OVERDUE' THEN 1 WHEN 'AT_RISK' THEN 2 ELSE 3 END,
         r.scheduled_for ASC`
  ).all(teamId);
}

// server/routes/api.ts
import express from "express";
import { randomUUID as randomUUID7 } from "crypto";

// server/validation/schemas.ts
import { z } from "zod";
var CreateMeetingRequestSchema = z.object({
  teamId: z.string().min(1).optional(),
  title: z.string().trim().min(2, "Meeting title must be at least 2 characters").max(200),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Meeting date must be YYYY-MM-DD"),
  sourceType: z.enum(["PASTE", "TXT", "MD"]).default("PASTE"),
  sourceFileName: z.string().max(255).nullable().optional(),
  transcript: z.string().trim().min(10, "Transcript must contain at least 10 characters")
});
var ApprovalDecisionRequestSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVE", "EDIT", "REJECT"]),
  reviewedBy: z.string().min(1).optional(),
  edits: z.object({
    title: z.string().trim().min(1).max(300).optional(),
    decisionText: z.string().trim().min(1).max(1e3).optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    ownerId: z.string().nullable().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    rationale: z.string().max(1e3).optional()
  }).optional()
});
var CreateGitHubIssueRequestSchema = z.object({
  actionItemId: z.string().min(1),
  approvalId: z.string().min(1).optional(),
  userId: z.string().min(1).optional()
});
var UpdateTaskStatusSchema = z.object({
  status: z.enum(["PROPOSED", "APPROVED", "OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE", "CANCELLED"]),
  userId: z.string().optional()
});
var MemoryQueryRequestSchema = z.object({
  teamId: z.string().min(1).optional(),
  question: z.string().trim().min(2, "Question is too short").max(1e3)
});
var GenerateDigestRequestSchema = z.object({
  teamId: z.string().min(1).optional(),
  userId: z.string().min(1)
});
var ResolveConflictSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]),
  userId: z.string().optional()
});
var ExtractedDecisionSchema = z.object({
  topic: z.string().min(1),
  decision_text: z.string().min(1),
  classification: z.enum(["PROPOSAL", "CONFIRMED_DECISION", "SUPERSESSION"]),
  owner_name: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  source_segment_sequence: z.number().int().min(1),
  confidence: z.number().min(0).max(1)
});
var ExtractedActionSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  owner_confirmed: z.boolean(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  is_open_loop: z.boolean(),
  open_loop_reason: z.string().nullable().optional(),
  source_segment_sequence: z.number().int().min(1)
});
var ExtractedDependencySchema = z.object({
  source_title: z.string().min(1),
  source_kind: z.enum(["DECISION", "ACTION_ITEM"]),
  target_title: z.string().min(1),
  target_kind: z.enum(["DECISION", "ACTION_ITEM"]),
  relationship: z.string().min(1),
  description: z.string().min(1),
  source_segment_sequence: z.number().int().min(1)
});
var ExtractedOpenLoopSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  source_segment_sequence: z.number().int().min(1)
});
var MeetingExtractionSchema = z.object({
  summary: z.string().min(1),
  mentioned_people: z.array(z.string()),
  decisions: z.array(ExtractedDecisionSchema),
  action_items: z.array(ExtractedActionSchema),
  dependencies: z.array(ExtractedDependencySchema),
  open_loops: z.array(ExtractedOpenLoopSchema)
});
var ConflictJudgmentSchema = z.object({
  has_conflict: z.boolean(),
  conflict_type: z.enum([
    "DECISION_CONFLICT",
    "DEADLINE_CONFLICT",
    "OWNER_CONFLICT",
    "DEPENDENCY_CONFLICT",
    "SUPERSESSION",
    "REVERSAL",
    "COMPATIBLE_UPDATE",
    "NONE"
  ]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  existing_item_id: z.string().nullable().optional(),
  existing_item_type: z.enum(["DECISION", "ACTION_ITEM", "DEPENDENCY"]).nullable().optional(),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  requires_approval: z.boolean()
});
var MemoryAnswerSchema = z.object({
  answer: z.string().min(1),
  has_sufficient_evidence: z.boolean(),
  cited_source_ids: z.array(z.string())
});

// server/routes/api.ts
init_client();

// server/github/issues.ts
function getGitHubConfigStatus() {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim() || null;
  const repo = process.env.GITHUB_REPO?.trim() || null;
  const missingVars = [];
  if (!token) missingVars.push("GITHUB_TOKEN");
  if (!owner) missingVars.push("GITHUB_OWNER");
  if (!repo) missingVars.push("GITHUB_REPO");
  return {
    configured: missingVars.length === 0,
    owner,
    repo,
    missingVars
  };
}
async function createGitHubIssue(params) {
  const config = getGitHubConfigStatus();
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!config.configured || !token || !config.owner || !config.repo) {
    throw new Error(
      `GitHub integration is not configured. Missing environment variables: ${config.missingVars.join(", ")}. Configure these server-side secrets to create real GitHub issues.`
    );
  }
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "DecisionFlow-Agent"
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      labels: params.labels ?? ["decisionflow"]
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  return {
    issueNumber: data.number,
    issueUrl: data.html_url,
    state: data.state
  };
}
async function fetchGitHubIssueState(issueNumber) {
  const config = getGitHubConfigStatus();
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!config.configured || !token || !config.owner || !config.repo) {
    throw new Error(
      `GitHub integration is not configured. Missing: ${config.missingVars.join(", ")}.`
    );
  }
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${encodeURIComponent(issueNumber)}`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DecisionFlow-Agent"
    }
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub sync error (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  return {
    state: data.state,
    htmlUrl: data.html_url
  };
}

// server/agents/approval-service.ts
import { randomUUID as randomUUID4 } from "crypto";

// server/utils/transcriptParser.ts
var NON_SPEAKER_LABELS = /* @__PURE__ */ new Set([
  "http",
  "https",
  "ftp",
  "mailto",
  "note",
  "notes",
  "summary",
  "agenda",
  "topic",
  "date",
  "time",
  "subject",
  "meeting",
  "attendees",
  "participants",
  "action",
  "actions",
  "action item",
  "action items",
  "decision",
  "decisions"
]);
var UNCONFIRMED_OWNER_TOKENS = /* @__PURE__ */ new Set([
  "unknown",
  "unknown speaker",
  "unassigned",
  "tbd",
  "none",
  "n/a",
  "na",
  "someone",
  "anyone",
  "somebody",
  "anybody",
  "everyone",
  "team",
  "the team"
]);
function extractSpeakerAndRole(raw) {
  const cleaned = raw.replace(/\*\*/g, "").trim();
  const roleMatch = cleaned.match(/^(.+?)\s*\(([^()]{1,60})\)\s*$/);
  if (roleMatch) {
    return {
      name: roleMatch[1].trim(),
      role: roleMatch[2].trim() || null
    };
  }
  return { name: cleaned, role: null };
}
function normalizeConfirmedPersonName(raw) {
  if (!raw) return null;
  const { name } = extractSpeakerAndRole(stripOuterQuotes(raw));
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  if (UNCONFIRMED_OWNER_TOKENS.has(lower) || lower.startsWith("someone ") || lower.startsWith("anyone ") || lower.startsWith("somebody ") || lower.startsWith("anybody ") || lower.startsWith("a member of ") || lower.includes("not confirmed") || lower.includes("unconfirmed") || /\bteam\b$/.test(lower)) {
    return null;
  }
  return cleaned;
}
function stripOuterQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("\u201C") && trimmed.endsWith("\u201D") || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
function parseTranscript(rawTranscript) {
  const normalized = rawTranscript.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const lines = normalized.split("\n");
  const segments = [];
  let pendingSpeaker = null;
  let pendingRole = null;
  let pendingTime = null;
  let buffer = [];
  const flush = () => {
    const joined = stripOuterQuotes(buffer.join(" ").trim());
    if (joined) {
      segments.push({
        sequenceNumber: segments.length + 1,
        speakerName: pendingSpeaker || "Unknown Speaker",
        speakerRole: pendingRole,
        startTime: pendingTime,
        endTime: null,
        text: joined
      });
    }
    pendingSpeaker = null;
    pendingRole = null;
    pendingTime = null;
    buffer = [];
  };
  const speakerHeaderRegex = /^(?:\[([^\]]+)\]\s*|\((\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\)\s*)?(?:\*\*([^*:]{1,90})\*\*|([^:*\n]{1,90}?))(?:\s*\(([^()]{1,60})\))?\s*:\s*(.*)$/;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (buffer.length > 0) {
        flush();
      }
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    const cleanedLine = line.startsWith(">") ? line.slice(1).trim() : line;
    const match = cleanedLine.match(speakerHeaderRegex);
    if (match) {
      const timestamp = (match[1] || match[2] || "").trim() || null;
      const rawSpeakerCandidate = (match[3] || match[4] || "").trim();
      const trailingRole = (match[5] || "").trim() || null;
      const rest = (match[6] || "").trim();
      const extracted = extractSpeakerAndRole(rawSpeakerCandidate);
      const speaker = extracted.name;
      const role = trailingRole ?? extracted.role;
      const wordCount = speaker ? speaker.split(/\s+/).length : 0;
      const startsWithLetter = /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(speaker);
      const validNameChars = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{0,48}$/.test(speaker);
      const isUrl = rest.startsWith("//") || speaker.toLowerCase().includes("http");
      const isNonSpeakerHeader = !role && NON_SPEAKER_LABELS.has(speaker.toLowerCase());
      if (speaker && startsWithLetter && validNameChars && wordCount <= 4 && !isUrl && !isNonSpeakerHeader) {
        if (pendingSpeaker !== null || buffer.length > 0) {
          flush();
        }
        pendingSpeaker = speaker;
        pendingRole = role;
        pendingTime = timestamp;
        if (rest) {
          buffer.push(rest);
        }
        continue;
      }
    }
    buffer.push(cleanedLine);
  }
  if (buffer.length > 0) {
    flush();
  }
  return segments;
}

// server/agents/approval-service.ts
init_client();

// server/memory/embeddings.ts
init_client();
import { randomUUID as randomUUID3 } from "crypto";
async function generateTextEmbedding(text) {
  if (!isGeminiConfigured() || !text.trim()) {
    return null;
  }
  try {
    const ai = getGeminiClient();
    const result = await ai.models.embedContent({
      model: getEmbeddingModel(),
      contents: text
    });
    const values = result.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
    return null;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}
function cosineSimilarity(a, b) {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
async function upsertMemoryRecord(db, params) {
  const embedding = await generateTextEmbedding(params.content);
  const embeddingJson = JSON.stringify(embedding ?? []);
  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;
  db.prepare(
    `INSERT INTO memory_embeddings (id, team_id, source_type, source_id, content, embedding, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_type, source_id) DO UPDATE SET
       content = excluded.content,
       embedding = CASE WHEN excluded.embedding != '[]' THEN excluded.embedding ELSE memory_embeddings.embedding END,
       metadata = excluded.metadata`
  ).run(
    randomUUID3(),
    params.teamId,
    params.sourceType,
    params.sourceId,
    params.content,
    embeddingJson,
    metadataJson
  );
}
async function backfillMissingEmbeddings(db, teamId) {
  if (!isGeminiConfigured()) {
    return;
  }
  const rows = db.prepare(`SELECT id, content FROM memory_embeddings WHERE team_id = ? AND (embedding = '[]' OR embedding IS NULL) LIMIT 12`).all(teamId);
  if (rows.length === 0) {
    return;
  }
  const updateStmt = db.prepare(`UPDATE memory_embeddings SET embedding = ? WHERE id = ?`);
  await Promise.allSettled(
    rows.map(async (row) => {
      const vec = await generateTextEmbedding(row.content);
      if (vec && vec.length > 0) {
        updateStmt.run(JSON.stringify(vec), row.id);
      }
    })
  );
}

// server/memory/retrieval.ts
function lexicalOverlapScore(query, text) {
  const stopWords = /* @__PURE__ */ new Set(["what", "when", "where", "which", "about", "with", "from", "that", "this", "have", "will", "does", "were", "been", "the", "and", "for", "are"]);
  const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !stopWords.has(t));
  if (tokens.length === 0) return 0;
  const hay = text.toLowerCase();
  let matches = 0;
  for (const token of tokens) {
    if (hay.includes(token)) {
      matches++;
    }
  }
  return matches / tokens.length;
}
function getStructuredDecisions(db, teamId) {
  return db.prepare(
    `SELECT d.*,
              COALESCE(u.name, d.owner_name) AS owner_name,
              ts.text AS source_quote,
              ts.speaker_name AS source_speaker,
              ts.speaker_role AS source_speaker_role,
              m.title AS meeting_title,
              m.meeting_date AS meeting_date
       FROM decisions d
       LEFT JOIN users u ON u.id = d.owner_id
       LEFT JOIN transcript_segments ts ON ts.id = d.source_segment_id
       LEFT JOIN meetings m ON m.id = d.meeting_id
       WHERE d.team_id = ?
       ORDER BY d.created_at DESC`
  ).all(teamId);
}
function getStructuredActions(db, teamId) {
  return db.prepare(
    `SELECT a.*,
              COALESCE(u.name, a.owner_name) AS owner_name,
              ts.text AS source_quote,
              ts.speaker_name AS source_speaker,
              ts.speaker_role AS source_speaker_role,
              m.title AS meeting_title,
              m.meeting_date AS meeting_date
       FROM action_items a
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
       LEFT JOIN meetings m ON m.id = a.meeting_id
       WHERE a.team_id = ?
       ORDER BY COALESCE(a.due_date, '9999-12-31') ASC, a.created_at DESC`
  ).all(teamId);
}
function getStructuredDependencies(db, teamId) {
  const rows = db.prepare(`SELECT * FROM dependencies WHERE team_id = ? ORDER BY created_at DESC`).all(teamId);
  return rows.map((dep) => {
    let sourceTitle = "";
    let sourceDate = null;
    let targetTitle = "";
    let targetDate = null;
    if (dep.source_type === "ACTION_ITEM") {
      const a = db.prepare(`SELECT title, due_date FROM action_items WHERE id = ?`).get(dep.source_id);
      if (a) {
        sourceTitle = a.title;
        sourceDate = a.due_date;
      }
    } else {
      const d = db.prepare(`SELECT topic, decision_text, effective_date FROM decisions WHERE id = ?`).get(dep.source_id);
      if (d) {
        sourceTitle = `${d.topic}: ${d.decision_text}`;
        sourceDate = d.effective_date;
      }
    }
    if (dep.target_type === "ACTION_ITEM") {
      const a = db.prepare(`SELECT title, due_date FROM action_items WHERE id = ?`).get(dep.target_id);
      if (a) {
        targetTitle = a.title;
        targetDate = a.due_date;
      }
    } else {
      const d = db.prepare(`SELECT topic, decision_text, effective_date FROM decisions WHERE id = ?`).get(dep.target_id);
      if (d) {
        targetTitle = `${d.topic}: ${d.decision_text}`;
        targetDate = d.effective_date;
      }
    }
    return {
      ...dep,
      source_title: sourceTitle,
      source_date: sourceDate,
      target_title: targetTitle,
      target_date: targetDate
    };
  });
}
async function retrieveHybridMemory(db, teamId, queryText, limit = 10) {
  await backfillMissingEmbeddings(db, teamId);
  const queryVector = await generateTextEmbedding(queryText);
  const memoryRows = db.prepare(`SELECT id, source_type, source_id, content, embedding, metadata FROM memory_embeddings WHERE team_id = ?`).all(teamId);
  const scored = memoryRows.map((row) => {
    let vecScore = 0;
    if (queryVector && row.embedding && row.embedding !== "[]") {
      try {
        const parsed = JSON.parse(row.embedding);
        vecScore = cosineSimilarity(queryVector, parsed);
      } catch {
        vecScore = 0;
      }
    }
    const lexScore = lexicalOverlapScore(queryText, row.content);
    const combined = queryVector ? vecScore * 0.65 + lexScore * 0.35 : lexScore;
    let meta = {};
    if (row.metadata) {
      try {
        meta = JSON.parse(row.metadata);
      } catch {
        meta = {};
      }
    }
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      content: row.content,
      similarityScore: Number(combined.toFixed(4)),
      metadata: meta
    };
  });
  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  const allDecisions = getStructuredDecisions(db, teamId);
  const activeDecisions = allDecisions.filter((d) => d.status === "ACTIVE");
  const historicalDecisions = allDecisions.filter((d) => d.status === "SUPERSEDED");
  const actionItems = getStructuredActions(db, teamId);
  const dependencies = getStructuredDependencies(db, teamId);
  const openConflicts = db.prepare(`SELECT * FROM conflicts WHERE team_id = ? AND status = 'OPEN' ORDER BY created_at DESC`).all(teamId);
  return {
    semanticMatches: scored.slice(0, limit),
    activeDecisions,
    historicalDecisions,
    actionItems,
    dependencies,
    openConflicts
  };
}

// server/agents/conflict-agent.ts
init_client();
import { ThinkingLevel, Type } from "@google/genai";
function runDeterministicConflictChecks(params) {
  const findings = [];
  const topicLower = params.proposedDecision.topic.toLowerCase();
  const proposedDate = params.proposedDecision.effective_date;
  for (const active of params.activeDecisions) {
    if (active.id === params.proposedDecision.id) continue;
    const activeTopicLower = active.topic.toLowerCase();
    const topicMatch = activeTopicLower === topicLower || activeTopicLower.includes(topicLower) || topicLower.includes(activeTopicLower);
    if (topicMatch && proposedDate && active.effective_date && proposedDate !== active.effective_date) {
      for (const dep of params.dependencies) {
        if (dep.target_type === "DECISION" && dep.target_id === active.id && dep.source_type === "ACTION_ITEM") {
          const prereq = params.actionItems.find((a) => a.id === dep.source_id);
          if (prereq?.due_date && proposedDate < prereq.due_date) {
            findings.push({
              conflictType: "DEPENDENCY_CONFLICT",
              severity: "HIGH",
              existingItemType: "ACTION_ITEM",
              existingItemId: prereq.id,
              explanation: `The proposed ${params.proposedDecision.topic} date (${proposedDate}) precedes the currently recorded prerequisite "${prereq.title}" scheduled for ${prereq.due_date}.`,
              confidence: 0.96
            });
          }
        }
      }
    }
  }
  return findings;
}
async function runConflictReasoningAgent(params) {
  const queryText = `${params.proposedDecision.topic} ${params.proposedDecision.decision_text} ${params.proposedDecision.effective_date ?? ""}`;
  const memory = await retrieveHybridMemory(params.db, params.teamId, queryText, 8);
  const candidateActiveDecisions = memory.activeDecisions.filter(
    (d) => d.id !== params.proposedDecision.id
  );
  const deterministicFindings = runDeterministicConflictChecks({
    proposedDecision: params.proposedDecision,
    activeDecisions: candidateActiveDecisions,
    actionItems: memory.actionItems,
    dependencies: memory.dependencies
  });
  if (candidateActiveDecisions.length === 0 && memory.dependencies.length === 0 && memory.actionItems.length === 0) {
    return {
      aiJudgment: {
        has_conflict: false,
        conflict_type: "NONE",
        severity: "LOW",
        existing_item_id: null,
        existing_item_type: null,
        explanation: "No prior conflicting organizational decisions or dependencies found in memory.",
        confidence: 0.95,
        requires_approval: true
      },
      deterministicFindings,
      memoryHitsCount: 0
    };
  }
  const activeDecisionsContext = candidateActiveDecisions.map(
    (d) => `- [DECISION id=${d.id}] Topic: "${d.topic}" | Text: "${d.decision_text}" | Effective Date: ${d.effective_date ?? "N/A"} | Owner: ${d.owner_name ?? "Unassigned"} | Meeting: "${d.meeting_title ?? ""}" (${d.meeting_date ?? ""}) | Quote (${d.source_speaker ?? "Unknown"}): "${d.source_quote ?? ""}"`
  ).join("\n");
  const actionsContext = memory.actionItems.slice(0, 12).map(
    (a) => `- [ACTION_ITEM id=${a.id}] Title: "${a.title}" | Due: ${a.due_date ?? "None"} | Status: ${a.status} | Owner: ${a.owner_name ?? "Unconfirmed"}`
  ).join("\n");
  const depsContext = memory.dependencies.map(
    (dep) => `- [DEPENDENCY id=${dep.id}] ${dep.source_title} (${dep.source_date ?? "no date"}) --[${dep.relationship}]--> ${dep.target_title} (${dep.target_date ?? "no date"}): ${dep.description ?? ""}`
  ).join("\n");
  const semanticContext = memory.semanticMatches.slice(0, 6).map((m) => `- (${m.sourceType}, score=${m.similarityScore}): ${m.content}`).join("\n");
  const deterministicNote = deterministicFindings.length > 0 ? `Deterministic rule checks already flagged:
${deterministicFindings.map((f) => `- ${f.conflictType} (${f.severity}): ${f.explanation}`).join("\n")}` : "No deterministic rule violations flagged yet.";
  const systemInstruction = `You are the DecisionFlow Conflict & Reasoning Agent.
Compare a newly extracted decision/proposal against historical organizational memory.

Guidelines:
- Do NOT label unrelated topics as conflicts.
- Distinguish between:
  - DECISION_CONFLICT: New proposal contradicts or changes an active decision with risk/unresolved impact (or creates a schedule tension).
  - DEPENDENCY_CONFLICT: New proposal violates or precedes a prerequisite dependency or milestone.
  - DEADLINE_CONFLICT: New deadline conflicts with an existing commitment.
  - OWNER_CONFLICT: Conflicting ownership assigned for the same commitment.
  - SUPERSESSION: Intentional, conflict-free replacement of a previous active decision.
  - REVERSAL: Reverting a previously confirmed decision.
  - COMPATIBLE_UPDATE / NONE: Additive or compatible with existing memory.
- Be accurate and cite the exact existing_item_id from the provided context when a conflict or supersession exists.
- If a prerequisite action (like security certification on Dec 8) happens AFTER the proposed launch date (like Dec 5), emphasize BOTH the prior active decision change (Dec 10 -> Dec 5) AND the prerequisite dependency risk in your explanation.`;
  const prompt = `New Proposed Decision:
- ID: ${params.proposedDecision.id}
- Topic: ${params.proposedDecision.topic}
- Decision Text: ${params.proposedDecision.decision_text}
- Effective Date: ${params.proposedDecision.effective_date ?? "N/A"}
- Source Speaker: ${params.sourceSpeaker ?? "Unknown"}
- Source Quote: "${params.sourceQuote ?? ""}"

Active Decisions in Memory:
${activeDecisionsContext || "None"}

Tracked Action Items:
${actionsContext || "None"}

Dependencies:
${depsContext || "None"}

Semantic Memory Matches:
${semanticContext || "None"}

${deterministicNote}`;
  const response = await generateContentResilient({
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          has_conflict: { type: Type.BOOLEAN },
          conflict_type: {
            type: Type.STRING,
            enum: [
              "DECISION_CONFLICT",
              "DEADLINE_CONFLICT",
              "OWNER_CONFLICT",
              "DEPENDENCY_CONFLICT",
              "SUPERSESSION",
              "REVERSAL",
              "COMPATIBLE_UPDATE",
              "NONE"
            ]
          },
          severity: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },
          existing_item_id: { type: Type.STRING, nullable: true },
          existing_item_type: { type: Type.STRING, enum: ["DECISION", "ACTION_ITEM", "DEPENDENCY"], nullable: true },
          explanation: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          requires_approval: { type: Type.BOOLEAN }
        },
        required: [
          "has_conflict",
          "conflict_type",
          "severity",
          "explanation",
          "confidence",
          "requires_approval"
        ]
      }
    }
  });
  const rawText = response.text;
  if (!rawText) {
    throw new Error("Conflict & Reasoning Agent received an empty response from Gemini.");
  }
  const parsed = ConflictJudgmentSchema.parse(JSON.parse(rawText));
  const validIds = /* @__PURE__ */ new Set([
    ...candidateActiveDecisions.map((d) => d.id),
    ...memory.actionItems.map((a) => a.id),
    ...memory.dependencies.map((dep) => dep.id)
  ]);
  if (parsed.existing_item_id && !validIds.has(parsed.existing_item_id)) {
    parsed.existing_item_id = candidateActiveDecisions[0]?.id ?? null;
    parsed.existing_item_type = parsed.existing_item_id ? "DECISION" : null;
  }
  return {
    aiJudgment: parsed,
    deterministicFindings,
    memoryHitsCount: memory.semanticMatches.length + candidateActiveDecisions.length
  };
}

// server/agents/meeting-agent.ts
init_client();
import { ThinkingLevel as ThinkingLevel2, Type as Type2 } from "@google/genai";
function resolveTeamMember(users, candidateName) {
  const normalized = normalizeConfirmedPersonName(candidateName);
  if (!normalized) return null;
  const cleaned = normalized.toLowerCase();
  const exact = users.find((u) => u.name.toLowerCase() === cleaned);
  if (exact) return exact;
  const matches = users.filter((u) => {
    const parts = u.name.toLowerCase().split(/\s+/);
    return parts.some((p) => p === cleaned) || u.name.toLowerCase().startsWith(cleaned);
  });
  return matches.length === 1 ? matches[0] : null;
}
function extractParticipantsFromSegments(segments) {
  const byKey = /* @__PURE__ */ new Map();
  for (const seg of segments) {
    const cleanName = normalizeConfirmedPersonName(seg.speaker_name);
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: cleanName,
        role: seg.speaker_role ?? null,
        userId: seg.speaker_id ?? null
      });
    } else {
      if (!existing.role && seg.speaker_role) existing.role = seg.speaker_role;
      if (!existing.userId && seg.speaker_id) existing.userId = seg.speaker_id;
    }
  }
  return Array.from(byKey.values());
}
function resolveOwnerIdentity(params) {
  if (!params.confirmed) {
    return { user: null, ownerName: null };
  }
  const normalized = normalizeConfirmedPersonName(params.candidateName);
  if (!normalized) {
    return { user: null, ownerName: null };
  }
  const matchedUser = resolveTeamMember(params.teamMembers, normalized);
  if (matchedUser) {
    return { user: matchedUser, ownerName: matchedUser.name };
  }
  const matchedParticipant = params.participants?.find(
    (p) => p.name.toLowerCase() === normalized.toLowerCase()
  );
  return {
    user: null,
    ownerName: matchedParticipant?.name ?? normalized
  };
}
async function runMeetingUnderstandingAgent(params, options) {
  const teamRoster = params.teamMembers.map((u) => `- ${u.name} (${u.role})`).join("\n");
  const dynamicParticipants = extractParticipantsFromSegments(params.segments);
  const participantsList = dynamicParticipants.length > 0 ? dynamicParticipants.map((p) => `- ${p.name}${p.role ? ` (${p.role})` : ""}`).join("\n") : "- None identified yet";
  const numberedTranscript = params.segments.map(
    (s) => `[#${s.sequence_number}] ${s.speaker_name}${s.speaker_role ? ` (${s.speaker_role})` : ""}: "${s.text}"`
  ).join("\n");
  const systemInstruction = `You are the DecisionFlow Meeting Understanding Agent.
Your job is to extract structured organizational memory from a meeting transcript.

Rules:
1. Distinguish carefully between:
   - PROPOSAL: tentative suggestion (e.g., "Maybe we should...", "What if we...").
   - CONFIRMED_DECISION: clear commitment or agreement made in the meeting (e.g., "Let's make December 10 the launch date", "Let's move the launch to December 5"). Note: even confirmed decisions in a meeting are proposed to the organization's Decision Inbox for governance review.
   - SUPERSESSION: explicitly changing or replacing a prior decision (e.g., "Let's move the launch from December 10 to December 5", "Let's move the launch to December 5").
2. Extract concrete action items with owners and due dates in YYYY-MM-DD format relative to the meeting date (${params.meetingDate}).
3. NEVER invent owners or deadlines. If an action item has no clear owner or the responsible person is ambiguous (e.g., "Someone from QA should test"), set owner_name to null, owner_confirmed to false, is_open_loop to true, and explain why in open_loop_reason (e.g. "Owner not confirmed"). For normal action items with a confirmed owner and deadline, set is_open_loop to false and omit open_loop_reason or set it to null.
4. Extract dependencies between items (e.g., if security certification is mentioned as needing to finish before launch, or an action blocks a decision, record relationship = "MUST_HAPPEN_BEFORE" or "DEPENDS_ON").
5. Every extracted decision, action item, dependency, and open loop MUST cite the exact integer source_segment_sequence from the numbered transcript.
6. Recognize speakers and owners dynamically from the transcript. If a speaker/owner clearly matches an existing Workspace Member (for example "Priya" -> "Priya Sharma"), you may use their canonical workspace name. If a speaker or owner is a new person from the transcript who is NOT in Workspace Members (for example "Karthik" or "Meera"), preserve their exact name from the transcript with owner_confirmed = true; NEVER drop them or remap them to a different workspace member.`;
  const prompt = `Meeting Title: ${params.meetingTitle}
Meeting Date: ${params.meetingDate}

Workspace Members:
${teamRoster}

Meeting Participants (extracted dynamically from transcript):
${participantsList}

Numbered Transcript:
${numberedTranscript}`;
  const response = await generateContentResilient({
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel2.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type2.OBJECT,
        properties: {
          summary: { type: Type2.STRING, description: "Concise 2-3 sentence executive summary of meeting outcomes." },
          mentioned_people: {
            type: Type2.ARRAY,
            items: { type: Type2.STRING }
          },
          decisions: {
            type: Type2.ARRAY,
            items: {
              type: Type2.OBJECT,
              properties: {
                topic: { type: Type2.STRING, description: 'Short canonical topic name, e.g. "Payment launch"' },
                decision_text: { type: Type2.STRING, description: "Clear statement of the proposed or confirmed decision." },
                classification: { type: Type2.STRING, enum: ["PROPOSAL", "CONFIRMED_DECISION", "SUPERSESSION"] },
                owner_name: { type: Type2.STRING, nullable: true },
                effective_date: { type: Type2.STRING, nullable: true, description: "YYYY-MM-DD date if a target/effective date is stated, else null." },
                rationale: { type: Type2.STRING, nullable: true },
                source_segment_sequence: { type: Type2.INTEGER },
                confidence: { type: Type2.NUMBER }
              },
              required: ["topic", "decision_text", "classification", "source_segment_sequence", "confidence"]
            }
          },
          action_items: {
            type: Type2.ARRAY,
            items: {
              type: Type2.OBJECT,
              properties: {
                title: { type: Type2.STRING },
                description: { type: Type2.STRING, nullable: true },
                owner_name: { type: Type2.STRING, nullable: true },
                owner_confirmed: { type: Type2.BOOLEAN },
                due_date: { type: Type2.STRING, nullable: true, description: "YYYY-MM-DD if stated, else null." },
                priority: { type: Type2.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },
                is_open_loop: { type: Type2.BOOLEAN },
                open_loop_reason: {
                  type: Type2.STRING,
                  nullable: true,
                  description: "Optional reason when is_open_loop is true; omit or null for normal action items."
                },
                source_segment_sequence: { type: Type2.INTEGER }
              },
              required: ["title", "owner_confirmed", "priority", "is_open_loop", "source_segment_sequence"]
            }
          },
          dependencies: {
            type: Type2.ARRAY,
            items: {
              type: Type2.OBJECT,
              properties: {
                source_title: { type: Type2.STRING },
                source_kind: { type: Type2.STRING, enum: ["DECISION", "ACTION_ITEM"] },
                target_title: { type: Type2.STRING },
                target_kind: { type: Type2.STRING, enum: ["DECISION", "ACTION_ITEM"] },
                relationship: { type: Type2.STRING, description: "e.g. MUST_HAPPEN_BEFORE or BLOCKS" },
                description: { type: Type2.STRING },
                source_segment_sequence: { type: Type2.INTEGER }
              },
              required: ["source_title", "source_kind", "target_title", "target_kind", "relationship", "description", "source_segment_sequence"]
            }
          },
          open_loops: {
            type: Type2.ARRAY,
            items: {
              type: Type2.OBJECT,
              properties: {
                title: { type: Type2.STRING },
                reason: { type: Type2.STRING },
                source_segment_sequence: { type: Type2.INTEGER }
              },
              required: ["title", "reason", "source_segment_sequence"]
            }
          }
        },
        required: ["summary", "mentioned_people", "decisions", "action_items", "dependencies", "open_loops"]
      }
    }
  }, options?.client ? { client: options.client } : void 0);
  const rawText = response.text;
  if (!rawText) {
    throw new Error("Meeting Understanding Agent received an empty response from Gemini.");
  }
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Meeting Understanding Agent returned invalid JSON: ${err.message}`);
  }
  return MeetingExtractionSchema.parse(parsedJson);
}
function getTeamMembers(db, teamId) {
  return db.prepare(
    `SELECT u.*
       FROM users u
       JOIN team_members tm ON tm.user_id = u.id
       WHERE tm.team_id = ?
       ORDER BY u.name ASC`
  ).all(teamId);
}

// server/agents/approval-service.ts
async function processMeetingPipeline(db, meetingId, options) {
  const meeting = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId);
  if (!meeting) {
    throw new Error("Meeting not found.");
  }
  if (meeting.processing_status === "PROCESSED") {
    const decCount = db.prepare(`SELECT COUNT(*) AS cnt FROM decisions WHERE meeting_id = ?`).get(meetingId).cnt;
    const actCount = db.prepare(`SELECT COUNT(*) AS cnt FROM action_items WHERE meeting_id = ?`).get(meetingId).cnt;
    const confCount = db.prepare(`SELECT COUNT(*) AS cnt FROM conflicts WHERE meeting_id = ?`).get(meetingId).cnt;
    return {
      meeting,
      alreadyProcessed: true,
      timeline: [
        {
          step: "Already processed",
          detail: "Returning existing extracted decisions, actions, and conflicts.",
          timestamp: meeting.updated_at
        }
      ],
      extractedDecisionsCount: decCount,
      extractedActionsCount: actCount,
      conflictsDetectedCount: confCount,
      approvalsCreatedCount: 0
    };
  }
  const timeline = [];
  const pushStep = (step, detail) => {
    timeline.push({ step, detail, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  };
  db.prepare(
    `UPDATE meetings SET processing_status = 'PROCESSING', processing_error = NULL, updated_at = datetime('now') WHERE id = ?`
  ).run(meetingId);
  try {
    const parsedSegments = parseTranscript(meeting.raw_transcript);
    if (parsedSegments.length === 0) {
      throw new Error("Transcript contains no recognizable statements.");
    }
    const teamMembers = getTeamMembers(db, meeting.team_id);
    db.transaction(() => {
      db.prepare(`DELETE FROM transcript_segments WHERE meeting_id = ?`).run(meetingId);
      const insertSeg = db.prepare(
        `INSERT INTO transcript_segments (id, meeting_id, speaker_name, speaker_role, speaker_id, start_time, end_time, text, sequence_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      );
      for (const seg of parsedSegments) {
        const matchedUser = resolveTeamMember(teamMembers, seg.speakerName);
        insertSeg.run(
          randomUUID4(),
          meetingId,
          seg.speakerName,
          seg.speakerRole,
          matchedUser?.id ?? null,
          seg.startTime,
          seg.endTime,
          seg.text,
          seg.sequenceNumber
        );
      }
    })();
    const storedSegments = db.prepare(`SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_number ASC`).all(meetingId);
    const dynamicParticipants = extractParticipantsFromSegments(storedSegments);
    pushStep(
      "Transcript parsed",
      `${storedSegments.length} speaker-attributed statements stored (${dynamicParticipants.length} participant${dynamicParticipants.length === 1 ? "" : "s"}).`
    );
    const segmentBySeq = /* @__PURE__ */ new Map();
    for (const s of storedSegments) {
      segmentBySeq.set(s.sequence_number, s);
    }
    const extractFn = options?.runExtraction ?? runMeetingUnderstandingAgent;
    const extractionRun = await runWithGeminiContext(
      () => extractFn({
        meetingTitle: meeting.title,
        meetingDate: meeting.meeting_date,
        segments: storedSegments,
        teamMembers
      })
    );
    const extraction = extractionRun.result;
    let fallbackEvents = [...extractionRun.fallbackEvents];
    pushStep(
      "Meeting understood",
      `${extraction.decisions.length} decision candidate(s), ${extraction.action_items.length} action(s), ${extraction.open_loops.length} open loop(s) extracted.`
    );
    const createdDecisions = [];
    const createdActions = [];
    let approvalsCreatedCount = 0;
    db.transaction(() => {
      for (const dec of extraction.decisions) {
        const seg = segmentBySeq.get(dec.source_segment_sequence) ?? storedSegments[0] ?? null;
        const resolvedDecOwner = resolveOwnerIdentity({
          candidateName: dec.owner_name ?? (seg?.speaker_name && seg.speaker_name !== "Unknown Speaker" ? seg.speaker_name : null),
          confirmed: true,
          teamMembers,
          participants: dynamicParticipants
        });
        const ownerUser = resolvedDecOwner.user ?? (seg?.speaker_id ? teamMembers.find((u) => u.id === seg.speaker_id) ?? null : null);
        const ownerName = ownerUser?.name ?? resolvedDecOwner.ownerName ?? null;
        const decId = randomUUID4();
        const isProposalFlag = dec.classification === "PROPOSAL" ? 1 : 0;
        db.prepare(
          `INSERT INTO decisions (id, team_id, meeting_id, topic, decision_text, status, owner_id, owner_name, rationale, effective_date, source_segment_id, supersedes_decision_id, is_proposal, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'))`
        ).run(
          decId,
          meeting.team_id,
          meetingId,
          dec.topic,
          dec.decision_text,
          ownerUser?.id ?? null,
          ownerName,
          dec.rationale ?? null,
          dec.effective_date ?? null,
          seg?.id ?? null,
          isProposalFlag
        );
        db.prepare(
          `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
           VALUES (?, ?, 1, ?, ?, 'PROPOSED', ?, ?, datetime('now'))`
        ).run(randomUUID4(), decId, dec.decision_text, dec.effective_date ?? null, meetingId, seg?.id ?? null);
        const savedDec = db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(decId);
        createdDecisions.push({ decision: savedDec, sourceSeg: seg });
      }
      for (const act of extraction.action_items) {
        const seg = segmentBySeq.get(act.source_segment_sequence) ?? storedSegments[0] ?? null;
        const resolvedOwner = resolveOwnerIdentity({
          candidateName: act.owner_name,
          confirmed: act.owner_confirmed,
          teamMembers,
          participants: dynamicParticipants
        });
        const ownerUser = resolvedOwner.user;
        const resolvedOwnerName = resolvedOwner.ownerName;
        const hasConfirmedOwner = Boolean(ownerUser || resolvedOwnerName);
        const isOpenLoop = act.is_open_loop || !hasConfirmedOwner || !act.due_date ? 1 : 0;
        const openLoopReason = (act.open_loop_reason?.trim() || null) ?? (!hasConfirmedOwner ? "Owner not confirmed" : !act.due_date ? "Deadline not specified" : null);
        const actId = randomUUID4();
        db.prepare(
          `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, owner_name, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, datetime('now'), datetime('now'))`
        ).run(
          actId,
          meeting.team_id,
          meetingId,
          act.title,
          act.description ?? null,
          ownerUser?.id ?? null,
          resolvedOwnerName,
          act.due_date ?? null,
          act.priority,
          isOpenLoop,
          openLoopReason,
          seg?.id ?? null
        );
        db.prepare(
          `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, proposed_payload, status, created_at)
           VALUES (?, ?, 'ACTION_ITEM', ?, ?, ?, ?, 'PENDING', datetime('now'))`
        ).run(
          randomUUID4(),
          meeting.team_id,
          actId,
          act.title,
          `Action item proposed from "${meeting.title}"${resolvedOwnerName ? ` \xB7 Owner: ${resolvedOwnerName}` : " \xB7 Owner not confirmed"}${act.due_date ? ` \xB7 Due: ${act.due_date}` : ""}`,
          JSON.stringify({
            actionId: actId,
            ownerId: ownerUser?.id ?? null,
            ownerName: resolvedOwnerName,
            dueDate: act.due_date ?? null,
            priority: act.priority
          })
        );
        approvalsCreatedCount++;
        const savedAct = db.prepare(`SELECT * FROM action_items WHERE id = ?`).get(actId);
        createdActions.push({ action: savedAct, sourceSeg: seg });
      }
      for (const loop of extraction.open_loops) {
        const alreadyCovered = createdActions.some(
          (a) => a.action.title.toLowerCase() === loop.title.toLowerCase()
        );
        if (!alreadyCovered) {
          const seg = segmentBySeq.get(loop.source_segment_sequence) ?? storedSegments[0] ?? null;
          const actId = randomUUID4();
          db.prepare(
            `INSERT INTO action_items (id, team_id, meeting_id, title, description, owner_id, due_date, priority, status, is_open_loop, open_loop_reason, source_segment_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, 'MEDIUM', 'PROPOSED', 1, ?, ?, datetime('now'), datetime('now'))`
          ).run(actId, meeting.team_id, meetingId, loop.title, loop.reason, loop.reason, seg?.id ?? null);
        }
      }
      const allDecisions = db.prepare(`SELECT id, topic, decision_text FROM decisions WHERE team_id = ?`).all(meeting.team_id);
      const allActions = db.prepare(`SELECT id, title FROM action_items WHERE team_id = ?`).all(meeting.team_id);
      const resolveEntity = (title, kind) => {
        const q = title.toLowerCase();
        if (kind === "ACTION_ITEM") {
          const found = allActions.find(
            (a) => a.title.toLowerCase().includes(q) || q.includes(a.title.toLowerCase())
          );
          if (found) return { type: "ACTION_ITEM", id: found.id };
        }
        const foundDec = allDecisions.find(
          (d) => d.topic.toLowerCase().includes(q) || q.includes(d.topic.toLowerCase()) || d.decision_text.toLowerCase().includes(q)
        );
        if (foundDec) return { type: "DECISION", id: foundDec.id };
        const fallbackAct = allActions.find(
          (a) => a.title.toLowerCase().includes(q) || q.includes(a.title.toLowerCase())
        );
        return fallbackAct ? { type: "ACTION_ITEM", id: fallbackAct.id } : null;
      };
      for (const dep of extraction.dependencies) {
        const src = resolveEntity(dep.source_title, dep.source_kind);
        const tgt = resolveEntity(dep.target_title, dep.target_kind);
        if (src && tgt && !(src.type === tgt.type && src.id === tgt.id)) {
          db.prepare(
            `INSERT OR IGNORE INTO dependencies (id, team_id, source_type, source_id, target_type, target_id, relationship, description, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          ).run(randomUUID4(), meeting.team_id, src.type, src.id, tgt.type, tgt.id, dep.relationship, dep.description);
        }
      }
    })();
    await Promise.allSettled([
      upsertMemoryRecord(db, {
        teamId: meeting.team_id,
        sourceType: "MEETING_SUMMARY",
        sourceId: meetingId,
        content: `${meeting.title} (${meeting.meeting_date}): ${extraction.summary}`,
        metadata: { meetingId, meetingTitle: meeting.title, meetingDate: meeting.meeting_date }
      }),
      ...storedSegments.map(
        (seg) => upsertMemoryRecord(db, {
          teamId: meeting.team_id,
          sourceType: "TRANSCRIPT",
          sourceId: seg.id,
          content: `${meeting.title} (${meeting.meeting_date}) \u2014 ${seg.speaker_name}: "${seg.text}"`,
          metadata: {
            meetingId,
            meetingTitle: meeting.title,
            meetingDate: meeting.meeting_date,
            speaker: seg.speaker_name
          }
        })
      )
    ]);
    pushStep("Memory indexed", "Meeting summary and transcript segments stored in semantic + structured memory.");
    let conflictsDetectedCount = 0;
    for (const { decision, sourceSeg } of createdDecisions) {
      const reasoningRun = await runWithGeminiContext(
        () => runConflictReasoningAgent({
          db,
          teamId: meeting.team_id,
          proposedDecision: decision,
          sourceQuote: sourceSeg?.text ?? null,
          sourceSpeaker: sourceSeg?.speaker_name ?? null
        })
      );
      fallbackEvents = [...fallbackEvents, ...reasoningRun.fallbackEvents];
      const reasoning = reasoningRun.result;
      pushStep(
        "Memory searched & reasoned",
        `Evaluated "${decision.topic}" against ${reasoning.memoryHitsCount} memory records.`
      );
      const { aiJudgment, deterministicFindings } = reasoning;
      let primaryExistingId = aiJudgment.existing_item_id;
      let primaryExistingType = aiJudgment.existing_item_type;
      if (deterministicFindings.length > 0 && !aiJudgment.has_conflict) {
        const topDet = deterministicFindings[0];
        primaryExistingId = topDet.existingItemId;
        primaryExistingType = topDet.existingItemType;
      }
      if (aiJudgment.has_conflict || deterministicFindings.length > 0 || aiJudgment.conflict_type === "SUPERSESSION") {
        const conflictType = aiJudgment.conflict_type !== "NONE" && aiJudgment.conflict_type !== "COMPATIBLE_UPDATE" ? aiJudgment.conflict_type : deterministicFindings[0]?.conflictType ?? "DECISION_CONFLICT";
        const severity = deterministicFindings.some((f) => f.severity === "HIGH") ? "HIGH" : aiJudgment.severity;
        const explanation = deterministicFindings.length > 0 && !aiJudgment.explanation.includes(deterministicFindings[0].explanation) ? `${aiJudgment.explanation} ${deterministicFindings[0].explanation}` : aiJudgment.explanation;
        const existingId = primaryExistingId ?? decision.id;
        const existingType = primaryExistingType ?? "DECISION";
        const conflictId = randomUUID4();
        db.prepare(
          `INSERT INTO conflicts (id, team_id, meeting_id, conflict_type, severity, status, existing_item_type, existing_item_id, new_item_type, new_item_id, explanation, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, 'DECISION', ?, ?, ?, datetime('now'))`
        ).run(
          conflictId,
          meeting.team_id,
          meetingId,
          conflictType,
          severity,
          existingType,
          existingId,
          decision.id,
          explanation,
          aiJudgment.confidence
        );
        conflictsDetectedCount++;
        pushStep("Conflict detected", `${conflictType} (${severity}): ${explanation}`);
        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'CONFLICT_DETECTED', 'CONFLICT', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID4(),
          meeting.team_id,
          decision.owner_id,
          conflictId,
          `Detected ${conflictType} (${severity}) on "${decision.topic}": ${explanation}`,
          JSON.stringify({ meetingId, decisionId: decision.id, confidence: aiJudgment.confidence })
        );
      }
      const approvalId = randomUUID4();
      db.prepare(
        `INSERT INTO approval_items (id, team_id, item_type, reference_id, title, description, proposed_payload, status, created_at)
         VALUES (?, ?, 'DECISION', ?, ?, ?, ?, 'PENDING', datetime('now'))`
      ).run(
        approvalId,
        meeting.team_id,
        decision.id,
        `${decision.topic}: ${decision.decision_text}`,
        aiJudgment.explanation,
        JSON.stringify({
          decisionId: decision.id,
          topic: decision.topic,
          effectiveDate: decision.effective_date,
          supersedesId: primaryExistingType === "DECISION" ? primaryExistingId : null
        })
      );
      approvalsCreatedCount++;
      db.prepare(
        `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
         VALUES (?, ?, ?, 'AI_PROPOSAL_CREATED', 'DECISION', ?, ?, ?, datetime('now'))`
      ).run(
        randomUUID4(),
        meeting.team_id,
        decision.owner_id,
        decision.id,
        `Proposed decision "${decision.topic}: ${decision.decision_text}" queued for human approval.`,
        JSON.stringify({ approvalId, meetingId })
      );
    }
    const aiFallbackUsed = fallbackEvents.length > 0;
    const aiStatus = aiFallbackUsed ? `AI fallback used (${fallbackEvents[fallbackEvents.length - 1].toModel})` : void 0;
    if (aiFallbackUsed) {
      pushStep(
        "AI fallback used",
        `Completed seamlessly using ${fallbackEvents[fallbackEvents.length - 1].toModel}.`
      );
    }
    pushStep("Approval required", `${approvalsCreatedCount} item(s) added to Decision Inbox.`);
    db.prepare(
      `UPDATE meetings SET processing_status = 'PROCESSED', summary = ?, processing_error = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(extraction.summary, meetingId);
    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, NULL, 'MEETING_PROCESSED', 'MEETING', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID4(),
      meeting.team_id,
      meetingId,
      `Processed "${meeting.title}": ${createdDecisions.length} decision(s), ${createdActions.length} action(s), ${conflictsDetectedCount} conflict(s).`,
      JSON.stringify({ timeline, aiFallbackUsed, aiStatus })
    );
    evaluateReminders(db, meeting.team_id);
    const updatedMeeting = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId);
    return {
      meeting: updatedMeeting,
      alreadyProcessed: false,
      timeline,
      extractedDecisionsCount: createdDecisions.length,
      extractedActionsCount: createdActions.length,
      conflictsDetectedCount,
      approvalsCreatedCount,
      aiFallbackUsed,
      aiStatus
    };
  } catch (err) {
    const cleanMessage = sanitizeGeminiErrorMessage(err) || "Meeting processing failed.";
    db.prepare(
      `UPDATE meetings SET processing_status = 'FAILED', processing_error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cleanMessage, meetingId);
    if (err instanceof Error && err.message === cleanMessage) {
      throw err;
    }
    throw new Error(cleanMessage);
  }
}
async function handleHumanApproval(db, params) {
  const approval = db.prepare(`SELECT * FROM approval_items WHERE id = ?`).get(params.approvalId);
  if (!approval) {
    throw new Error("Approval item not found.");
  }
  if (approval.status !== "PENDING") {
    throw new Error(`Approval item has already been reviewed (${approval.status}).`);
  }
  const nextApprovalStatus = params.decision === "REJECT" ? "REJECTED" : params.decision === "EDIT" ? "EDITED" : "APPROVED";
  let supersededDecisionId = null;
  let activatedDecisionId = null;
  const affectedItems = [];
  let summaryMessage = "";
  db.transaction(() => {
    db.prepare(
      `UPDATE approval_items SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(nextApprovalStatus, params.reviewedBy ?? null, approval.id);
    if (approval.item_type === "DECISION") {
      const proposedDec = db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(approval.reference_id);
      if (!proposedDec) {
        throw new Error("Referenced decision not found.");
      }
      if (params.decision === "REJECT") {
        db.prepare(`UPDATE decisions SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(
          proposedDec.id
        );
        db.prepare(
          `UPDATE conflicts SET status = 'DISMISSED', resolved_at = datetime('now') WHERE new_item_id = ? AND status = 'OPEN'`
        ).run(proposedDec.id);
        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_REJECTED', 'DECISION', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID4(),
          approval.team_id,
          params.reviewedBy ?? null,
          proposedDec.id,
          `Rejected proposed decision "${proposedDec.topic}: ${proposedDec.decision_text}". Existing organizational memory preserved.`,
          JSON.stringify({ approvalId: approval.id })
        );
        summaryMessage = `Proposed change for "${proposedDec.topic}" was rejected. Existing active decision remains unchanged.`;
      } else {
        const finalDecisionText = params.edits?.decisionText ?? proposedDec.decision_text;
        const finalEffectiveDate = params.edits?.effectiveDate !== void 0 ? params.edits.effectiveDate : proposedDec.effective_date;
        const finalOwnerId = params.edits?.ownerId !== void 0 ? params.edits.ownerId : proposedDec.owner_id;
        const finalOwnerName = params.edits?.ownerId !== void 0 ? finalOwnerId ? db.prepare(`SELECT name FROM users WHERE id = ?`).get(finalOwnerId)?.name ?? null : null : proposedDec.owner_name ?? null;
        const finalRationale = params.edits?.rationale !== void 0 ? params.edits.rationale : proposedDec.rationale;
        const activeMatches = db.prepare(
          `SELECT * FROM decisions
             WHERE team_id = ? AND status = 'ACTIVE' AND id != ?
               AND (LOWER(topic) = LOWER(?) OR LOWER(topic) LIKE '%' || LOWER(?) || '%' OR LOWER(?) LIKE '%' || LOWER(topic) || '%')`
        ).all(approval.team_id, proposedDec.id, proposedDec.topic, proposedDec.topic, proposedDec.topic);
        const previousActive = activeMatches[0] ?? null;
        if (previousActive) {
          supersededDecisionId = previousActive.id;
          db.prepare(`UPDATE decisions SET status = 'SUPERSEDED', updated_at = datetime('now') WHERE id = ?`).run(
            previousActive.id
          );
          const maxVerRow = db.prepare(`SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM decision_versions WHERE decision_id = ?`).get(previousActive.id);
          db.prepare(
            `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
             VALUES (?, ?, ?, ?, ?, 'SUPERSEDED', ?, ?, datetime('now'))`
          ).run(
            randomUUID4(),
            previousActive.id,
            maxVerRow.max_ver + 1,
            previousActive.decision_text,
            previousActive.effective_date,
            proposedDec.meeting_id,
            proposedDec.source_segment_id
          );
          db.prepare(
            `UPDATE dependencies SET target_id = ? WHERE team_id = ? AND target_type = 'DECISION' AND target_id = ?`
          ).run(proposedDec.id, approval.team_id, previousActive.id);
          db.prepare(
            `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
             VALUES (?, ?, ?, 'DECISION_SUPERSEDED', 'DECISION', ?, ?, ?, datetime('now'))`
          ).run(
            randomUUID4(),
            approval.team_id,
            params.reviewedBy ?? null,
            previousActive.id,
            `Superseded "${previousActive.decision_text}" (${previousActive.effective_date ?? "N/A"}) with "${finalDecisionText}" (${finalEffectiveDate ?? "N/A"}).`,
            JSON.stringify({ supersededBy: proposedDec.id, approvalId: approval.id })
          );
        }
        db.prepare(
          `UPDATE decisions
           SET decision_text = ?, effective_date = ?, owner_id = ?, owner_name = ?, rationale = ?,
               status = 'ACTIVE', is_proposal = 0, supersedes_decision_id = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          finalDecisionText,
          finalEffectiveDate,
          finalOwnerId,
          finalOwnerName,
          finalRationale,
          supersededDecisionId,
          proposedDec.id
        );
        activatedDecisionId = proposedDec.id;
        const maxNewVer = db.prepare(`SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM decision_versions WHERE decision_id = ?`).get(proposedDec.id);
        db.prepare(
          `INSERT INTO decision_versions (id, decision_id, version_number, decision_text, effective_date, status, source_meeting_id, source_segment_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, datetime('now'))`
        ).run(
          randomUUID4(),
          proposedDec.id,
          maxNewVer.max_ver + 1,
          finalDecisionText,
          finalEffectiveDate,
          proposedDec.meeting_id,
          proposedDec.source_segment_id
        );
        db.prepare(
          `UPDATE conflicts SET status = 'RESOLVED', resolved_at = datetime('now') WHERE new_item_id = ? AND status = 'OPEN'`
        ).run(proposedDec.id);
        const deps = getStructuredDependencies(db, approval.team_id).filter(
          (dep) => dep.target_type === "DECISION" && dep.target_id === proposedDec.id || dep.source_type === "DECISION" && dep.source_id === proposedDec.id
        );
        for (const dep of deps) {
          if (dep.source_type === "ACTION_ITEM" && dep.source_date && finalEffectiveDate && finalEffectiveDate < dep.source_date) {
            affectedItems.push({
              type: "ACTION_ITEM",
              id: dep.source_id,
              title: dep.source_title ?? "Prerequisite action",
              warning: `Scheduled for ${dep.source_date}, which is after the new active date (${finalEffectiveDate}). Needs acceleration or rescheduling.`
            });
          }
        }
        const relatedActions = db.prepare(
          `SELECT id, title, due_date FROM action_items WHERE team_id = ? AND meeting_id = ? AND status IN ('PROPOSED', 'OPEN', 'APPROVED')`
        ).all(approval.team_id, proposedDec.meeting_id);
        for (const ra of relatedActions) {
          if (!affectedItems.some((item) => item.id === ra.id)) {
            affectedItems.push({
              type: "ACTION_ITEM",
              id: ra.id,
              title: ra.title,
              warning: `Execution item linked to updated decision${ra.due_date ? ` (due ${ra.due_date})` : ""}.`
            });
          }
        }
        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_GRANTED', 'DECISION', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID4(),
          approval.team_id,
          params.reviewedBy ?? null,
          proposedDec.id,
          `Approved decision update: "${proposedDec.topic}" is now ACTIVE (${finalEffectiveDate ?? "no date"}). ${affectedItems.length} dependent/related item(s) identified.`,
          JSON.stringify({ approvalId: approval.id, supersededDecisionId, affectedItemsCount: affectedItems.length })
        );
        summaryMessage = `${finalEffectiveDate ? `${finalEffectiveDate} (${proposedDec.topic})` : proposedDec.topic} is now active.${affectedItems.length > 0 ? ` ${affectedItems.length} dependent or linked item(s) may be affected.` : ""}`;
      }
    } else if (approval.item_type === "ACTION_ITEM") {
      const action = db.prepare(`SELECT * FROM action_items WHERE id = ?`).get(approval.reference_id);
      if (!action) {
        throw new Error("Referenced action item not found.");
      }
      if (params.decision === "REJECT") {
        db.prepare(`UPDATE action_items SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(
          action.id
        );
        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_REJECTED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID4(),
          approval.team_id,
          params.reviewedBy ?? null,
          action.id,
          `Rejected proposed action "${action.title}".`,
          JSON.stringify({ approvalId: approval.id })
        );
        summaryMessage = `Action "${action.title}" rejected and cancelled.`;
      } else {
        const finalTitle = params.edits?.title ?? action.title;
        const finalDueDate = params.edits?.dueDate !== void 0 ? params.edits.dueDate : action.due_date;
        const finalOwnerId = params.edits?.ownerId !== void 0 ? params.edits.ownerId : action.owner_id;
        const finalOwnerName = params.edits?.ownerId !== void 0 ? finalOwnerId ? db.prepare(`SELECT name FROM users WHERE id = ?`).get(finalOwnerId)?.name ?? null : null : action.owner_name ?? null;
        const finalPriority = params.edits?.priority ?? action.priority;
        const isOpenLoop = (finalOwnerId || finalOwnerName) && finalDueDate ? 0 : action.is_open_loop;
        db.prepare(
          `UPDATE action_items
           SET title = ?, due_date = ?, owner_id = ?, owner_name = ?, priority = ?, is_open_loop = ?, status = 'APPROVED', updated_at = datetime('now')
           WHERE id = ?`
        ).run(finalTitle, finalDueDate, finalOwnerId, finalOwnerName, finalPriority, isOpenLoop, action.id);
        db.prepare(
          `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
           VALUES (?, ?, ?, 'APPROVAL_GRANTED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID4(),
          approval.team_id,
          params.reviewedBy ?? null,
          action.id,
          `Approved action item "${finalTitle}" for execution.`,
          JSON.stringify({ approvalId: approval.id })
        );
        summaryMessage = `Action "${finalTitle}" is approved and ready for GitHub execution.`;
      }
    }
  })();
  if (activatedDecisionId) {
    const d = db.prepare(
      `SELECT d.*, COALESCE(u.name, d.owner_name) AS owner_name, m.title AS meeting_title, m.meeting_date AS meeting_date
         FROM decisions d
         LEFT JOIN users u ON u.id = d.owner_id
         LEFT JOIN meetings m ON m.id = d.meeting_id
         WHERE d.id = ?`
    ).get(activatedDecisionId);
    if (d) {
      await upsertMemoryRecord(db, {
        teamId: d.team_id,
        sourceType: "DECISION",
        sourceId: d.id,
        content: `ACTIVE Decision: ${d.topic} \u2014 ${d.decision_text} (effective ${d.effective_date ?? "N/A"}). Owner: ${d.owner_name ?? "Unassigned"}. Meeting: ${d.meeting_title ?? ""} (${d.meeting_date ?? ""}).`,
        metadata: {
          meetingId: d.meeting_id,
          meetingTitle: d.meeting_title,
          meetingDate: d.meeting_date,
          status: d.status
        }
      });
    }
  }
  if (supersededDecisionId) {
    const oldD = db.prepare(
      `SELECT d.*, m.title AS meeting_title, m.meeting_date AS meeting_date
         FROM decisions d
         LEFT JOIN meetings m ON m.id = d.meeting_id
         WHERE d.id = ?`
    ).get(supersededDecisionId);
    if (oldD) {
      await upsertMemoryRecord(db, {
        teamId: oldD.team_id,
        sourceType: "DECISION",
        sourceId: oldD.id,
        content: `SUPERSEDED Decision: ${oldD.topic} \u2014 ${oldD.decision_text} (effective ${oldD.effective_date ?? "N/A"}). Replaced by newer active decision.`,
        metadata: {
          meetingId: oldD.meeting_id,
          meetingTitle: oldD.meeting_title,
          meetingDate: oldD.meeting_date,
          status: "SUPERSEDED"
        }
      });
    }
  }
  evaluateReminders(db, approval.team_id);
  const updatedApproval = db.prepare(`SELECT * FROM approval_items WHERE id = ?`).get(approval.id);
  return {
    approval: updatedApproval,
    message: summaryMessage,
    supersededDecisionId,
    activatedDecisionId,
    affectedItems
  };
}

// server/agents/execution-agent.ts
import { randomUUID as randomUUID5 } from "crypto";
var GovernanceError = class extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
};
async function executeApprovedActionToGitHub(db, params) {
  const action = db.prepare(
    `SELECT a.*,
              COALESCE(u.name, a.owner_name) AS owner_name,
              m.title AS meeting_title,
              m.meeting_date AS meeting_date,
              ts.text AS source_quote,
              ts.speaker_name AS source_speaker
       FROM action_items a
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN meetings m ON m.id = a.meeting_id
       LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
       WHERE a.id = ?`
  ).get(params.actionItemId);
  if (!action) {
    throw new GovernanceError("ACTION_NOT_FOUND", "Action item not found.", 404);
  }
  const existingTask = db.prepare(`SELECT * FROM external_tasks WHERE action_item_id = ?`).get(action.id);
  if (existingTask) {
    return { externalTask: existingTask, alreadyExisted: true };
  }
  const approval = params.approvalId ? db.prepare(`SELECT * FROM approval_items WHERE id = ? AND item_type = 'ACTION_ITEM' AND reference_id = ?`).get(
    params.approvalId,
    action.id
  ) : db.prepare(`SELECT * FROM approval_items WHERE item_type = 'ACTION_ITEM' AND reference_id = ?`).get(action.id);
  if (!approval) {
    throw new GovernanceError(
      "APPROVAL_REQUIRED",
      "Execution blocked: No approval record exists for this action item.",
      403
    );
  }
  if (approval.status !== "APPROVED" && approval.status !== "EDITED") {
    throw new GovernanceError(
      "APPROVAL_NOT_GRANTED",
      `Execution blocked: Approval status is "${approval.status}". Human approval (APPROVED) is required before external execution.`,
      403
    );
  }
  const activeDecisions = db.prepare(`SELECT topic, decision_text, effective_date FROM decisions WHERE team_id = ? AND status = 'ACTIVE' LIMIT 5`).all(action.team_id);
  const decisionContext = activeDecisions.length > 0 ? activeDecisions.map((d) => `- **${d.topic}**: ${d.decision_text}${d.effective_date ? ` (Effective: ${d.effective_date})` : ""}`).join("\n") : "- None linked";
  const body = `### DecisionFlow Tracked Action

${action.description || action.title}

---

#### Execution Details
- **Owner:** ${action.owner_name ?? "Owner not confirmed"}
- **Due Date:** ${action.due_date ?? "No deadline set"}
- **Priority:** ${action.priority}
- **DecisionFlow Action ID:** \`${action.id}\`
- **Approval Record:** \`${approval.id}\` (${approval.status})

#### Provenance
- **Source Meeting:** ${action.meeting_title ?? "Unknown"} (${action.meeting_date ?? ""})
- **Speaker Evidence (${action.source_speaker ?? "Speaker"}):**
  > "${action.source_quote ?? "Extracted from meeting transcript"}"

#### Related Active Decisions
${decisionContext}
`;
  const issue = await createGitHubIssue({
    title: action.title,
    body,
    labels: ["decisionflow", action.priority.toLowerCase()]
  });
  const externalTaskId = randomUUID5();
  const mappedInternalStatus = issue.state === "closed" ? "COMPLETED" : "OPEN";
  const saveTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO external_tasks (id, action_item_id, provider, external_id, external_url, external_status, created_at, updated_at)
       VALUES (?, ?, 'github', ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(externalTaskId, action.id, String(issue.issueNumber), issue.issueUrl, issue.state);
    db.prepare(`UPDATE action_items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      mappedInternalStatus,
      action.id
    );
    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, ?, 'GITHUB_TASK_CREATED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID5(),
      action.team_id,
      params.actorUserId ?? approval.reviewed_by ?? action.owner_id,
      action.id,
      `Created GitHub Issue #${issue.issueNumber} for "${action.title}".`,
      JSON.stringify({
        externalId: String(issue.issueNumber),
        externalUrl: issue.issueUrl,
        approvalId: approval.id
      })
    );
  });
  saveTx();
  const saved = db.prepare(`SELECT * FROM external_tasks WHERE id = ?`).get(externalTaskId);
  return { externalTask: saved, alreadyExisted: false };
}
async function syncExternalTaskWithGitHub(db, actionItemId) {
  const existing = db.prepare(`SELECT * FROM external_tasks WHERE action_item_id = ?`).get(actionItemId);
  if (!existing) {
    throw new GovernanceError("EXTERNAL_TASK_NOT_FOUND", "No GitHub issue linked to this task.", 404);
  }
  const remote = await fetchGitHubIssueState(existing.external_id);
  const mappedStatus = remote.state === "closed" ? "COMPLETED" : "OPEN";
  db.prepare(
    `UPDATE external_tasks SET external_status = ?, external_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(remote.state, remote.htmlUrl, existing.id);
  db.prepare(`UPDATE action_items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    mappedStatus,
    actionItemId
  );
  return db.prepare(`SELECT * FROM external_tasks WHERE id = ?`).get(existing.id);
}

// server/agents/digest-agent.ts
init_client();
import { randomUUID as randomUUID6 } from "crypto";
async function generateWeeklyDigestForUser(db, params) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(params.userId);
  if (!user) {
    throw new Error("User not found.");
  }
  const today = getCurrentIsoDate(params.referenceDate);
  const weekStartDate = /* @__PURE__ */ new Date(`${today}T00:00:00Z`);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = today;
  const userActions = db.prepare(
    `SELECT a.*, m.title AS meeting_title, m.meeting_date AS meeting_date
       FROM action_items a
       LEFT JOIN meetings m ON m.id = a.meeting_id
       WHERE a.team_id = ? AND a.owner_id = ?
       ORDER BY COALESCE(a.due_date, '9999-12-31') ASC`
  ).all(params.teamId, params.userId);
  const teamOpenLoops = db.prepare(
    `SELECT a.*, m.title AS meeting_title
       FROM action_items a
       LEFT JOIN meetings m ON m.id = a.meeting_id
       WHERE a.team_id = ? AND a.is_open_loop = 1 AND a.status NOT IN ('COMPLETED', 'CANCELLED')`
  ).all(params.teamId);
  const reminders = db.prepare(
    `SELECT r.*, a.title AS action_title, a.due_date AS due_date, a.status AS action_status
       FROM reminders r
       JOIN action_items a ON a.id = r.action_item_id
       WHERE r.team_id = ? AND (r.user_id = ? OR r.user_id IS NULL)
         AND a.status NOT IN ('COMPLETED', 'CANCELLED')`
  ).all(params.teamId, params.userId);
  const decisions = db.prepare(
    `SELECT d.*, COALESCE(u.name, d.owner_name) AS owner_name
       FROM decisions d
       LEFT JOIN users u ON u.id = d.owner_id
       WHERE d.team_id = ? AND d.status IN ('ACTIVE', 'SUPERSEDED', 'PROPOSED')
       ORDER BY d.updated_at DESC`
  ).all(params.teamId);
  const openConflicts = db.prepare(`SELECT * FROM conflicts WHERE team_id = ? AND status = 'OPEN' ORDER BY created_at DESC`).all(params.teamId);
  const needsAttention = [];
  const atRisk = [];
  const completed = [];
  for (const act of userActions) {
    if (act.status === "COMPLETED") {
      completed.push({
        title: act.title,
        completedAt: act.updated_at.slice(0, 10)
      });
      continue;
    }
    if (act.status === "CANCELLED" || act.status === "REJECTED") {
      continue;
    }
    const matchingReminder = reminders.find((r) => r.action_item_id === act.id);
    if (act.status === "OVERDUE" || matchingReminder?.reminder_type === "OVERDUE" || matchingReminder?.reminder_type === "AT_RISK") {
      atRisk.push({
        title: act.title,
        dueDate: act.due_date,
        reason: matchingReminder?.message ?? `Status is ${act.status} with deadline ${act.due_date ?? "unspecified"}.`,
        actionId: act.id
      });
    }
    if (act.status === "OPEN" || act.status === "IN_PROGRESS" || act.status === "APPROVED" || act.status === "OVERDUE") {
      needsAttention.push({
        title: act.title,
        dueDate: act.due_date,
        status: act.status,
        reason: matchingReminder?.message ?? (act.due_date ? `Due ${act.due_date}` : "No deadline assigned"),
        actionId: act.id
      });
    }
  }
  const decisionsAffectingYou = [];
  for (const dec of decisions) {
    if (dec.status === "ACTIVE" || dec.status === "PROPOSED") {
      const prev = dec.supersedes_decision_id ? decisions.find((x) => x.id === dec.supersedes_decision_id) : void 0;
      decisionsAffectingYou.push({
        topic: dec.topic,
        summary: prev ? `${dec.topic} moved (${prev.effective_date ?? "previous"} -> ${dec.effective_date ?? "current"})` : dec.decision_text,
        status: dec.status,
        previousDate: prev?.effective_date ?? null,
        currentDate: dec.effective_date ?? null,
        decisionId: dec.id
      });
    }
  }
  const openLoops = teamOpenLoops.map((loop) => ({
    title: loop.title,
    reason: loop.open_loop_reason || "Owner or deadline not confirmed",
    meetingTitle: loop.meeting_title ?? "Recent meeting"
  }));
  const unresolvedConflicts = openConflicts.map((c) => ({
    explanation: c.explanation,
    severity: c.severity,
    conflictId: c.id
  }));
  let summary = `${user.name} has ${needsAttention.length} active item(s), ${atRisk.length} at-risk item(s), and ${completed.length} completed task(s). ${decisionsAffectingYou.length} organizational decision(s) and ${unresolvedConflicts.length} open conflict(s) are tracked.`;
  if (isGeminiConfigured()) {
    try {
      const resp = await generateContentResilient({
        contents: `Write a crisp 2-3 sentence executive weekly execution summary for ${user.name} (${user.role}) strictly from these verified database facts. Do not invent any facts.

Facts:
${JSON.stringify({
          needsAttention,
          atRisk,
          decisionsAffectingYou,
          openLoops,
          completed,
          unresolvedConflicts
        })}`,
        config: {
          systemInstruction: "You are DecisionFlow Digest Agent. Write calm, factual executive prose summarizing real execution state, changed decisions, risks, and open loops."
        }
      });
      if (resp.text?.trim()) {
        summary = resp.text.trim();
      }
    } catch (err) {
      console.error("Digest summary synthesis error:", err);
    }
  }
  const content = {
    summary,
    needsAttention,
    atRisk,
    decisionsAffectingYou,
    openLoops,
    completed,
    unresolvedConflicts
  };
  const digestId = randomUUID6();
  db.prepare(
    `INSERT INTO weekly_digests (id, team_id, user_id, week_start, week_end, content, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(digestId, params.teamId, params.userId, weekStart, weekEnd, JSON.stringify(content));
  db.prepare(
    `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
     VALUES (?, ?, ?, 'DIGEST_GENERATED', 'WEEKLY_DIGEST', ?, ?, ?, datetime('now'))`
  ).run(
    randomUUID6(),
    params.teamId,
    params.userId,
    digestId,
    `Generated weekly execution digest for ${user.name}.`,
    JSON.stringify({ weekStart, weekEnd })
  );
  return {
    id: digestId,
    team_id: params.teamId,
    user_id: params.userId,
    user_name: user.name,
    week_start: weekStart,
    week_end: weekEnd,
    content,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// server/agents/memory-qa-agent.ts
init_client();
import { ThinkingLevel as ThinkingLevel3, Type as Type3 } from "@google/genai";
async function runAskMemoryAgent(params) {
  const memory = await retrieveHybridMemory(params.db, params.teamId, params.question, 10);
  const sourceMap = /* @__PURE__ */ new Map();
  const evidenceLines = [];
  for (const d of [...memory.activeDecisions, ...memory.historicalDecisions]) {
    const srcId = `DEC-${d.id}`;
    sourceMap.set(srcId, {
      sourceType: `Decision (${d.status})`,
      meetingId: d.meeting_id,
      meetingTitle: d.meeting_title ?? "Meeting",
      meetingDate: d.meeting_date ?? "",
      speaker: d.source_speaker ?? d.owner_name ?? void 0,
      excerpt: d.source_quote || d.decision_text,
      referenceId: d.id
    });
    evidenceLines.push(
      `[${srcId}] Status=${d.status} | Topic="${d.topic}" | Decision="${d.decision_text}" | EffectiveDate=${d.effective_date ?? "N/A"} | Owner=${d.owner_name ?? "Unassigned"} | Meeting="${d.meeting_title ?? ""}" (${d.meeting_date ?? ""}) | Quote (${d.source_speaker ?? "Speaker"}): "${d.source_quote ?? ""}"`
    );
  }
  for (const a of memory.actionItems) {
    const srcId = `ACT-${a.id}`;
    sourceMap.set(srcId, {
      sourceType: `Action (${a.status})`,
      meetingId: a.meeting_id,
      meetingTitle: a.meeting_title ?? "Meeting",
      meetingDate: a.meeting_date ?? "",
      speaker: a.source_speaker ?? a.owner_name ?? void 0,
      excerpt: a.source_quote || a.title,
      referenceId: a.id
    });
    evidenceLines.push(
      `[${srcId}] Action="${a.title}" | Owner=${a.owner_name ?? "Owner not confirmed"} | Due=${a.due_date ?? "None"} | Status=${a.status} | Meeting="${a.meeting_title ?? ""}" (${a.meeting_date ?? ""})`
    );
  }
  for (const dep of memory.dependencies) {
    const srcId = `DEP-${dep.id}`;
    sourceMap.set(srcId, {
      sourceType: "Dependency",
      meetingTitle: "Cross-Meeting Dependency",
      meetingDate: dep.created_at.slice(0, 10),
      excerpt: `${dep.source_title} (${dep.source_date ?? "no date"}) ${dep.relationship} ${dep.target_title} (${dep.target_date ?? "no date"})`,
      referenceId: dep.id
    });
    evidenceLines.push(
      `[${srcId}] Dependency: "${dep.source_title}" (date: ${dep.source_date ?? "N/A"}) ${dep.relationship} "${dep.target_title}" (date: ${dep.target_date ?? "N/A"}). ${dep.description ?? ""}`
    );
  }
  for (const c of memory.openConflicts) {
    const srcId = `CONF-${c.id}`;
    evidenceLines.push(
      `[${srcId}] Open Conflict (${c.conflict_type}, ${c.severity}): ${c.explanation}`
    );
  }
  for (const m of memory.semanticMatches.slice(0, 6)) {
    const meta = m.metadata;
    const srcId = `MEM-${m.id}`;
    if (!sourceMap.has(srcId)) {
      sourceMap.set(srcId, {
        sourceType: m.sourceType,
        meetingId: typeof meta.meetingId === "string" ? meta.meetingId : void 0,
        meetingTitle: typeof meta.meetingTitle === "string" ? meta.meetingTitle : "Team Memory",
        meetingDate: typeof meta.meetingDate === "string" ? meta.meetingDate : "",
        speaker: typeof meta.speaker === "string" ? meta.speaker : void 0,
        excerpt: m.content,
        referenceId: m.sourceId
      });
    }
    evidenceLines.push(`[${srcId}] (similarity=${m.similarityScore}): ${m.content}`);
  }
  if (evidenceLines.length === 0) {
    return {
      question: params.question,
      answer: "I don't have enough evidence in team memory to answer that confidently.",
      hasSufficientEvidence: false,
      sources: [],
      relatedDecisions: [],
      relatedDependencies: []
    };
  }
  const systemInstruction = `You are DecisionFlow's Organizational Memory Q&A Agent.
Answer the user's question using ONLY the verified database evidence provided below.

Rules:
1. Never hallucinate or extrapolate beyond the provided evidence.
2. Distinguish clearly between ACTIVE decisions, SUPERSEDED historical decisions, PROPOSED items awaiting approval, and unresolved DEPENDENCY risks or CONFLICTS.
3. If the provided evidence does NOT contain enough information to answer the question reliably, set has_sufficient_evidence to false and set answer to: "I don't have enough evidence in team memory to answer that confidently."
4. Cite the exact bracketed source IDs (e.g. DEC-..., ACT-..., DEP-...) that support your answer in cited_source_ids.`;
  const prompt = `Question: ${params.question}

Verified Team Memory Evidence:
${evidenceLines.join("\n")}`;
  const response = await generateContentResilient({
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel3.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type3.OBJECT,
        properties: {
          answer: { type: Type3.STRING },
          has_sufficient_evidence: { type: Type3.BOOLEAN },
          cited_source_ids: {
            type: Type3.ARRAY,
            items: { type: Type3.STRING }
          }
        },
        required: ["answer", "has_sufficient_evidence", "cited_source_ids"]
      }
    }
  });
  const rawText = response.text;
  if (!rawText) {
    throw new Error("Ask Memory Agent received an empty response from Gemini.");
  }
  const parsed = MemoryAnswerSchema.parse(JSON.parse(rawText));
  const citedSources = [];
  const seenMeetings = /* @__PURE__ */ new Set();
  for (const id of parsed.cited_source_ids) {
    const src = sourceMap.get(id);
    if (src) {
      const dedupKey = `${src.meetingTitle}|${src.meetingDate}|${src.excerpt.slice(0, 60)}`;
      if (!seenMeetings.has(dedupKey)) {
        seenMeetings.add(dedupKey);
        citedSources.push(src);
      }
    }
  }
  return {
    question: params.question,
    answer: parsed.has_sufficient_evidence ? parsed.answer : "I don't have enough evidence in team memory to answer that confidently.",
    hasSufficientEvidence: parsed.has_sufficient_evidence,
    sources: citedSources,
    relatedDecisions: [...memory.activeDecisions, ...memory.historicalDecisions].slice(0, 5),
    relatedDependencies: memory.dependencies.slice(0, 5)
  };
}

// server/routes/api.ts
function enrichConflicts(db, teamId, rows) {
  const deps = getStructuredDependencies(db, teamId);
  return rows.map((c) => {
    let existingSummary = "";
    let existingDate = null;
    let existingQuote = null;
    let existingSpeaker = null;
    let existingMeetingTitle = null;
    let existingMeetingDate = null;
    if (c.existing_item_type === "DECISION") {
      const d = db.prepare(
        `SELECT d.topic, d.decision_text, d.effective_date, ts.text AS quote, ts.speaker_name AS speaker, m.title AS meeting_title, m.meeting_date
           FROM decisions d
           LEFT JOIN transcript_segments ts ON ts.id = d.source_segment_id
           LEFT JOIN meetings m ON m.id = d.meeting_id
           WHERE d.id = ?`
      ).get(c.existing_item_id);
      if (d) {
        existingSummary = `${d.topic}: ${d.decision_text}`;
        existingDate = d.effective_date;
        existingQuote = d.quote;
        existingSpeaker = d.speaker;
        existingMeetingTitle = d.meeting_title;
        existingMeetingDate = d.meeting_date;
      }
    } else if (c.existing_item_type === "ACTION_ITEM") {
      const a = db.prepare(
        `SELECT a.title, a.due_date, ts.text AS quote, ts.speaker_name AS speaker, m.title AS meeting_title, m.meeting_date
           FROM action_items a
           LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
           LEFT JOIN meetings m ON m.id = a.meeting_id
           WHERE a.id = ?`
      ).get(c.existing_item_id);
      if (a) {
        existingSummary = a.title;
        existingDate = a.due_date;
        existingQuote = a.quote;
        existingSpeaker = a.speaker;
        existingMeetingTitle = a.meeting_title;
        existingMeetingDate = a.meeting_date;
      }
    }
    let newSummary = "";
    let newDate = null;
    let newQuote = null;
    let newSpeaker = null;
    if (c.new_item_type === "DECISION") {
      const d = db.prepare(
        `SELECT d.topic, d.decision_text, d.effective_date, ts.text AS quote, ts.speaker_name AS speaker
           FROM decisions d
           LEFT JOIN transcript_segments ts ON ts.id = d.source_segment_id
           WHERE d.id = ?`
      ).get(c.new_item_id);
      if (d) {
        newSummary = `${d.topic}: ${d.decision_text}`;
        newDate = d.effective_date;
        newQuote = d.quote;
        newSpeaker = d.speaker;
      }
    } else {
      const a = db.prepare(
        `SELECT a.title, a.due_date, ts.text AS quote, ts.speaker_name AS speaker
           FROM action_items a
           LEFT JOIN transcript_segments ts ON ts.id = a.source_segment_id
           WHERE a.id = ?`
      ).get(c.new_item_id);
      if (a) {
        newSummary = a.title;
        newDate = a.due_date;
        newQuote = a.quote;
        newSpeaker = a.speaker;
      }
    }
    const relatedDeps = deps.filter(
      (dep) => dep.target_id === c.existing_item_id || dep.target_id === c.new_item_id || dep.source_id === c.existing_item_id || dep.source_id === c.new_item_id
    );
    return {
      ...c,
      existing_summary: existingSummary,
      existing_date: existingDate,
      existing_quote: existingQuote,
      existing_speaker: existingSpeaker,
      existing_meeting_title: existingMeetingTitle,
      existing_meeting_date: existingMeetingDate,
      new_summary: newSummary,
      new_date: newDate,
      new_quote: newQuote,
      new_speaker: newSpeaker,
      related_dependencies: relatedDeps
    };
  });
}
function enrichActions(db, actions) {
  return actions.map((a) => {
    const approval = db.prepare(`SELECT id, status FROM approval_items WHERE item_type = 'ACTION_ITEM' AND reference_id = ?`).get(a.id);
    const ext = db.prepare(`SELECT * FROM external_tasks WHERE action_item_id = ?`).get(a.id);
    return {
      ...a,
      approval_id: approval?.id ?? null,
      approval_status: approval?.status ?? null,
      external_task: ext ?? null
    };
  });
}
function createApiRouter(db) {
  const router = express.Router();
  router.get("/health", async (req, res) => {
    const gh = getGitHubConfigStatus();
    if (req.query.probe === "1" && isGeminiConfigured()) {
      const t0 = Date.now();
      try {
        const { getGeminiClient: getGeminiClient2, generateContentResilient: generateContentResilient2, getEmbeddingModel: getEmbeddingModel2 } = await Promise.resolve().then(() => (init_client(), client_exports));
        const ai = getGeminiClient2();
        const modelOverride = typeof req.query.model === "string" ? req.query.model : void 0;
        const r = await generateContentResilient2({
          model: modelOverride,
          contents: "Reply with OK"
        });
        const t1 = Date.now();
        let embedDims = 0;
        let embedError = null;
        try {
          const emb = await ai.models.embedContent({
            model: getEmbeddingModel2(),
            contents: "Payment launch"
          });
          embedDims = emb.embeddings?.[0]?.values?.length ?? 0;
        } catch (embErr) {
          embedError = embErr.message;
        }
        const t2 = Date.now();
        res.json({
          ok: true,
          geminiConfigured: true,
          probe: {
            textMs: t1 - t0,
            embedMs: t2 - t1,
            textSample: r.text?.trim(),
            embedDims,
            embedError
          }
        });
        return;
      } catch (err) {
        res.status(500).json({
          ok: false,
          geminiConfigured: true,
          probeError: err.message,
          elapsedMs: Date.now() - t0
        });
        return;
      }
    }
    res.json({
      ok: true,
      geminiConfigured: isGeminiConfigured(),
      githubConfigured: gh.configured,
      githubRepo: gh.configured ? `${gh.owner}/${gh.repo}` : null,
      githubMissingVars: gh.missingVars
    });
  });
  router.get("/demo/sample-meeting-3", (_req, res) => {
    res.json(MEETING_3_SAMPLE);
  });
  router.post("/demo/reset", (_req, res) => {
    resetAndSeedDemoWorkspace(db);
    evaluateReminders(db, ACME_TEAM_ID);
    res.json({ ok: true, message: "Acme Product Team demo workspace reset to initial state." });
  });
  router.get("/dashboard", (req, res) => {
    const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(ACME_TEAM_ID);
    const users = db.prepare(
      `SELECT u.* FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? ORDER BY u.name ASC`
    ).all(ACME_TEAM_ID);
    const requestedUserId = typeof req.query.userId === "string" ? req.query.userId : void 0;
    const currentUser = users.find((u) => u.id === requestedUserId) ?? users.find((u) => u.email === "priya@acme.dev") ?? users[0];
    const reminders = evaluateReminders(db, ACME_TEAM_ID);
    const allDecisions = getStructuredDecisions(db, ACME_TEAM_ID);
    const activeDecisions = allDecisions.filter((d) => d.status === "ACTIVE");
    const allActions = enrichActions(db, getStructuredActions(db, ACME_TEAM_ID));
    const openConflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db.prepare(
        `SELECT c.*, m.title AS meeting_title
           FROM conflicts c
           JOIN meetings m ON m.id = c.meeting_id
           WHERE c.team_id = ? AND c.status = 'OPEN'
           ORDER BY c.created_at DESC`
      ).all(ACME_TEAM_ID)
    );
    const pendingApprovalsCount = db.prepare(`SELECT COUNT(*) AS cnt FROM approval_items WHERE team_id = ? AND status = 'PENDING'`).get(ACME_TEAM_ID).cnt;
    const myTasks = allActions.filter(
      (a) => a.owner_id === currentUser.id && !["COMPLETED", "CANCELLED"].includes(a.status)
    );
    const needsAttention = [];
    for (const c of openConflicts) {
      needsAttention.push({
        id: `conflict-${c.id}`,
        kind: "CONFLICT",
        title: c.new_summary || c.conflict_type.replace("_", " "),
        subtitle: c.explanation,
        severity: c.severity,
        href: "/conflicts"
      });
    }
    for (const r of reminders) {
      needsAttention.push({
        id: `rem-${r.id}`,
        kind: "REMINDER",
        title: r.action_title ?? "Upcoming deadline",
        subtitle: r.message,
        severity: r.reminder_type === "OVERDUE" || r.reminder_type === "AT_RISK" ? "HIGH" : "MEDIUM",
        href: "/tasks"
      });
    }
    const recentMeetings = db.prepare(
      `SELECT m.*,
                (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id) AS decision_count,
                (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id) AS action_count,
                (SELECT COUNT(*) FROM conflicts c WHERE c.meeting_id = m.id AND c.status = 'OPEN') AS conflict_count
         FROM meetings m
         WHERE m.team_id = ?
         ORDER BY m.meeting_date DESC, m.created_at DESC
         LIMIT 6`
    ).all(ACME_TEAM_ID);
    const recentAudit = db.prepare(
      `SELECT ae.*, u.name AS user_name
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.user_id
         WHERE ae.team_id = ?
         ORDER BY ae.created_at DESC
         LIMIT 10`
    ).all(ACME_TEAM_ID).map((row) => {
      const r = row;
      return {
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null
      };
    });
    const payload = {
      team,
      currentUser,
      users,
      metrics: {
        activeDecisions: activeDecisions.length,
        openConflicts: openConflicts.length,
        pendingApprovals: pendingApprovalsCount,
        myTasks: myTasks.length,
        atRiskCount: reminders.filter((r) => r.reminder_type === "AT_RISK" || r.reminder_type === "OVERDUE").length
      },
      needsAttention: needsAttention.slice(0, 8),
      upcomingDeadlines: allActions.filter((a) => !["COMPLETED", "CANCELLED"].includes(a.status) && a.due_date).slice(0, 6),
      recentMeetings,
      recentDecisions: allDecisions.slice(0, 6),
      reminders,
      recentAudit,
      githubConfigured: getGitHubConfigStatus().configured
    };
    res.json(payload);
  });
  router.get("/meetings", (_req, res) => {
    const meetings = db.prepare(
      `SELECT m.*,
                (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id) AS decision_count,
                (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id) AS action_count,
                (SELECT COUNT(*) FROM conflicts c WHERE c.meeting_id = m.id AND c.status = 'OPEN') AS conflict_count
         FROM meetings m
         WHERE m.team_id = ?
         ORDER BY m.meeting_date DESC, m.created_at DESC`
    ).all(ACME_TEAM_ID);
    res.json({ meetings });
  });
  router.post("/meetings", (req, res) => {
    const parsed = CreateMeetingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    const { title, meetingDate, sourceType, sourceFileName, transcript } = parsed.data;
    const teamId = parsed.data.teamId ?? ACME_TEAM_ID;
    const meetingId = randomUUID7();
    db.prepare(
      `INSERT INTO meetings (id, team_id, title, meeting_date, source_type, source_file_name, raw_transcript, processing_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOADED', datetime('now'), datetime('now'))`
    ).run(meetingId, teamId, title, meetingDate, sourceType, sourceFileName ?? null, transcript);
    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, NULL, 'MEETING_UPLOADED', 'MEETING', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID7(),
      teamId,
      meetingId,
      `Uploaded transcript "${title}" (${meetingDate}).`,
      JSON.stringify({ sourceType, sourceFileName: sourceFileName ?? null })
    );
    const created = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId);
    res.status(201).json({ meeting: created });
  });
  router.get("/meetings/:meetingId", (req, res) => {
    const { meetingId } = req.params;
    const meeting = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId);
    if (!meeting) {
      res.status(404).json({ error: "NOT_FOUND", message: "Meeting not found." });
      return;
    }
    const segments = db.prepare(`SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_number ASC`).all(meetingId);
    const decisions = getStructuredDecisions(db, meeting.team_id).filter((d) => d.meeting_id === meetingId);
    const actions = enrichActions(
      db,
      getStructuredActions(db, meeting.team_id).filter((a) => a.meeting_id === meetingId)
    );
    const itemIds = /* @__PURE__ */ new Set([...decisions.map((d) => d.id), ...actions.map((a) => a.id)]);
    const dependencies = getStructuredDependencies(db, meeting.team_id).filter(
      (dep) => itemIds.has(dep.source_id) || itemIds.has(dep.target_id)
    );
    const conflicts = enrichConflicts(
      db,
      meeting.team_id,
      db.prepare(`SELECT * FROM conflicts WHERE meeting_id = ? ORDER BY created_at DESC`).all(meetingId)
    );
    const audit = db.prepare(`SELECT * FROM audit_events WHERE team_id = ? AND entity_id = ? ORDER BY created_at ASC`).all(meeting.team_id, meetingId);
    const participants = extractParticipantsFromSegments(segments);
    res.json({
      meeting,
      participants,
      segments,
      decisions,
      actions,
      dependencies,
      conflicts,
      audit
    });
  });
  router.post("/meetings/:meetingId/process", async (req, res) => {
    const meetingId = String(req.params.meetingId);
    try {
      const result = await processMeetingPipeline(db, meetingId);
      res.json(result);
    } catch (err) {
      const message = sanitizeGeminiErrorMessage(err) || "Failed to process meeting transcript.";
      const status = err instanceof GeminiUnavailableError ? 503 : message.includes("not found") ? 404 : message.includes("GEMINI_API_KEY") || message.includes("temporarily unavailable") ? 503 : 500;
      res.status(status).json({ error: "PROCESSING_FAILED", message });
    }
  });
  router.get("/decisions", (_req, res) => {
    const decisions = getStructuredDecisions(db, ACME_TEAM_ID);
    const dependencies = getStructuredDependencies(db, ACME_TEAM_ID);
    const conflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db.prepare(`SELECT * FROM conflicts WHERE team_id = ? ORDER BY created_at DESC`).all(ACME_TEAM_ID)
    );
    res.json({ decisions, dependencies, conflicts });
  });
  router.get("/decisions/:decisionId", (req, res) => {
    const { decisionId } = req.params;
    const all = getStructuredDecisions(db, ACME_TEAM_ID);
    const decision = all.find((d) => d.id === decisionId);
    if (!decision) {
      res.status(404).json({ error: "NOT_FOUND", message: "Decision not found." });
      return;
    }
    const lineage = [];
    const visited = /* @__PURE__ */ new Set();
    let cursor = decision;
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      lineage.unshift(cursor);
      cursor = cursor.supersedes_decision_id ? all.find((d) => d.id === cursor.supersedes_decision_id) : void 0;
    }
    let forward = all.find((d) => d.supersedes_decision_id === decision.id);
    while (forward && !visited.has(forward.id)) {
      visited.add(forward.id);
      lineage.push(forward);
      forward = all.find((d) => d.supersedes_decision_id === forward.id);
    }
    const versions = db.prepare(
      `SELECT dv.*, m.title AS source_meeting_title, m.meeting_date AS source_meeting_date,
                ts.text AS source_quote, ts.speaker_name AS source_speaker
         FROM decision_versions dv
         JOIN meetings m ON m.id = dv.source_meeting_id
         LEFT JOIN transcript_segments ts ON ts.id = dv.source_segment_id
         WHERE dv.decision_id IN (${lineage.map(() => "?").join(",")})
         ORDER BY dv.created_at ASC, dv.version_number ASC`
    ).all(...lineage.map((d) => d.id));
    const dependencies = getStructuredDependencies(db, ACME_TEAM_ID).filter(
      (dep) => lineage.some((d) => d.id === dep.target_id || d.id === dep.source_id)
    );
    const conflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db.prepare(
        `SELECT * FROM conflicts WHERE team_id = ? AND (existing_item_id = ? OR new_item_id = ?) ORDER BY created_at DESC`
      ).all(ACME_TEAM_ID, decisionId, decisionId)
    );
    res.json({ decision, lineage, versions, dependencies, conflicts });
  });
  router.get("/conflicts", (_req, res) => {
    const raw = db.prepare(
      `SELECT c.*, m.title AS meeting_title
         FROM conflicts c
         JOIN meetings m ON m.id = c.meeting_id
         WHERE c.team_id = ?
         ORDER BY CASE c.status WHEN 'OPEN' THEN 1 ELSE 2 END, c.created_at DESC`
    ).all(ACME_TEAM_ID);
    res.json({ conflicts: enrichConflicts(db, ACME_TEAM_ID, raw) });
  });
  router.patch("/conflicts/:conflictId", (req, res) => {
    const parsed = ResolveConflictSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    const { conflictId } = req.params;
    const existing = db.prepare(`SELECT * FROM conflicts WHERE id = ?`).get(conflictId);
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Conflict not found." });
      return;
    }
    const resolvedAt = parsed.data.status === "OPEN" ? null : (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`UPDATE conflicts SET status = ?, resolved_at = ? WHERE id = ?`).run(
      parsed.data.status,
      resolvedAt,
      conflictId
    );
    const updated = db.prepare(`SELECT * FROM conflicts WHERE id = ?`).get(conflictId);
    res.json({ conflict: updated });
  });
  router.get("/approvals", (_req, res) => {
    const rows = db.prepare(
      `SELECT ai.*, u.name AS reviewer_name
         FROM approval_items ai
         LEFT JOIN users u ON u.id = ai.reviewed_by
         WHERE ai.team_id = ?
         ORDER BY CASE ai.status WHEN 'PENDING' THEN 1 ELSE 2 END, ai.created_at DESC`
    ).all(ACME_TEAM_ID);
    const allDecisions = getStructuredDecisions(db, ACME_TEAM_ID);
    const allActions = enrichActions(db, getStructuredActions(db, ACME_TEAM_ID));
    const allConflicts = enrichConflicts(
      db,
      ACME_TEAM_ID,
      db.prepare(
        `SELECT c.*, m.title AS meeting_title
           FROM conflicts c
           JOIN meetings m ON m.id = c.meeting_id
           WHERE c.team_id = ?`
      ).all(ACME_TEAM_ID)
    );
    const enriched = rows.map((item) => {
      const decision = item.item_type === "DECISION" ? allDecisions.find((d) => d.id === item.reference_id) ?? null : null;
      const actionItem = item.item_type === "ACTION_ITEM" ? allActions.find((a) => a.id === item.reference_id) ?? null : null;
      const conflict = allConflicts.find((c) => c.new_item_id === item.reference_id) ?? null;
      return {
        ...item,
        decision,
        action_item: actionItem,
        conflict
      };
    });
    res.json({
      approvals: enriched,
      conflicts: allConflicts,
      users: db.prepare(`SELECT u.* FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? ORDER BY u.name ASC`).all(ACME_TEAM_ID),
      githubConfigured: getGitHubConfigStatus().configured
    });
  });
  router.post("/approvals", async (req, res) => {
    const parsed = ApprovalDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      const outcome = await handleHumanApproval(db, parsed.data);
      res.json(outcome);
    } catch (err) {
      const message = err.message || "Approval update failed.";
      const status = message.includes("not found") ? 404 : message.includes("already been reviewed") ? 409 : 400;
      res.status(status).json({ error: "APPROVAL_ERROR", message });
    }
  });
  router.get("/tasks", (_req, res) => {
    evaluateReminders(db, ACME_TEAM_ID);
    const actions = enrichActions(db, getStructuredActions(db, ACME_TEAM_ID));
    const reminders = db.prepare(`SELECT * FROM reminders WHERE team_id = ?`).all(ACME_TEAM_ID);
    const dependencies = getStructuredDependencies(db, ACME_TEAM_ID);
    const gh = getGitHubConfigStatus();
    res.json({
      tasks: actions,
      reminders,
      dependencies,
      github: gh
    });
  });
  router.patch("/tasks/:taskId", (req, res) => {
    const parsed = UpdateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    const { taskId } = req.params;
    const existing = db.prepare(`SELECT * FROM action_items WHERE id = ?`).get(taskId);
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Task not found." });
      return;
    }
    if (existing.status === "PROPOSED" && parsed.data.status !== "CANCELLED") {
      const approval = db.prepare(`SELECT status FROM approval_items WHERE item_type = 'ACTION_ITEM' AND reference_id = ?`).get(taskId);
      if (approval && approval.status !== "APPROVED" && approval.status !== "EDITED") {
        res.status(403).json({
          error: "APPROVAL_REQUIRED",
          message: "Approve this proposed action in Conflicts & Approvals before moving it into active execution."
        });
        return;
      }
    }
    db.prepare(`UPDATE action_items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      parsed.data.status,
      taskId
    );
    db.prepare(
      `INSERT INTO audit_events (id, team_id, user_id, event_type, entity_type, entity_id, description, metadata, created_at)
       VALUES (?, ?, ?, 'TASK_STATUS_UPDATED', 'ACTION_ITEM', ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID7(),
      existing.team_id,
      parsed.data.userId ?? existing.owner_id,
      existing.id,
      `Updated "${existing.title}" status from ${existing.status} to ${parsed.data.status}.`,
      JSON.stringify({ previousStatus: existing.status, newStatus: parsed.data.status })
    );
    evaluateReminders(db, existing.team_id);
    const updated = enrichActions(
      db,
      [
        db.prepare(
          `SELECT a.*, COALESCE(u.name, a.owner_name) AS owner_name, m.title AS meeting_title, m.meeting_date AS meeting_date
             FROM action_items a
             LEFT JOIN users u ON u.id = a.owner_id
             LEFT JOIN meetings m ON m.id = a.meeting_id
             WHERE a.id = ?`
        ).get(taskId)
      ]
    )[0];
    res.json({ task: updated });
  });
  router.post("/github/create-issue", async (req, res) => {
    const parsed = CreateGitHubIssueRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await executeApprovedActionToGitHub(db, {
        actionItemId: parsed.data.actionItemId,
        approvalId: parsed.data.approvalId,
        actorUserId: parsed.data.userId
      });
      res.status(result.alreadyExisted ? 200 : 201).json(result);
    } catch (err) {
      if (err instanceof GovernanceError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      const message = err.message || "GitHub issue creation failed.";
      const isNotConfigured = message.includes("not configured");
      res.status(isNotConfigured ? 400 : 502).json({
        error: isNotConfigured ? "GITHUB_NOT_CONFIGURED" : "GITHUB_API_ERROR",
        message
      });
    }
  });
  router.post("/tasks/:taskId/sync-github", async (req, res) => {
    try {
      const updated = await syncExternalTaskWithGitHub(db, String(req.params.taskId));
      res.json({ externalTask: updated });
    } catch (err) {
      if (err instanceof GovernanceError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      res.status(502).json({ error: "GITHUB_SYNC_ERROR", message: err.message });
    }
  });
  router.get("/reminders", (_req, res) => {
    const reminders = evaluateReminders(db, ACME_TEAM_ID);
    res.json({ reminders });
  });
  router.post("/reminders/evaluate", (req, res) => {
    const referenceDate = typeof req.body?.referenceDate === "string" ? req.body.referenceDate : void 0;
    const reminders = evaluateReminders(db, ACME_TEAM_ID, referenceDate);
    res.json({ reminders });
  });
  router.get("/digest/:userId", async (req, res) => {
    const userId = String(req.params.userId);
    const refresh = req.query.refresh === "true";
    if (!refresh) {
      const existing = db.prepare(
        `SELECT wd.*, u.name AS user_name
           FROM weekly_digests wd
           JOIN users u ON u.id = wd.user_id
           WHERE wd.team_id = ? AND wd.user_id = ?
           ORDER BY wd.generated_at DESC
           LIMIT 1`
      ).get(ACME_TEAM_ID, userId);
      if (existing) {
        res.json({
          digest: {
            ...existing,
            content: JSON.parse(existing.content)
          }
        });
        return;
      }
    }
    try {
      evaluateReminders(db, ACME_TEAM_ID);
      const digest = await generateWeeklyDigestForUser(db, { teamId: ACME_TEAM_ID, userId });
      res.json({ digest });
    } catch (err) {
      res.status(400).json({ error: "DIGEST_ERROR", message: err.message });
    }
  });
  router.post("/digest", async (req, res) => {
    const parsed = GenerateDigestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      evaluateReminders(db, parsed.data.teamId ?? ACME_TEAM_ID);
      const digest = await generateWeeklyDigestForUser(db, {
        teamId: parsed.data.teamId ?? ACME_TEAM_ID,
        userId: parsed.data.userId
      });
      res.json({ digest });
    } catch (err) {
      res.status(400).json({ error: "DIGEST_ERROR", message: err.message });
    }
  });
  router.post("/memory", async (req, res) => {
    const parsed = MemoryQueryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      const answer = await runAskMemoryAgent({
        db,
        teamId: parsed.data.teamId ?? ACME_TEAM_ID,
        question: parsed.data.question
      });
      res.json(answer);
    } catch (err) {
      const message = sanitizeGeminiErrorMessage(err) || "Memory query failed.";
      const status = err instanceof GeminiUnavailableError || message.includes("GEMINI_API_KEY") || message.includes("temporarily unavailable") ? 503 : 500;
      res.status(status).json({ error: "MEMORY_QUERY_ERROR", message });
    }
  });
  router.get("/audit", (_req, res) => {
    const rows = db.prepare(
      `SELECT ae.*, u.name AS user_name
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.user_id
         WHERE ae.team_id = ?
         ORDER BY ae.created_at DESC
         LIMIT 50`
    ).all(ACME_TEAM_ID).map((row) => {
      const r = row;
      return {
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null
      };
    });
    res.json({ events: rows });
  });
  return router;
}

// server.ts
async function startServer() {
  const app = express2();
  const PORT = 3e3;
  app.use(express2.json({ limit: "2mb" }));
  const db = getDb();
  seedDemoWorkspace(db);
  evaluateReminders(db, ACME_TEAM_ID);
  app.use("/api", createApiRouter(db));
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path2.resolve(process.cwd(), "dist");
    app.use(express2.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distDir, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DecisionFlow server running at http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start DecisionFlow server:", err);
  process.exit(1);
});
