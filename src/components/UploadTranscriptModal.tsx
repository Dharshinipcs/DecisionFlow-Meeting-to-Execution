import React, { useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { api } from '../lib/api';

interface UploadTranscriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (meetingId: string, processed: boolean, aiStatus?: string) => void;
}

export function UploadTranscriptModal({ isOpen, onClose, onSuccess }: UploadTranscriptModalProps) {
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('2026-11-21');
  const [sourceType, setSourceType] = useState<'PASTE' | 'TXT' | 'MD'>('PASTE');
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLoadSample = async () => {
    setError(null);
    try {
      const sample = await api.getSampleMeeting3();
      setTitle(sample.title);
      setMeetingDate(sample.meetingDate);
      setSourceType(sample.sourceType);
      setSourceFileName(sample.sourceFileName);
      setTranscript(sample.transcript);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'txt' && ext !== 'md') {
      setError('Please select a .txt or .md transcript file.');
      return;
    }

    setSourceType(ext === 'md' ? 'MD' : 'TXT');
    setSourceFileName(file.name);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.(txt|md)$/i, '').replace(/[-_]/g, ' '));
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setTranscript(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (autoProcess: boolean) => {
    setError(null);
    if (!title.trim()) {
      setError('Meeting title is required.');
      return;
    }
    if (transcript.trim().length < 10) {
      setError('Please paste or upload a meeting transcript.');
      return;
    }

    try {
      setLoadingStep('Saving meeting transcript…');
      const created = await api.createMeeting({
        title: title.trim(),
        meetingDate,
        sourceType,
        sourceFileName,
        transcript: transcript.trim(),
      });

      let aiStatus: string | undefined;
      if (autoProcess) {
        setLoadingStep('Extracting decisions, recognizing speakers, and checking conflicts against memory…');
        const processedRes = await api.processMeeting(created.meeting.id);
        aiStatus = processedRes.aiStatus;
      }

      setLoadingStep(null);
      setTitle('');
      setTranscript('');
      setSourceFileName(null);
      onSuccess(created.meeting.id, autoProcess, aiStatus);
    } catch (err) {
      setLoadingStep(null);
      setError((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-raven-950/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="w-full max-w-2xl rounded-lg border border-seagrass-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-raven-800 bg-raven-900 text-white px-6 py-4">
          <div>
            <h2 id="upload-modal-title" className="text-base font-semibold text-white font-display">
              Upload Meeting Transcript
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(loadingStep)}
            className="rounded p-1.5 text-raven-200 hover:bg-raven-800 hover:text-white focus-visible:outline-2 focus-visible:outline-apricot-400"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-seagrass-200 bg-seagrass-50 px-4 py-3">
            <div className="text-xs text-seagrass-700">
              <span className="font-semibold text-raven-950">Sample scenario:</span>{' '}
              Load &ldquo;Payment Launch Review&rdquo; to test conflict detection against Dec 10 and Dec 8 security certification.
            </div>
            <button
              type="button"
              onClick={handleLoadSample}
              disabled={Boolean(loadingStep)}
              className="px-3 py-1.5 text-xs font-medium text-raven-800 bg-white border border-raven-200 rounded hover:bg-raven-50 whitespace-nowrap shrink-0 transition-colors"
            >
              Load Sample Transcript
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="meeting-title" className="block text-xs font-medium text-seagrass-700 mb-1.5">
                Meeting Title
              </label>
              <input
                id="meeting-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Payment Launch Review"
                disabled={Boolean(loadingStep)}
                className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-2 text-sm text-raven-950 focus:border-raven-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="meeting-date" className="block text-xs font-medium text-seagrass-700 mb-1.5">
                Meeting Date
              </label>
              <input
                id="meeting-date"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                disabled={Boolean(loadingStep)}
                className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-2 text-sm text-raven-950 font-mono tabular-nums focus:border-raven-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="transcript-input" className="block text-xs font-medium text-seagrass-700">
                Transcript (Speaker or Name (Role): statement)
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-raven-700 hover:text-raven-950 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Import .txt / .md</span>
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={handleFileChange}
                  disabled={Boolean(loadingStep)}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              id="transcript-input"
              rows={9}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={Boolean(loadingStep)}
              placeholder={`Priya (Product Manager): We need to finalize the payment platform launch schedule.\n\nKarthik (QA Lead): I will need two days after development to complete QA testing by December 9.`}
              className="w-full rounded-md border border-seagrass-300 bg-white px-3 py-2.5 text-sm text-raven-950 font-mono leading-relaxed focus:border-raven-700 focus:outline-none"
            />
            {sourceFileName && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-seagrass-600">
                <FileText className="w-3.5 h-3.5" />
                <span>Source: {sourceFileName}</span>
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-apricot-200 bg-apricot-50 px-4 py-2.5 text-xs text-apricot-700">
              {error}
            </div>
          )}

          {loadingStep && (
            <div className="flex items-center gap-2.5 rounded-md border border-raven-200 bg-raven-50 px-4 py-3 text-xs text-raven-900">
              <Loader2 className="w-4 h-4 animate-spin text-raven-700 shrink-0" />
              <span>{loadingStep}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-seagrass-200 px-6 py-4 bg-seagrass-50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(loadingStep)}
            className="px-4 py-2 text-xs font-medium text-seagrass-700 bg-white border border-seagrass-300 rounded-md hover:bg-seagrass-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={Boolean(loadingStep)}
            className="px-4 py-2 text-xs font-medium text-raven-900 bg-white border border-seagrass-300 rounded-md hover:bg-seagrass-50 whitespace-nowrap shrink-0"
          >
            Save Transcript
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={Boolean(loadingStep)}
            className="px-4 py-2 text-xs font-medium text-white bg-raven-900 rounded-md hover:bg-raven-800 whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            Upload &amp; Process
          </button>
        </div>
      </div>
    </div>
  );
}
