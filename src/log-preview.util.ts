const DEFAULT_MAX_LEN = 400;

/**
 * Collapse multi-line log payloads to one line so Cloud Logging does not
 * emit each HTML line as a separate entry.
 */
export function toSingleLineLog(value: string, maxLen = DEFAULT_MAX_LEN): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLen - 3)}...`;
}

/**
 * Short diagnostic summary of HTML (title + visible text), without script/style noise.
 */
export function formatHtmlLogPreview(
  html: string,
  maxLen = DEFAULT_MAX_LEN,
): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const title = withoutNoise
    .match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
    ?.trim();

  const bodyText = withoutNoise
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts: string[] = [];
  if (title) {
    parts.push(`title="${title}"`);
  }
  if (bodyText) {
    parts.push(`text="${bodyText}"`);
  }

  const summary = parts.length > 0 ? parts.join(' ') : withoutNoise;
  return toSingleLineLog(summary, maxLen);
}

/**
 * Safe one-line preview for arbitrary response bodies (HTML, JSON, etc.).
 */
export function formatBodyLogPreview(
  body: string,
  maxLen = DEFAULT_MAX_LEN,
): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return '(empty)';
  }
  if (/<html|<!DOCTYPE/i.test(trimmed)) {
    return formatHtmlLogPreview(trimmed, maxLen);
  }
  return toSingleLineLog(trimmed, maxLen);
}
