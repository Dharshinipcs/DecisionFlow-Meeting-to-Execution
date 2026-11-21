import { z } from 'zod';

// ---- API Request Schemas ----

export const CreateMeetingRequestSchema = z.object({
  teamId: z.string().min(1).optional(),
  title: z.string().trim().min(2, 'Meeting title must be at least 2 characters').max(200),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Meeting date must be YYYY-MM-DD'),
  sourceType: z.enum(['PASTE', 'TXT', 'MD']).default('PASTE'),
  sourceFileName: z.string().max(255).nullable().optional(),
  transcript: z.string().trim().min(10, 'Transcript must contain at least 10 characters'),
});

export const ApprovalDecisionRequestSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['APPROVE', 'EDIT', 'REJECT']),
  reviewedBy: z.string().min(1).optional(),
  edits: z
    .object({
      title: z.string().trim().min(1).max(300).optional(),
      decisionText: z.string().trim().min(1).max(1000).optional(),
      effectiveDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      ownerId: z.string().nullable().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      rationale: z.string().max(1000).optional(),
    })
    .optional(),
});

export const CreateGitHubIssueRequestSchema = z.object({
  actionItemId: z.string().min(1),
  approvalId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
});

export const UpdateTaskStatusSchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED']),
  userId: z.string().optional(),
});

export const MemoryQueryRequestSchema = z.object({
  teamId: z.string().min(1).optional(),
  question: z.string().trim().min(2, 'Question is too short').max(1000),
});

export const GenerateDigestRequestSchema = z.object({
  teamId: z.string().min(1).optional(),
  userId: z.string().min(1),
});

export const ResolveConflictSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']),
  userId: z.string().optional(),
});

// ---- AI Structured Output Schemas (Zod-validated) ----

export const ExtractedDecisionSchema = z.object({
  topic: z.string().min(1),
  decision_text: z.string().min(1),
  classification: z.enum(['PROPOSAL', 'CONFIRMED_DECISION', 'SUPERSESSION']),
  owner_name: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  source_segment_sequence: z.number().int().min(1),
  confidence: z.number().min(0).max(1),
});

export const ExtractedActionSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  owner_confirmed: z.boolean(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  is_open_loop: z.boolean(),
  open_loop_reason: z.string().nullable().optional(),
  source_segment_sequence: z.number().int().min(1),
});

export const ExtractedDependencySchema = z.object({
  source_title: z.string().min(1),
  source_kind: z.enum(['DECISION', 'ACTION_ITEM']),
  target_title: z.string().min(1),
  target_kind: z.enum(['DECISION', 'ACTION_ITEM']),
  relationship: z.string().min(1),
  description: z.string().min(1),
  source_segment_sequence: z.number().int().min(1),
});

export const ExtractedOpenLoopSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  source_segment_sequence: z.number().int().min(1),
});

export const MeetingExtractionSchema = z.object({
  summary: z.string().min(1),
  mentioned_people: z.array(z.string()),
  decisions: z.array(ExtractedDecisionSchema),
  action_items: z.array(ExtractedActionSchema),
  dependencies: z.array(ExtractedDependencySchema),
  open_loops: z.array(ExtractedOpenLoopSchema),
});

export type MeetingExtractionResult = z.infer<typeof MeetingExtractionSchema>;

export const ConflictJudgmentSchema = z.object({
  has_conflict: z.boolean(),
  conflict_type: z.enum([
    'DECISION_CONFLICT',
    'DEADLINE_CONFLICT',
    'OWNER_CONFLICT',
    'DEPENDENCY_CONFLICT',
    'SUPERSESSION',
    'REVERSAL',
    'COMPATIBLE_UPDATE',
    'NONE',
  ]),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  existing_item_id: z.string().nullable().optional(),
  existing_item_type: z.enum(['DECISION', 'ACTION_ITEM', 'DEPENDENCY']).nullable().optional(),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  requires_approval: z.boolean(),
});

export type ConflictJudgmentResult = z.infer<typeof ConflictJudgmentSchema>;

export const MemoryAnswerSchema = z.object({
  answer: z.string().min(1),
  has_sufficient_evidence: z.boolean(),
  cited_source_ids: z.array(z.string()),
});

export type MemoryAnswerAiResult = z.infer<typeof MemoryAnswerSchema>;
