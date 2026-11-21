import { ThinkingLevel, Type } from '@google/genai';
import type Database from 'better-sqlite3';
import { generateContentResilient } from '../ai/client.ts';
import { retrieveHybridMemory } from '../memory/retrieval.ts';
import { ConflictJudgmentSchema, type ConflictJudgmentResult } from '../validation/schemas.ts';
import type { ActionItem, Decision, Dependency } from '../../src/types/decisionflow.ts';

export interface DeterministicConflictFinding {
  conflictType: 'DEPENDENCY_CONFLICT' | 'DEADLINE_CONFLICT' | 'DECISION_CONFLICT';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  existingItemType: 'DECISION' | 'ACTION_ITEM' | 'DEPENDENCY';
  existingItemId: string;
  explanation: string;
  confidence: number;
}

/**
 * Runs deterministic checks before calling the LLM:
 * 1. Dependency date violations (e.g. prerequisite due_date > proposed effective_date).
 * 2. Direct topic date mismatch against active decisions.
 */
export function runDeterministicConflictChecks(params: {
  proposedDecision: Decision;
  activeDecisions: Decision[];
  actionItems: ActionItem[];
  dependencies: Dependency[];
}): DeterministicConflictFinding[] {
  const findings: DeterministicConflictFinding[] = [];
  const topicLower = params.proposedDecision.topic.toLowerCase();
  const proposedDate = params.proposedDecision.effective_date;

  // Check active decisions matching topic
  for (const active of params.activeDecisions) {
    if (active.id === params.proposedDecision.id) continue;
    const activeTopicLower = active.topic.toLowerCase();
    const topicMatch =
      activeTopicLower === topicLower ||
      activeTopicLower.includes(topicLower) ||
      topicLower.includes(activeTopicLower);

    if (topicMatch && proposedDate && active.effective_date && proposedDate !== active.effective_date) {
      // Check dependencies tied to this active decision
      for (const dep of params.dependencies) {
        if (dep.target_type === 'DECISION' && dep.target_id === active.id && dep.source_type === 'ACTION_ITEM') {
          const prereq = params.actionItems.find((a) => a.id === dep.source_id);
          if (prereq?.due_date && proposedDate < prereq.due_date) {
            findings.push({
              conflictType: 'DEPENDENCY_CONFLICT',
              severity: 'HIGH',
              existingItemType: 'ACTION_ITEM',
              existingItemId: prereq.id,
              explanation: `The proposed ${params.proposedDecision.topic} date (${proposedDate}) precedes the currently recorded prerequisite "${prereq.title}" scheduled for ${prereq.due_date}.`,
              confidence: 0.96,
            });
          }
        }
      }
    }
  }

  return findings;
}

export async function runConflictReasoningAgent(params: {
  db: Database.Database;
  teamId: string;
  proposedDecision: Decision;
  sourceQuote: string | null;
  sourceSpeaker: string | null;
}): Promise<{
  aiJudgment: ConflictJudgmentResult;
  deterministicFindings: DeterministicConflictFinding[];
  memoryHitsCount: number;
}> {
  const queryText = `${params.proposedDecision.topic} ${params.proposedDecision.decision_text} ${params.proposedDecision.effective_date ?? ''}`;
  const memory = await retrieveHybridMemory(params.db, params.teamId, queryText, 8);

  const candidateActiveDecisions = memory.activeDecisions.filter(
    (d) => d.id !== params.proposedDecision.id
  );

  const deterministicFindings = runDeterministicConflictChecks({
    proposedDecision: params.proposedDecision,
    activeDecisions: candidateActiveDecisions,
    actionItems: memory.actionItems,
    dependencies: memory.dependencies,
  });

  // If there is no prior organizational state at all, skip unnecessary LLM call
  if (candidateActiveDecisions.length === 0 && memory.dependencies.length === 0 && memory.actionItems.length === 0) {
    return {
      aiJudgment: {
        has_conflict: false,
        conflict_type: 'NONE',
        severity: 'LOW',
        existing_item_id: null,
        existing_item_type: null,
        explanation: 'No prior conflicting organizational decisions or dependencies found in memory.',
        confidence: 0.95,
        requires_approval: true,
      },
      deterministicFindings,
      memoryHitsCount: 0,
    };
  }

  const activeDecisionsContext = candidateActiveDecisions
    .map(
      (d) =>
        `- [DECISION id=${d.id}] Topic: "${d.topic}" | Text: "${d.decision_text}" | Effective Date: ${d.effective_date ?? 'N/A'} | Owner: ${d.owner_name ?? 'Unassigned'} | Meeting: "${d.meeting_title ?? ''}" (${d.meeting_date ?? ''}) | Quote (${d.source_speaker ?? 'Unknown'}): "${d.source_quote ?? ''}"`
    )
    .join('\n');

  const actionsContext = memory.actionItems
    .slice(0, 12)
    .map(
      (a) =>
        `- [ACTION_ITEM id=${a.id}] Title: "${a.title}" | Due: ${a.due_date ?? 'None'} | Status: ${a.status} | Owner: ${a.owner_name ?? 'Unconfirmed'}`
    )
    .join('\n');

  const depsContext = memory.dependencies
    .map(
      (dep) =>
        `- [DEPENDENCY id=${dep.id}] ${dep.source_title} (${dep.source_date ?? 'no date'}) --[${dep.relationship}]--> ${dep.target_title} (${dep.target_date ?? 'no date'}): ${dep.description ?? ''}`
    )
    .join('\n');

  const semanticContext = memory.semanticMatches
    .slice(0, 6)
    .map((m) => `- (${m.sourceType}, score=${m.similarityScore}): ${m.content}`)
    .join('\n');

  const deterministicNote =
    deterministicFindings.length > 0
      ? `Deterministic rule checks already flagged:\n${deterministicFindings.map((f) => `- ${f.conflictType} (${f.severity}): ${f.explanation}`).join('\n')}`
      : 'No deterministic rule violations flagged yet.';

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
- Effective Date: ${params.proposedDecision.effective_date ?? 'N/A'}
- Source Speaker: ${params.sourceSpeaker ?? 'Unknown'}
- Source Quote: "${params.sourceQuote ?? ''}"

Active Decisions in Memory:
${activeDecisionsContext || 'None'}

Tracked Action Items:
${actionsContext || 'None'}

Dependencies:
${depsContext || 'None'}

Semantic Memory Matches:
${semanticContext || 'None'}

${deterministicNote}`;

  const response = await generateContentResilient({
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          has_conflict: { type: Type.BOOLEAN },
          conflict_type: {
            type: Type.STRING,
            enum: [
              'DECISION_CONFLICT',
              'DEADLINE_CONFLICT',
              'OWNER_CONFLICT',
              'DEPENDENCY_CONFLICT',
              'SUPERSESSION',
              'REVERSAL',
              'COMPATIBLE_UPDATE',
              'NONE',
            ],
          },
          severity: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
          existing_item_id: { type: Type.STRING, nullable: true },
          existing_item_type: { type: Type.STRING, enum: ['DECISION', 'ACTION_ITEM', 'DEPENDENCY'], nullable: true },
          explanation: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          requires_approval: { type: Type.BOOLEAN },
        },
        required: [
          'has_conflict',
          'conflict_type',
          'severity',
          'explanation',
          'confidence',
          'requires_approval',
        ],
      },
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error('Conflict & Reasoning Agent received an empty response from Gemini.');
  }

  const parsed = ConflictJudgmentSchema.parse(JSON.parse(rawText));

  // Verify existing_item_id actually exists in candidate context to prevent hallucinated IDs
  const validIds = new Set([
    ...candidateActiveDecisions.map((d) => d.id),
    ...memory.actionItems.map((a) => a.id),
    ...memory.dependencies.map((dep) => dep.id),
  ]);
  if (parsed.existing_item_id && !validIds.has(parsed.existing_item_id)) {
    parsed.existing_item_id = candidateActiveDecisions[0]?.id ?? null;
    parsed.existing_item_type = parsed.existing_item_id ? 'DECISION' : null;
  }

  return {
    aiJudgment: parsed,
    deterministicFindings,
    memoryHitsCount: memory.semanticMatches.length + candidateActiveDecisions.length,
  };
}
