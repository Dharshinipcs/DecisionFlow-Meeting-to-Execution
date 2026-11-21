import { ThinkingLevel, Type } from '@google/genai';
import type Database from 'better-sqlite3';
import { generateContentResilient, type GeminiClientLike } from '../ai/client.ts';
import { normalizeConfirmedPersonName } from '../utils/transcriptParser.ts';
import {
  MeetingExtractionSchema,
  type MeetingExtractionResult,
} from '../validation/schemas.ts';
import type { MeetingParticipant, TranscriptSegment, User } from '../../src/types/decisionflow.ts';

export function resolveTeamMember(users: User[], candidateName: string | null | undefined): User | null {
  const normalized = normalizeConfirmedPersonName(candidateName);
  if (!normalized) return null;
  const cleaned = normalized.toLowerCase();

  // Exact full name match
  const exact = users.find((u) => u.name.toLowerCase() === cleaned);
  if (exact) return exact;

  // First name or partial token match (must be unambiguous)
  const matches = users.filter((u) => {
    const parts = u.name.toLowerCase().split(/\s+/);
    return parts.some((p) => p === cleaned) || u.name.toLowerCase().startsWith(cleaned);
  });

  return matches.length === 1 ? matches[0] : null;
}

export function extractParticipantsFromSegments(
  segments: Array<{
    speaker_name: string;
    speaker_role?: string | null;
    speaker_id?: string | null;
  }>
): MeetingParticipant[] {
  const byKey = new Map<string, MeetingParticipant>();
  for (const seg of segments) {
    const cleanName = normalizeConfirmedPersonName(seg.speaker_name);
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: cleanName,
        role: seg.speaker_role ?? null,
        userId: seg.speaker_id ?? null,
      });
    } else {
      if (!existing.role && seg.speaker_role) existing.role = seg.speaker_role;
      if (!existing.userId && seg.speaker_id) existing.userId = seg.speaker_id;
    }
  }
  return Array.from(byKey.values());
}

export function resolveOwnerIdentity(params: {
  candidateName: string | null | undefined;
  confirmed: boolean;
  teamMembers: User[];
  participants?: MeetingParticipant[];
}): { user: User | null; ownerName: string | null } {
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
    ownerName: matchedParticipant?.name ?? normalized,
  };
}

export async function runMeetingUnderstandingAgent(
  params: {
    meetingTitle: string;
    meetingDate: string;
    segments: TranscriptSegment[];
    teamMembers: User[];
  },
  options?: {
    client?: GeminiClientLike;
  }
): Promise<MeetingExtractionResult> {
  const teamRoster = params.teamMembers
    .map((u) => `- ${u.name} (${u.role})`)
    .join('\n');

  const dynamicParticipants = extractParticipantsFromSegments(params.segments);
  const participantsList =
    dynamicParticipants.length > 0
      ? dynamicParticipants
          .map((p) => `- ${p.name}${p.role ? ` (${p.role})` : ''}`)
          .join('\n')
      : '- None identified yet';

  const numberedTranscript = params.segments
    .map(
      (s) =>
        `[#${s.sequence_number}] ${s.speaker_name}${s.speaker_role ? ` (${s.speaker_role})` : ''}: "${s.text}"`
    )
    .join('\n');

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
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: 'Concise 2-3 sentence executive summary of meeting outcomes.' },
          mentioned_people: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          decisions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING, description: 'Short canonical topic name, e.g. "Payment launch"' },
                decision_text: { type: Type.STRING, description: 'Clear statement of the proposed or confirmed decision.' },
                classification: { type: Type.STRING, enum: ['PROPOSAL', 'CONFIRMED_DECISION', 'SUPERSESSION'] },
                owner_name: { type: Type.STRING, nullable: true },
                effective_date: { type: Type.STRING, nullable: true, description: 'YYYY-MM-DD date if a target/effective date is stated, else null.' },
                rationale: { type: Type.STRING, nullable: true },
                source_segment_sequence: { type: Type.INTEGER },
                confidence: { type: Type.NUMBER },
              },
              required: ['topic', 'decision_text', 'classification', 'source_segment_sequence', 'confidence'],
            },
          },
          action_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING, nullable: true },
                owner_name: { type: Type.STRING, nullable: true },
                owner_confirmed: { type: Type.BOOLEAN },
                due_date: { type: Type.STRING, nullable: true, description: 'YYYY-MM-DD if stated, else null.' },
                priority: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
                is_open_loop: { type: Type.BOOLEAN },
                open_loop_reason: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Optional reason when is_open_loop is true; omit or null for normal action items.',
                },
                source_segment_sequence: { type: Type.INTEGER },
              },
              required: ['title', 'owner_confirmed', 'priority', 'is_open_loop', 'source_segment_sequence'],
            },
          },
          dependencies: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source_title: { type: Type.STRING },
                source_kind: { type: Type.STRING, enum: ['DECISION', 'ACTION_ITEM'] },
                target_title: { type: Type.STRING },
                target_kind: { type: Type.STRING, enum: ['DECISION', 'ACTION_ITEM'] },
                relationship: { type: Type.STRING, description: 'e.g. MUST_HAPPEN_BEFORE or BLOCKS' },
                description: { type: Type.STRING },
                source_segment_sequence: { type: Type.INTEGER },
              },
              required: ['source_title', 'source_kind', 'target_title', 'target_kind', 'relationship', 'description', 'source_segment_sequence'],
            },
          },
          open_loops: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                reason: { type: Type.STRING },
                source_segment_sequence: { type: Type.INTEGER },
              },
              required: ['title', 'reason', 'source_segment_sequence'],
            },
          },
        },
        required: ['summary', 'mentioned_people', 'decisions', 'action_items', 'dependencies', 'open_loops'],
      },
    },
  }, options?.client ? { client: options.client } : undefined);

  const rawText = response.text;
  if (!rawText) {
    throw new Error('Meeting Understanding Agent received an empty response from Gemini.');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Meeting Understanding Agent returned invalid JSON: ${(err as Error).message}`);
  }

  return MeetingExtractionSchema.parse(parsedJson);
}

export function getTeamMembers(db: Database.Database, teamId: string): User[] {
  return db
    .prepare(
      `SELECT u.*
       FROM users u
       JOIN team_members tm ON tm.user_id = u.id
       WHERE tm.team_id = ?
       ORDER BY u.name ASC`
    )
    .all(teamId) as User[];
}
