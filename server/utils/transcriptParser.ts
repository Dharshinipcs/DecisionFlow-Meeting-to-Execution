export interface ParsedSegment {
  sequenceNumber: number;
  speakerName: string;
  speakerRole: string | null;
  startTime: string | null;
  endTime: string | null;
  text: string;
}

const NON_SPEAKER_LABELS = new Set([
  'http',
  'https',
  'ftp',
  'mailto',
  'note',
  'notes',
  'summary',
  'agenda',
  'topic',
  'date',
  'time',
  'subject',
  'meeting',
  'attendees',
  'participants',
  'action',
  'actions',
  'action item',
  'action items',
  'decision',
  'decisions',
]);

const UNCONFIRMED_OWNER_TOKENS = new Set([
  'unknown',
  'unknown speaker',
  'unassigned',
  'tbd',
  'none',
  'n/a',
  'na',
  'someone',
  'anyone',
  'somebody',
  'anybody',
  'everyone',
  'team',
  'the team',
]);

export function extractSpeakerAndRole(raw: string): { name: string; role: string | null } {
  const cleaned = raw.replace(/\*\*/g, '').trim();
  const roleMatch = cleaned.match(/^(.+?)\s*\(([^()]{1,60})\)\s*$/);
  if (roleMatch) {
    return {
      name: roleMatch[1].trim(),
      role: roleMatch[2].trim() || null,
    };
  }
  return { name: cleaned, role: null };
}

export function normalizeConfirmedPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const { name } = extractSpeakerAndRole(stripOuterQuotes(raw));
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (
    UNCONFIRMED_OWNER_TOKENS.has(lower) ||
    lower.startsWith('someone ') ||
    lower.startsWith('anyone ') ||
    lower.startsWith('somebody ') ||
    lower.startsWith('anybody ') ||
    lower.startsWith('a member of ') ||
    lower.includes('not confirmed') ||
    lower.includes('unconfirmed') ||
    /\bteam\b$/.test(lower)
  ) {
    return null;
  }
  return cleaned;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Parses common meeting transcript formats (.txt, .md, pasted dialogue)
 * while preserving dynamic speaker attribution, optional roles, and sequence order.
 */
export function parseTranscript(rawTranscript: string): ParsedSegment[] {
  const normalized = rawTranscript.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const segments: ParsedSegment[] = [];

  let pendingSpeaker: string | null = null;
  let pendingRole: string | null = null;
  let pendingTime: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const joined = stripOuterQuotes(buffer.join(' ').trim());
    if (joined) {
      segments.push({
        sequenceNumber: segments.length + 1,
        speakerName: pendingSpeaker || 'Unknown Speaker',
        speakerRole: pendingRole,
        startTime: pendingTime,
        endTime: null,
        text: joined,
      });
    }
    pendingSpeaker = null;
    pendingRole = null;
    pendingTime = null;
    buffer = [];
  };

  // Matches:
  // [00:12] Priya: text
  // (00:12) Priya (Product Manager): text
  // **Priya**: text
  // **Karthik (QA Lead)**: text
  // **Karthik** (QA Lead): text
  // Karthik (QA Lead): text
  // Priya: text
  // Priya: (with text on next line)
  const speakerHeaderRegex =
    /^(?:\[([^\]]+)\]\s*|\((\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\)\s*)?(?:\*\*([^*:]{1,90})\*\*|([^:*\n]{1,90}?))(?:\s*\(([^()]{1,60})\))?\s*:\s*(.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (buffer.length > 0) {
        flush();
      }
      continue;
    }

    // Skip markdown heading lines like "# Payment Launch Review"
    if (line.startsWith('#')) {
      continue;
    }

    // Strip blockquote marker if present
    const cleanedLine = line.startsWith('>') ? line.slice(1).trim() : line;
    const match = cleanedLine.match(speakerHeaderRegex);

    if (match) {
      const timestamp = (match[1] || match[2] || '').trim() || null;
      const rawSpeakerCandidate = (match[3] || match[4] || '').trim();
      const trailingRole = (match[5] || '').trim() || null;
      const rest = (match[6] || '').trim();

      const extracted = extractSpeakerAndRole(rawSpeakerCandidate);
      const speaker = extracted.name;
      const role = trailingRole ?? extracted.role;

      const wordCount = speaker ? speaker.split(/\s+/).length : 0;
      const startsWithLetter = /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(speaker);
      const validNameChars = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{0,48}$/.test(speaker);
      const isUrl = rest.startsWith('//') || speaker.toLowerCase().includes('http');
      const isNonSpeakerHeader = !role && NON_SPEAKER_LABELS.has(speaker.toLowerCase());

      if (speaker && startsWithLetter && validNameChars && wordCount <= 4 && !isUrl && !isNonSpeakerHeader) {
        if (pendingSpeaker !== null || buffer.length > 0) {
          flush();
        }
        pendingSpeaker = speaker;
        pendingRole = role;
        pendingTime = timestamp;
        if (rest) {
          buffer.push(rest);
        }
        continue;
      }
    }

    buffer.push(cleanedLine);
  }

  if (buffer.length > 0) {
    flush();
  }

  return segments;
}

