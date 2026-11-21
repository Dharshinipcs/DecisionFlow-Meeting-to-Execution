import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getEmbeddingModel, getGeminiClient, isGeminiConfigured } from '../ai/client.ts';

export async function generateTextEmbedding(text: string): Promise<number[] | null> {
  if (!isGeminiConfigured() || !text.trim()) {
    return null;
  }

  try {
    const ai = getGeminiClient();
    const result = await ai.models.embedContent({
      model: getEmbeddingModel(),
      contents: text,
    });
    const values = result.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
    return null;
  } catch (err) {
    console.error('Embedding generation failed:', err);
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
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

export async function upsertMemoryRecord(
  db: Database.Database,
  params: {
    teamId: string;
    sourceType: 'TRANSCRIPT' | 'DECISION' | 'ACTION_ITEM' | 'DECISION_EXPLANATION' | 'MEETING_SUMMARY';
    sourceId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
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
    randomUUID(),
    params.teamId,
    params.sourceType,
    params.sourceId,
    params.content,
    embeddingJson,
    metadataJson
  );
}

/**
 * Ensures any seeded memory records that do not yet have vector embeddings
 * receive real embeddings when Gemini is configured.
 */
export async function backfillMissingEmbeddings(db: Database.Database, teamId: string): Promise<void> {
  if (!isGeminiConfigured()) {
    return;
  }

  const rows = db
    .prepare(`SELECT id, content FROM memory_embeddings WHERE team_id = ? AND (embedding = '[]' OR embedding IS NULL) LIMIT 12`)
    .all(teamId) as Array<{ id: string; content: string }>;

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
