import { ThinkingLevel, Type } from '@google/genai';
import type Database from 'better-sqlite3';
import { generateContentResilient } from '../ai/client.ts';
import { retrieveHybridMemory } from '../memory/retrieval.ts';
import { MemoryAnswerSchema } from '../validation/schemas.ts';
import type { MemoryAnswer, MemoryAnswerSource } from '../../src/types/decisionflow.ts';

export async function runAskMemoryAgent(params: {
  db: Database.Database;
  teamId: string;
  question: string;
}): Promise<MemoryAnswer> {
  const memory = await retrieveHybridMemory(params.db, params.teamId, params.question, 10);

  // Build indexed evidence records so every claim has an auditable source
  const sourceMap = new Map<string, MemoryAnswerSource>();
  const evidenceLines: string[] = [];

  for (const d of [...memory.activeDecisions, ...memory.historicalDecisions]) {
    const srcId = `DEC-${d.id}`;
    sourceMap.set(srcId, {
      sourceType: `Decision (${d.status})`,
      meetingId: d.meeting_id,
      meetingTitle: d.meeting_title ?? 'Meeting',
      meetingDate: d.meeting_date ?? '',
      speaker: d.source_speaker ?? d.owner_name ?? undefined,
      excerpt: d.source_quote || d.decision_text,
      referenceId: d.id,
    });
    evidenceLines.push(
      `[${srcId}] Status=${d.status} | Topic="${d.topic}" | Decision="${d.decision_text}" | EffectiveDate=${d.effective_date ?? 'N/A'} | Owner=${d.owner_name ?? 'Unassigned'} | Meeting="${d.meeting_title ?? ''}" (${d.meeting_date ?? ''}) | Quote (${d.source_speaker ?? 'Speaker'}): "${d.source_quote ?? ''}"`
    );
  }

  for (const a of memory.actionItems) {
    const srcId = `ACT-${a.id}`;
    sourceMap.set(srcId, {
      sourceType: `Action (${a.status})`,
      meetingId: a.meeting_id,
      meetingTitle: a.meeting_title ?? 'Meeting',
      meetingDate: a.meeting_date ?? '',
      speaker: a.source_speaker ?? a.owner_name ?? undefined,
      excerpt: a.source_quote || a.title,
      referenceId: a.id,
    });
    evidenceLines.push(
      `[${srcId}] Action="${a.title}" | Owner=${a.owner_name ?? 'Owner not confirmed'} | Due=${a.due_date ?? 'None'} | Status=${a.status} | Meeting="${a.meeting_title ?? ''}" (${a.meeting_date ?? ''})`
    );
  }

  for (const dep of memory.dependencies) {
    const srcId = `DEP-${dep.id}`;
    sourceMap.set(srcId, {
      sourceType: 'Dependency',
      meetingTitle: 'Cross-Meeting Dependency',
      meetingDate: dep.created_at.slice(0, 10),
      excerpt: `${dep.source_title} (${dep.source_date ?? 'no date'}) ${dep.relationship} ${dep.target_title} (${dep.target_date ?? 'no date'})`,
      referenceId: dep.id,
    });
    evidenceLines.push(
      `[${srcId}] Dependency: "${dep.source_title}" (date: ${dep.source_date ?? 'N/A'}) ${dep.relationship} "${dep.target_title}" (date: ${dep.target_date ?? 'N/A'}). ${dep.description ?? ''}`
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
        meetingId: typeof meta.meetingId === 'string' ? meta.meetingId : undefined,
        meetingTitle: typeof meta.meetingTitle === 'string' ? meta.meetingTitle : 'Team Memory',
        meetingDate: typeof meta.meetingDate === 'string' ? meta.meetingDate : '',
        speaker: typeof meta.speaker === 'string' ? meta.speaker : undefined,
        excerpt: m.content,
        referenceId: m.sourceId,
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
      relatedDependencies: [],
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
${evidenceLines.join('\n')}`;

  const response = await generateContentResilient({
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          has_sufficient_evidence: { type: Type.BOOLEAN },
          cited_source_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['answer', 'has_sufficient_evidence', 'cited_source_ids'],
      },
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error('Ask Memory Agent received an empty response from Gemini.');
  }

  const parsed = MemoryAnswerSchema.parse(JSON.parse(rawText));

  const citedSources: MemoryAnswerSource[] = [];
  const seenMeetings = new Set<string>();
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
    answer: parsed.has_sufficient_evidence
      ? parsed.answer
      : "I don't have enough evidence in team memory to answer that confidently.",
    hasSufficientEvidence: parsed.has_sufficient_evidence,
    sources: citedSources,
    relatedDecisions: [...memory.activeDecisions, ...memory.historicalDecisions].slice(0, 5),
    relatedDependencies: memory.dependencies.slice(0, 5),
  };
}
