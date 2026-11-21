export type MeetingSourceType = 'PASTE' | 'TXT' | 'MD';
export type MeetingProcessingStatus = 'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export type DecisionStatus = 'PROPOSED' | 'ACTIVE' | 'SUPERSEDED' | 'REJECTED' | 'CANCELLED';
export type ActionStatus = 'PROPOSED' | 'APPROVED' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED';
export type ActionPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type ConflictType =
  | 'DECISION_CONFLICT'
  | 'DEADLINE_CONFLICT'
  | 'OWNER_CONFLICT'
  | 'DEPENDENCY_CONFLICT'
  | 'SUPERSESSION'
  | 'REVERSAL';

export type ConflictSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type ConflictStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export type ApprovalItemType = 'DECISION' | 'ACTION_ITEM' | 'DEPENDENCY';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EDITED';

export type ReminderType = 'UPCOMING_DEADLINE' | 'OVERDUE' | 'AT_RISK';
export type ReminderStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Team {
  id: string;
  name: string;
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  team_id: string;
  title: string;
  meeting_date: string;
  source_type: MeetingSourceType;
  source_file_name: string | null;
  processing_status: MeetingProcessingStatus;
  summary: string | null;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
  decision_count?: number;
  action_count?: number;
  conflict_count?: number;
}

export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  speaker_name: string;
  speaker_role?: string | null;
  speaker_id: string | null;
  start_time: string | null;
  end_time: string | null;
  text: string;
  sequence_number: number;
  created_at: string;
}

export interface MeetingParticipant {
  name: string;
  role: string | null;
  userId: string | null;
}

export interface Decision {
  id: string;
  team_id: string;
  meeting_id: string;
  topic: string;
  decision_text: string;
  status: DecisionStatus;
  owner_id: string | null;
  owner_name?: string | null;
  rationale: string | null;
  effective_date: string | null;
  source_segment_id: string | null;
  source_quote?: string | null;
  source_speaker?: string | null;
  source_speaker_role?: string | null;
  meeting_title?: string | null;
  meeting_date?: string | null;
  supersedes_decision_id: string | null;
  is_proposal: number;
  created_at: string;
  updated_at: string;
}

export interface DecisionVersion {
  id: string;
  decision_id: string;
  version_number: number;
  decision_text: string;
  effective_date: string | null;
  status: DecisionStatus;
  source_meeting_id: string;
  source_meeting_title?: string;
  source_meeting_date?: string;
  source_segment_id: string | null;
  source_quote?: string | null;
  source_speaker?: string | null;
  created_at: string;
}

export interface ExternalTask {
  id: string;
  action_item_id: string;
  provider: 'github';
  external_id: string;
  external_url: string;
  external_status: string;
  created_at: string;
  updated_at: string;
}

export interface ActionItem {
  id: string;
  team_id: string;
  meeting_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  owner_name?: string | null;
  due_date: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  is_open_loop: number;
  open_loop_reason: string | null;
  source_segment_id: string | null;
  source_quote?: string | null;
  source_speaker?: string | null;
  source_speaker_role?: string | null;
  meeting_title?: string | null;
  meeting_date?: string | null;
  approval_id?: string | null;
  approval_status?: ApprovalStatus | null;
  external_task?: ExternalTask | null;
  created_at: string;
  updated_at: string;
}

export interface Dependency {
  id: string;
  team_id: string;
  source_type: 'DECISION' | 'ACTION_ITEM';
  source_id: string;
  target_type: 'DECISION' | 'ACTION_ITEM';
  target_id: string;
  relationship: string;
  description: string | null;
  source_title?: string;
  source_date?: string | null;
  target_title?: string;
  target_date?: string | null;
  created_at: string;
}

export interface Conflict {
  id: string;
  team_id: string;
  meeting_id: string;
  conflict_type: ConflictType;
  severity: ConflictSeverity;
  status: ConflictStatus;
  existing_item_type: 'DECISION' | 'ACTION_ITEM' | 'DEPENDENCY';
  existing_item_id: string;
  new_item_type: 'DECISION' | 'ACTION_ITEM';
  new_item_id: string;
  explanation: string;
  confidence: number;
  created_at: string;
  resolved_at: string | null;
  meeting_title?: string;
  existing_summary?: string;
  existing_date?: string | null;
  existing_quote?: string | null;
  existing_speaker?: string | null;
  existing_meeting_title?: string | null;
  existing_meeting_date?: string | null;
  new_summary?: string;
  new_date?: string | null;
  new_quote?: string | null;
  new_speaker?: string | null;
  related_dependencies?: Dependency[];
}

export interface ApprovalItem {
  id: string;
  team_id: string;
  item_type: ApprovalItemType;
  reference_id: string;
  title: string;
  description: string | null;
  proposed_payload: string | null;
  status: ApprovalStatus;
  reviewed_by: string | null;
  reviewer_name?: string | null;
  reviewed_at: string | null;
  created_at: string;
  conflict?: Conflict | null;
  decision?: Decision | null;
  action_item?: ActionItem | null;
}

export interface Reminder {
  id: string;
  team_id: string;
  action_item_id: string;
  user_id: string | null;
  user_name?: string | null;
  action_title?: string;
  due_date?: string | null;
  action_status?: ActionStatus;
  reminder_type: ReminderType;
  message: string;
  scheduled_for: string;
  status: ReminderStatus;
  sent_at: string | null;
  created_at: string;
}

export interface WeeklyDigestContent {
  summary: string;
  needsAttention: Array<{
    title: string;
    dueDate: string | null;
    status: string;
    reason: string;
    actionId?: string;
  }>;
  atRisk: Array<{
    title: string;
    reason: string;
    dueDate: string | null;
    actionId?: string;
  }>;
  decisionsAffectingYou: Array<{
    topic: string;
    summary: string;
    status: string;
    previousDate?: string | null;
    currentDate?: string | null;
    decisionId: string;
  }>;
  openLoops: Array<{
    title: string;
    reason: string;
    meetingTitle: string;
  }>;
  completed: Array<{
    title: string;
    completedAt: string;
  }>;
  unresolvedConflicts: Array<{
    explanation: string;
    severity: ConflictSeverity;
    conflictId: string;
  }>;
}

export interface WeeklyDigest {
  id: string;
  team_id: string;
  user_id: string;
  user_name?: string;
  week_start: string;
  week_end: string;
  content: WeeklyDigestContent;
  generated_at: string;
}

export interface AuditEvent {
  id: string;
  team_id: string;
  user_id: string | null;
  user_name?: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface MemoryAnswerSource {
  sourceType: string;
  meetingId?: string;
  meetingTitle: string;
  meetingDate: string;
  speaker?: string;
  excerpt: string;
  referenceId?: string;
}

export interface MemoryAnswer {
  question: string;
  answer: string;
  hasSufficientEvidence: boolean;
  sources: MemoryAnswerSource[];
  relatedDecisions: Decision[];
  relatedDependencies: Dependency[];
}

export interface DashboardPayload {
  team: Team;
  currentUser: User;
  users: User[];
  metrics: {
    activeDecisions: number;
    openConflicts: number;
    pendingApprovals: number;
    myTasks: number;
    atRiskCount: number;
  };
  needsAttention: Array<{
    id: string;
    kind: 'CONFLICT' | 'APPROVAL' | 'REMINDER' | 'OPEN_LOOP';
    title: string;
    subtitle: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    href: string;
  }>;
  upcomingDeadlines: ActionItem[];
  recentMeetings: Meeting[];
  recentDecisions: Decision[];
  reminders: Reminder[];
  recentAudit: AuditEvent[];
  githubConfigured: boolean;
}
