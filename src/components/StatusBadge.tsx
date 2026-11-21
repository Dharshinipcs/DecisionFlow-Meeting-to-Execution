import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  GitBranch,
  History,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'No date';
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatShortMonthDay(iso: string | null | undefined): string {
  if (!iso) return 'No date';
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function StatusTag({ status }: { status: string }) {
  const normalized = status.toUpperCase();

  switch (normalized) {
    case 'ACTIVE':
    case 'APPROVED':
    case 'COMPLETED':
    case 'PROCESSED':
    case 'RESOLVED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-raven-200 bg-raven-50 px-2 py-0.5 text-xs font-medium text-raven-900 whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-raven-700" aria-hidden="true" />
          <span>{humanizeStatus(normalized)}</span>
        </span>
      );
    case 'IN_PROGRESS':
    case 'PROCESSING':
    case 'EDITED':
    case 'UPCOMING_DEADLINE':
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-raven-200 bg-white px-2 py-0.5 text-xs font-medium text-raven-800 whitespace-nowrap shrink-0">
          <FileCheck2 className="w-3.5 h-3.5 text-raven-700" aria-hidden="true" />
          <span>{humanizeStatus(normalized)}</span>
        </span>
      );
    case 'HIGH':
    case 'OVERDUE':
    case 'FAILED':
    case 'AT_RISK':
    case 'PENDING':
    case 'PROPOSED':
    case 'MEDIUM':
    case 'OPEN':
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-apricot-200 bg-apricot-50 px-2 py-0.5 text-xs font-medium text-apricot-700 whitespace-nowrap shrink-0">
          {normalized === 'HIGH' || normalized === 'OVERDUE' || normalized === 'FAILED' ? (
            <ShieldAlert className="w-3.5 h-3.5 text-apricot-600" aria-hidden="true" />
          ) : normalized === 'AT_RISK' || normalized === 'MEDIUM' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-apricot-600" aria-hidden="true" />
          ) : (
            <Clock className="w-3.5 h-3.5 text-apricot-600" aria-hidden="true" />
          )}
          <span>{humanizeStatus(normalized)}</span>
        </span>
      );
    case 'SUPERSEDED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-seagrass-200 bg-seagrass-100 px-2 py-0.5 text-xs font-medium text-seagrass-700 whitespace-nowrap shrink-0">
          <History className="w-3.5 h-3.5 text-seagrass-500" aria-hidden="true" />
          <span>Superseded</span>
        </span>
      );
    case 'REJECTED':
    case 'CANCELLED':
    case 'DISMISSED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-seagrass-200 bg-seagrass-100 px-2 py-0.5 text-xs font-medium text-seagrass-700 whitespace-nowrap shrink-0">
          <XCircle className="w-3.5 h-3.5 text-seagrass-500" aria-hidden="true" />
          <span>{humanizeStatus(normalized)}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-seagrass-200 bg-seagrass-100 px-2 py-0.5 text-xs font-medium text-seagrass-700 whitespace-nowrap shrink-0">
          <GitBranch className="w-3.5 h-3.5 text-seagrass-500" aria-hidden="true" />
          <span>{humanizeStatus(normalized)}</span>
        </span>
      );
  }
}

function humanizeStatus(s: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'Active',
    APPROVED: 'Approved',
    COMPLETED: 'Completed',
    PROCESSED: 'Processed',
    PROCESSING: 'Processing',
    UPLOADED: 'Uploaded',
    FAILED: 'Failed',
    RESOLVED: 'Resolved',
    DISMISSED: 'Dismissed',
    HIGH: 'High Risk',
    MEDIUM: 'Medium Risk',
    LOW: 'Low Risk',
    OVERDUE: 'Overdue',
    AT_RISK: 'At Risk',
    UPCOMING_DEADLINE: 'Upcoming',
    PENDING: 'Pending Review',
    PROPOSED: 'Proposed',
    OPEN: 'Open',
    IN_PROGRESS: 'In Progress',
    SUPERSEDED: 'Superseded',
    REJECTED: 'Rejected',
    EDITED: 'Edited & Approved',
    CANCELLED: 'Cancelled',
  };
  return map[s] ?? s;
}
