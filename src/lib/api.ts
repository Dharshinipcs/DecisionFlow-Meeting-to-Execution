import type {
  ActionItem,
  ActionStatus,
  ApprovalItem,
  AuditEvent,
  Conflict,
  DashboardPayload,
  Decision,
  DecisionVersion,
  Dependency,
  ExternalTask,
  Meeting,
  MeetingParticipant,
  MemoryAnswer,
  Reminder,
  TranscriptSegment,
  User,
  WeeklyDigest,
} from '../types/decisionflow';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const api = {
  getHealth: () =>
    request<{
      ok: boolean;
      geminiConfigured: boolean;
      githubConfigured: boolean;
      githubRepo: string | null;
      githubMissingVars: string[];
    }>('/api/health'),

  getSampleMeeting3: () =>
    request<{
      title: string;
      meetingDate: string;
      sourceType: 'PASTE' | 'TXT' | 'MD';
      sourceFileName: string;
      transcript: string;
    }>('/api/demo/sample-meeting-3'),

  resetDemo: () => request<{ ok: boolean; message: string }>('/api/demo/reset', { method: 'POST' }),

  getDashboard: (userId?: string) =>
    request<DashboardPayload>(`/api/dashboard${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),

  getMeetings: () => request<{ meetings: Meeting[] }>('/api/meetings'),

  createMeeting: (payload: {
    title: string;
    meetingDate: string;
    sourceType: 'PASTE' | 'TXT' | 'MD';
    sourceFileName?: string | null;
    transcript: string;
  }) => request<{ meeting: Meeting }>('/api/meetings', { method: 'POST', body: JSON.stringify(payload) }),

  getMeetingDetail: (meetingId: string) =>
    request<{
      meeting: Meeting & { raw_transcript: string };
      participants: MeetingParticipant[];
      segments: TranscriptSegment[];
      decisions: Decision[];
      actions: ActionItem[];
      dependencies: Dependency[];
      conflicts: Conflict[];
      audit: AuditEvent[];
    }>(`/api/meetings/${encodeURIComponent(meetingId)}`),

  processMeeting: (meetingId: string) =>
    request<{
      meeting: Meeting;
      alreadyProcessed: boolean;
      timeline: Array<{ step: string; detail: string; timestamp: string }>;
      extractedDecisionsCount: number;
      extractedActionsCount: number;
      conflictsDetectedCount: number;
      approvalsCreatedCount: number;
      aiFallbackUsed?: boolean;
      aiStatus?: string;
    }>(`/api/meetings/${encodeURIComponent(meetingId)}/process`, { method: 'POST' }),

  getDecisions: () =>
    request<{ decisions: Decision[]; dependencies: Dependency[]; conflicts: Conflict[] }>('/api/decisions'),

  getDecisionDetail: (decisionId: string) =>
    request<{
      decision: Decision;
      lineage: Decision[];
      versions: DecisionVersion[];
      dependencies: Dependency[];
      conflicts: Conflict[];
    }>(`/api/decisions/${encodeURIComponent(decisionId)}`),

  getApprovals: () =>
    request<{
      approvals: ApprovalItem[];
      conflicts: Conflict[];
      users: User[];
      githubConfigured: boolean;
    }>('/api/approvals'),

  submitApproval: (payload: {
    approvalId: string;
    decision: 'APPROVE' | 'EDIT' | 'REJECT';
    reviewedBy?: string;
    edits?: {
      title?: string;
      decisionText?: string;
      effectiveDate?: string | null;
      dueDate?: string | null;
      ownerId?: string | null;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH';
      rationale?: string;
    };
  }) =>
    request<{
      approval: ApprovalItem;
      message: string;
      supersededDecisionId: string | null;
      activatedDecisionId: string | null;
      affectedItems: Array<{ type: string; id: string; title: string; warning: string }>;
    }>('/api/approvals', { method: 'POST', body: JSON.stringify(payload) }),

  getTasks: () =>
    request<{
      tasks: ActionItem[];
      reminders: Reminder[];
      dependencies: Dependency[];
      github: { configured: boolean; owner: string | null; repo: string | null; missingVars: string[] };
    }>('/api/tasks'),

  updateTaskStatus: (taskId: string, status: ActionStatus, userId?: string) =>
    request<{ task: ActionItem }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, userId }),
    }),

  createGitHubIssue: (payload: { actionItemId: string; approvalId?: string; userId?: string }) =>
    request<{ externalTask: ExternalTask; alreadyExisted: boolean }>('/api/github/create-issue', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  syncGitHubIssue: (taskId: string) =>
    request<{ externalTask: ExternalTask }>(`/api/tasks/${encodeURIComponent(taskId)}/sync-github`, {
      method: 'POST',
    }),

  getDigest: (userId: string, refresh = false) =>
    request<{ digest: WeeklyDigest }>(
      `/api/digest/${encodeURIComponent(userId)}${refresh ? '?refresh=true' : ''}`
    ),

  askMemory: (question: string) =>
    request<MemoryAnswer>('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  getAuditEvents: () => request<{ events: AuditEvent[] }>('/api/audit'),
};
