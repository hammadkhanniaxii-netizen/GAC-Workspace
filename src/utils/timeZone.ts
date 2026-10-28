export const KARACHI_TIMEZONE = 'Asia/Karachi';

/**
 * Formats a timestamp, ISO string, or Date into Asia/Karachi (PKT, UTC+5) time format.
 */
export function formatKarachiTime(
  timestampOrIso: number | string | Date | null | undefined,
  options?: { includeSeconds?: boolean }
): string {
  if (!timestampOrIso) return '—';
  const d = new Date(timestampOrIso);
  if (isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: KARACHI_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: options?.includeSeconds ? '2-digit' : undefined,
    hour12: true,
  }).format(d);
}

/**
 * Formats a timestamp, ISO string, or Date into Asia/Karachi date display (e.g., "Oct 28, 2026").
 */
export function formatKarachiDate(
  timestampOrIso: number | string | Date | null | undefined
): string {
  if (!timestampOrIso) return '—';
  const d = new Date(timestampOrIso);
  if (isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: KARACHI_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

/**
 * Formats a timestamp into Asia/Karachi YYYY-MM-DD for grouping and comparison.
 */
export function getKarachiDateString(
  timestampOrIso: number | string | Date = new Date()
): string {
  const d = new Date(timestampOrIso);
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KARACHI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Formats duration in seconds to "08h 30m 00s" or "08h 30m" format.
 */
export function formatDuration(
  totalSeconds: number | null | undefined,
  options?: { showSeconds?: boolean }
): string {
  if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds) || totalSeconds < 0) {
    totalSeconds = 0;
  }
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);

  if (options?.showSeconds) {
    return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
}
