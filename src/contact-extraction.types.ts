/** Stable codes for sheet filtering and logs */
export type DiagnosticCode =
  | 'BIS_NO_JOBS'
  | 'BIS_NO_PW1_FORM'
  | 'BIS_NO_IFRAME'
  | 'BIS_PDF_DOWNLOAD_FAILED'
  | 'BIS_FOLDER_ERROR'
  | 'BIS_NAV_FAILED'
  | 'GEMINI_QUOTA_EXCEEDED'
  | 'GEMINI_POST_APPROVAL_SKIP'
  | 'GEMINI_PARSE_OR_EMPTY'
  | 'GEMINI_ERROR'
  | 'DOBNOW_UI_TIMEOUT'
  | 'DOBNOW_NO_ASBESTOS_PDF'
  | 'DOBNOW_ERROR'
  | 'ACCESS_POSSIBLE_BLOCK';

export interface DiagnosticNote {
  stage: string;
  code: DiagnosticCode | string;
  detail?: string;
}

export interface ContactExtractionOutcome {
  contact: {
    email?: string;
    phoneNumber?: string;
    name?: string;
  };
  notes: DiagnosticNote[];
  screenshotPath?: string;
  /** Last BIS document/PDF URL that returned 403 or access denied */
  deniedUrl?: string;
}

export type GeminiPdfExtractionResult =
  | {
      ok: true;
      data: { phoneNumber?: string; email?: string; name?: string };
    }
  | { ok: false; code: DiagnosticCode | string; detail?: string };

const REASON_MAX_LEN = 500;

export function formatReasonFromNotes(notes: DiagnosticNote[]): string {
  if (notes.length === 0) {
    return '';
  }
  const parts = notes.map((n) =>
    n.detail ? `${n.code}: ${n.detail}` : n.code,
  );
  let s = parts.join('; ');
  if (s.length > REASON_MAX_LEN) {
    s = `${s.slice(0, REASON_MAX_LEN - 3)}...`;
  }
  const has403 = notes.some(
    (n) =>
      n.detail?.includes('403') ||
      n.code === 'ACCESS_POSSIBLE_BLOCK' ||
      (n.code === 'BIS_PDF_DOWNLOAD_FAILED' &&
        /status\s*[:=]\s*403/i.test(n.detail || '')),
  );
  const hasTimeout = notes.some(
    (n) =>
      n.code === 'DOBNOW_UI_TIMEOUT' ||
      n.code === 'BIS_NAV_FAILED' ||
      (n.detail && /timeout/i.test(n.detail)),
  );
  if (has403 || hasTimeout) {
    const hint =
      'hint: possible network/geo block or slow site — try VPN or retry';
    const combined = `${s}; ${hint}`;
    return combined.length > REASON_MAX_LEN
      ? `${combined.slice(0, REASON_MAX_LEN - 3)}...`
      : combined;
  }
  return s;
}

export function emptyOutcome(): ContactExtractionOutcome {
  return {
    contact: {},
    notes: [],
    screenshotPath: undefined,
    deniedUrl: undefined,
  };
}

export function hasAnyContact(c: ContactExtractionOutcome['contact']): boolean {
  return !!(
    (c.email && c.email.trim()) ||
    (c.phoneNumber && c.phoneNumber.trim()) ||
    (c.name && c.name.trim())
  );
}

export function mergeContact(
  primary: ContactExtractionOutcome['contact'],
  secondary: ContactExtractionOutcome['contact'],
): ContactExtractionOutcome['contact'] {
  return {
    email: secondary.email || primary.email || '',
    phoneNumber: secondary.phoneNumber || primary.phoneNumber || '',
    name: secondary.name || primary.name || '',
  };
}
