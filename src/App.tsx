import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { DashboardPayload, Meeting } from './types/decisionflow';
import { Layout, type NavRoute } from './components/Layout';
import { UploadTranscriptModal } from './components/UploadTranscriptModal';
import { DashboardPage } from './pages/DashboardPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { MeetingDetailPage } from './pages/MeetingDetailPage';
import { DecisionMemoryPage } from './pages/DecisionMemoryPage';
import { ConflictsApprovalsPage } from './pages/ConflictsApprovalsPage';
import { TasksPage } from './pages/TasksPage';
import { WeeklyDigestPage } from './pages/WeeklyDigestPage';
import { AskMemoryPage } from './pages/AskMemoryPage';

export default function App() {
  const [route, setRoute] = useState<NavRoute>('dashboard');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  const refreshAll = useCallback(async (userIdOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, meetRes] = await Promise.all([
        api.getDashboard(userIdOverride ?? selectedUserId),
        api.getMeetings(),
      ]);
      setDashboard(dashRes);
      setMeetings(meetRes.meetings);
      if (!selectedUserId && dashRes.currentUser) {
        setSelectedUserId(dashRes.currentUser.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedUserId]);

  useEffect(() => {
    refreshAll();
  }, [selectedUserId]);

  const handleNavigate = (nextRoute: NavRoute, meetingId?: string) => {
    if (meetingId) {
      setSelectedMeetingId(meetingId);
    }
    setRoute(nextRoute);
  };

  const handleUploadSuccess = async (meetingId: string, processed: boolean, aiStatus?: string) => {
    setUploadModalOpen(false);
    setSelectedMeetingId(meetingId);
    setRoute('meeting-detail');
    await refreshAll();
    showToast(
      'success',
      processed
        ? `Transcript processed. Decisions, actions, and conflict checks are ready.${aiStatus ? ` (${aiStatus})` : ''}`
        : 'Transcript saved. Click Process Meeting to extract organizational memory.'
    );
  };

  const handleProcessMeeting = async (meetingId: string) => {
    try {
      const res = await api.processMeeting(meetingId);
      await refreshAll();
      showToast(
        'success',
        `Processed meeting: ${res.extractedDecisionsCount} decision(s), ${res.extractedActionsCount} action(s), ${res.conflictsDetectedCount} conflict(s).${res.aiStatus ? ` (${res.aiStatus})` : ''}`
      );
      setSelectedMeetingId(meetingId);
      setRoute('meeting-detail');
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleResetDemo = async () => {
    try {
      await api.resetDemo();
      setRoute('dashboard');
      setSelectedMeetingId(null);
      await refreshAll();
      showToast('success', 'Demo workspace reset to Acme Product Team baseline.');
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const pageMeta: Record<NavRoute, { title: string; breadcrumb?: string }> = {
    dashboard: { title: 'Dashboard', breadcrumb: 'Overview' },
    meetings: { title: 'Meetings', breadcrumb: 'Workspace' },
    'meeting-detail': { title: 'Meeting Detail', breadcrumb: 'Meetings' },
    decisions: { title: 'Decision Memory', breadcrumb: 'Memory' },
    memory: { title: 'Ask Memory', breadcrumb: 'Memory' },
    conflicts: { title: 'Conflicts & Approvals', breadcrumb: 'Execution' },
    tasks: { title: 'Tasks', breadcrumb: 'Execution' },
    digest: { title: 'Weekly Digest', breadcrumb: 'Execution' },
  };

  const currentUser = dashboard?.currentUser ?? null;
  const users = dashboard?.users ?? [];

  return (
    <>
      <Layout
        activeRoute={route}
        pageTitle={pageMeta[route].title}
        breadcrumb={pageMeta[route].breadcrumb}
        pendingCount={dashboard?.metrics.pendingApprovals ?? 0}
        teamName={dashboard?.team.name ?? 'Acme Product Team'}
        users={users}
        currentUser={currentUser}
        onSelectUser={(uid) => setSelectedUserId(uid)}
        onNavigate={(r) => handleNavigate(r)}
        onOpenUpload={() => setUploadModalOpen(true)}
        onResetDemo={handleResetDemo}
        toast={toast}
        onDismissToast={() => setToast(null)}
      >
        {route === 'dashboard' && (
          <DashboardPage
            data={dashboard}
            processedMeetingsCount={meetings.filter((m) => m.processing_status === 'PROCESSED').length}
            loading={loading}
            error={error}
            onNavigate={handleNavigate}
            onOpenUpload={() => setUploadModalOpen(true)}
          />
        )}

        {route === 'meetings' && (
          <MeetingsPage
            meetings={meetings}
            loading={loading}
            onSelectMeeting={(id) => handleNavigate('meeting-detail', id)}
            onProcessMeeting={handleProcessMeeting}
            onOpenUpload={() => setUploadModalOpen(true)}
          />
        )}

        {route === 'meeting-detail' && selectedMeetingId && (
          <MeetingDetailPage
            meetingId={selectedMeetingId}
            onBack={() => handleNavigate('meetings')}
            onNavigate={(r) => handleNavigate(r)}
            onProcessed={refreshAll}
          />
        )}

        {route === 'decisions' && <DecisionMemoryPage />}

        {route === 'conflicts' && (
          <ConflictsApprovalsPage
            currentUserId={currentUser?.id ?? ''}
            onChanged={refreshAll}
            onOpenUpload={() => setUploadModalOpen(true)}
            onNavigate={(r) => handleNavigate(r)}
            onToast={showToast}
          />
        )}

        {route === 'tasks' && (
          <TasksPage
            currentUserId={currentUser?.id ?? ''}
            onChanged={refreshAll}
            onToast={showToast}
          />
        )}

        {route === 'digest' && (
          <WeeklyDigestPage
            users={users}
            currentUserId={currentUser?.id ?? ''}
            onToast={showToast}
          />
        )}

        {route === 'memory' && (
          <AskMemoryPage
            onOpenMeeting={(id) => handleNavigate('meeting-detail', id)}
          />
        )}
      </Layout>

      <UploadTranscriptModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />
    </>
  );
}
