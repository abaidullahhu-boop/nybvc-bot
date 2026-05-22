const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'test.com',
  'email.com',
  'domain.com',
  'yoursite.com',
  'sentry.io',
  'wixpress.com',
]);

const BLOCKED_LOCAL_PARTS = new Set(['noreply', 'no-reply', 'donotreply']);

export interface ExtractedEmail {
  email: string;
}

export class EmailExtractorService {
  extractAll(text: string): string[] {
    if (!text?.trim()) {
      return [];
    }
    const matches = text.match(EMAIL_REGEX) || [];
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const raw of matches) {
      const normalized = raw.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(normalized);
      }
    }
    return unique.filter((email) => this.isValidEmail(email));
  }

  extractFirstValid(text: string): ExtractedEmail | null {
    const emails = this.extractAll(text);
    if (emails.length === 0) {
      return null;
    }
    return { email: emails[0] };
  }

  isValidEmail(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      return false;
    }
    const [localPart, domain] = normalized.split('@');
    if (!localPart || !domain || !domain.includes('.')) {
      return false;
    }
    if (BLOCKED_LOCAL_PARTS.has(localPart)) {
      return false;
    }
    const domainRoot = domain.split('.').slice(-2).join('.');
    if (BLOCKED_EMAIL_DOMAINS.has(domain) || BLOCKED_EMAIL_DOMAINS.has(domainRoot)) {
      return false;
    }
    return true;
  }
}
