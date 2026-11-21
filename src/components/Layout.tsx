import React, { useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  Mail,
  Menu,
  MessageSquareText,
  Plus,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { User } from '../types/decisionflow';
import { getInitials } from './StatusBadge';

export type NavRoute =
  | 'dashboard'
  | 'meetings'
  | 'meeting-detail'
  | 'decisions'
  | 'memory'
  | 'conflicts'
  | 'tasks'
  | 'digest';

interface LayoutProps {
  activeRoute: NavRoute;
  pageTitle: string;
  breadcrumb?: string;
  pendingCount: number;
  teamName: string;
  users: User[];
  currentUser: User | null;
  onSelectUser: (userId: string) => void;
  onNavigate: (route: NavRoute) => void;
  onOpenUpload: () => void;
  onResetDemo: () => Promise<void>;
  toast: { type: 'success' | 'error'; message: string } | null;
  onDismissToast: () => void;
  children: React.ReactNode;
}

export function Layout({
  activeRoute,
  pageTitle,
  breadcrumb,
  pendingCount,
  teamName,
  users,
  currentUser,
  onSelectUser,
  onNavigate,
  onOpenUpload,
  onResetDemo,
  toast,
  onDismissToast,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const navItems: Array<{
    id: NavRoute;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'meetings', label: 'Meetings', icon: CalendarDays },
    { id: 'decisions', label: 'Decision Memory', icon: BookOpen },
    {
      id: 'conflicts',
      label: 'Conflicts & Approvals',
      icon: ShieldAlert,
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare },
    { id: 'digest', label: 'Weekly Digest', icon: Mail },
    { id: 'memory', label: 'Ask Memory', icon: MessageSquareText },
  ];

  const isNavActive = (itemId: NavRoute) => {
    if (itemId === 'meetings' && activeRoute === 'meeting-detail') return true;
    return activeRoute === itemId;
  };

  const handleConfirmReset = async () => {
    setResetting(true);
    try {
      await onResetDemo();
      setResetConfirmOpen(false);
    } finally {
      setResetting(false);
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-raven-900 text-raven-50 border-r border-raven-800">
      <div>
        <div className="flex items-center justify-between px-5 h-15 border-b border-raven-800 bg-raven-950/35">
          <button
            type="button"
            onClick={() => {
              onNavigate('dashboard');
              setMobileOpen(false);
            }}
            className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-apricot-400 rounded"
          >
            <span className="text-base font-semibold tracking-tight text-apricot-400 font-display whitespace-nowrap">
              DecisionFlow
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden rounded p-1.5 text-raven-200 hover:bg-raven-800 hover:text-white"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="px-3 py-5 space-y-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-apricot-400 ${
                  active
                    ? 'bg-raven-800 text-white font-semibold border-l-2 border-apricot-400'
                    : 'text-raven-200 font-medium hover:bg-raven-800/65 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-apricot-300' : 'text-raven-300'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="ml-2 inline-flex items-center justify-center rounded bg-apricot-600 px-1.5 py-0.5 text-xs font-mono font-semibold text-white tabular-nums shrink-0">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-raven-800 p-4 space-y-3 bg-raven-950/45">
        <div>
          <div className="text-xs text-raven-300">Workspace</div>
          <div className="text-sm font-semibold text-white truncate mt-0.5">{teamName}</div>
        </div>

        <div>
          <label htmlFor="active-user-select" className="block text-xs text-raven-300 mb-1">
            Acting as
          </label>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-raven-800 border border-raven-700 text-xs font-semibold text-raven-50 shrink-0">
              {getInitials(currentUser?.name)}
            </span>
            <select
              id="active-user-select"
              value={currentUser?.id ?? ''}
              onChange={(e) => onSelectUser(e.target.value)}
              className="w-full rounded-md border border-raven-700 bg-raven-900 px-2.5 py-1.5 text-xs font-medium text-white focus:border-apricot-400 focus:outline-none"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setResetConfirmOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-md border border-raven-700 bg-raven-900 px-3 py-1.5 text-xs font-medium text-raven-200 hover:bg-raven-800 hover:text-white transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Demo Scenario</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-seagrass-100 text-raven-950">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-raven-950/45" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 w-64 h-full">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-6 h-15 px-6 bg-seagrass-50/95 backdrop-blur-xs border-b border-seagrass-200">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden rounded p-1.5 text-raven-900 hover:bg-seagrass-200"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              {breadcrumb && (
                <>
                  <span className="text-seagrass-600 truncate">{breadcrumb}</span>
                  <span className="text-seagrass-400">/</span>
                </>
              )}
              <h1 className="font-semibold text-raven-950 truncate font-display">{pageTitle}</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 rounded-md bg-raven-900 px-4 py-2 text-xs font-medium text-white hover:bg-raven-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-raven-700"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload Transcript</span>
          </button>
        </header>

        {toast && (
          <div className="px-6 pt-4 max-w-[1200px] w-full mx-auto">
            <div
              className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
                toast.type === 'success'
                  ? 'border-raven-700 bg-raven-900 text-white'
                  : 'border-apricot-300 bg-apricot-50 text-apricot-700'
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={onDismissToast}
                className="text-xs font-medium underline underline-offset-2 shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 px-6 py-7 max-w-[1200px] w-full mx-auto">{children}</main>
      </div>

      {/* Reset Demo Confirmation Dialog */}
      {resetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-raven-950/35 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-seagrass-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-raven-950 font-display">Reset Demo Workspace?</h2>
            <p className="text-sm text-seagrass-600 leading-relaxed">
              This restores Acme Product Team to its baseline state with Meeting 1 (Dec 10 launch decision) and Meeting 2 (Dec 8 security certification dependency) so you can replay the full workflow cleanly.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                disabled={resetting}
                className="px-4 py-2 text-xs font-medium text-seagrass-700 bg-white border border-seagrass-300 rounded-md hover:bg-seagrass-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                disabled={resetting}
                className="px-4 py-2 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800 disabled:opacity-60"
              >
                {resetting ? 'Resetting…' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
