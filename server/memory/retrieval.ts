import type Database from 'better-sqlite3';
import type { ActionItem, Conflict, Decision, Dependency } from '../../src/types/decisionflow.ts';
import { backfillMissingEmbeddings, cosineSimilarity, generateTextEmbedding } from './embeddings.ts';

export interface RetrievedMemoryRecord {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  similarityScore: number;
  metadata: Record<string, unknown>;
}

export interface HybridMemoryContext {
  semanticMatches: RetrievedMemoryRecord[];
  activeDecisions: Decision[];
  historicalDecisions: Decision[];
  actionItems: ActionItem[];
  dependencies: Dependency[];
  openConflicts: Conflict[];
}

function lexicalOverlapScore(query: string, text: string): number {
  const stopWords = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'from', 'that', 'this', 'have', 'will', 'does', 'were', 'been', 'the', 'and', 'for', 'are']);
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopWords.has(t));

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

export function getStructuredDecisions(db: Database.Database, teamId: string): Decision[] {
  return db
    .prepare(
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
    )
    .all(teamId) as Decision[];
}

export function getStructuredActions(db: Database.Database, teamId: string): ActionItem[] {
  return db
    .prepare(
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
    )
    .all(teamId) as ActionItem[];
}

export function getStructuredDependencies(db: Database.Database, teamId: string): Dependency[] {
  const rows = db
    .prepare(`SELECT * FROM dependencies WHERE team_id = ? ORDER BY created_at DESC`)
    .all(teamId) as Dependency[];

  return rows.map((dep) => {
    let sourceTitle = '';
    let sourceDate: string | null = null;
    let targetTitle = '';
    let targetDate: string | null = null;

    if (dep.source_type === 'ACTION_ITEM') {
      const a = db.prepare(`SELECT title, due_date FROM action_items WHERE id = ?`).get(dep.source_id) as
        | { title: string; due_date: string | null }
        | undefined;
      if (a) {
        sourceTitle = a.title;
        sourceDate = a.due_date;
      }
    } else {
      const d = db.prepare(`SELECT topic, decision_text, effective_date FROM decisions WHERE id = ?`).get(dep.source_id) as
        | { topic: string; decision_text: string; effective_date: string | null }
        | undefined;
      if (d) {
        sourceTitle = `${d.topic}: ${d.decision_text}`;
        sourceDate = d.effective_date;
      }
    }

    if (dep.target_type === 'ACTION_ITEM') {
      const a = db.prepare(`SELECT title, due_date FROM action_items WHERE id = ?`).get(dep.target_id) as
        | { title: string; due_date: string | null }
        | undefined;
      if (a) {
        targetTitle = a.title;
        targetDate = a.due_date;
      }
    } else {
      const d = db.prepare(`SELECT topic, decision_text, effective_date FROM decisions WHERE id = ?`).get(dep.target_id) as
        | { topic: string; decision_text: string; effective_date: string | null }
        | undefined;
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
      target_date: targetDate,
    };
  });
}

export async function retrieveHybridMemory(
  db: Database.Database,
  teamId: string,
  queryText: string,
  limit = 10
): Promise<HybridMemoryContext> {
  // Backfill any un-embedded seeded records when possible
  await backfillMissingEmbeddings(db, teamId);

  const queryVector = await generateTextEmbedding(queryText);

  const memoryRows = db
    .prepare(`SELECT id, source_type, source_id, content, embedding, metadata FROM memory_embeddings WHERE team_id = ?`)
    .all(teamId) as Array<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    embedding: string;
    metadata: string | null;
  }>;

  const scored: RetrievedMemoryRecord[] = memoryRows.map((row) => {
    let vecScore = 0;
    if (queryVector && row.embedding && row.embedding !== '[]') {
      try {
        const parsed = JSON.parse(row.embedding) as number[];
        vecScore = cosineSimilarity(queryVector, parsed);
      } catch {
        vecScore = 0;
      }
    }

    const lexScore = lexicalOverlapScore(queryText, row.content);
    const combined = queryVector ? vecScore * 0.65 + lexScore * 0.35 : lexScore;

    let meta: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        meta = JSON.parse(row.metadata) as Record<string, unknown>;
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
      metadata: meta,
    };
  });

  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  const allDecisions = getStructuredDecisions(db, teamId);
  const activeDecisions = allDecisions.filter((d) => d.status === 'ACTIVE');
  const historicalDecisions = allDecisions.filter((d) => d.status === 'SUPERSEDED');
  const actionItems = getStructuredActions(db, teamId);
  const dependencies = getStructuredDependencies(db, teamId);
  const openConflicts = db
    .prepare(`SELECT * FROM conflicts WHERE team_id = ? AND status = 'OPEN' ORDER BY created_at DESC`)
    .all(teamId) as Conflict[];

  return {
    semanticMatches: scored.slice(0, limit),
    activeDecisions,
    historicalDecisions,
    actionItems,
    dependencies,
    openConflicts,
  };
}
