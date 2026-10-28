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

/**
 * Parses any timestamp representation (number, numeric string, ISO string,
 * Firestore Timestamp with seconds/toMillis, or date + time strings) into epoch milliseconds.
 */
export function parseTimestampToEpochMs(
  val: any,
  fallbackDate?: string,
  fallbackTime?: string
): number | null {
  if (val !== null && val !== undefined) {
    // 1. Standard number
    if (typeof val === 'number' && !isNaN(val) && val > 0) {
      if (val < 10000000000) return val * 1000; // 10-digit Unix timestamp
      return val;
    }

    // 2. Firestore Timestamp object
    if (typeof val === 'object') {
      if (typeof val.toMillis === 'function') {
        const ms = val.toMillis();
        if (typeof ms === 'number' && !isNaN(ms) && ms > 0) return ms;
      }
      if (typeof val.seconds === 'number') {
        return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
      }
      if (typeof val._seconds === 'number') {
        return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
      }
    }

    // 3. String representation
    if (typeof val === 'string') {
      const trimmed = val.trim();
      // Numeric string e.g. "1730103480000"
      if (/^\d+$/.test(trimmed)) {
        const parsedNum = parseInt(trimmed, 10);
        if (!isNaN(parsedNum) && parsedNum > 0) {
          if (parsedNum < 10000000000) return parsedNum * 1000;
          return parsedNum;
        }
      }
      // ISO string e.g. "2026-10-28T12:18:00+05:00"
      const parsedDate = new Date(trimmed).getTime();
      if (!isNaN(parsedDate) && parsedDate > 0) {
        return parsedDate;
      }
    }
  }

  // 4. Fallback: Parse from date & time string in Asia/Karachi timezone
  // e.g. date: "2026-10-28", time: "12:18 PM"
  if (fallbackTime && typeof fallbackTime === 'string') {
    const timeClean = fallbackTime.replace(/[—–-]/g, '').trim();
    if (timeClean) {
      const targetDate = fallbackDate || getKarachiDateString();
      const match = timeClean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (match) {
        let hour = parseInt(match[1], 10);
        const min = parseInt(match[2], 10);
        const sec = match[3] ? parseInt(match[3], 10) : 0;
        const meridian = (match[4] || '').toUpperCase();

        if (meridian === 'PM' && hour < 12) hour += 12;
        if (meridian === 'AM' && hour === 12) hour = 0;

        const padH = String(hour).padStart(2, '0');
        const padM = String(min).padStart(2, '0');
        const padS = String(sec).padStart(2, '0');

        const isoStr = `${targetDate}T${padH}:${padM}:${padS}+05:00`;
        const parsed = new Date(isoStr).getTime();
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  }

  return null;
}

export interface CalculatedAttendanceTimes {
  clockInMs: number | null;
  shiftElapsedSeconds: number;
  shiftElapsedDisplay: string;
  totalBreakSeconds: number;
  breakMinutes: number;
  breakDisplay: string;
  activeBreakSeconds: number;
  activeBreakDisplay: string;
  netWorkingSeconds: number;
  workedDisplay: string;
  isWorking: boolean;
  isOnBreak: boolean;
  isCompleted: boolean;
}

/**
 * Authoritatively calculates shift elapsed time, break durations, and net working time
 * using: elapsed time = current time − clock-in time − completed break durations − active break duration.
 */
export function calculateAttendanceTimes(
  session: any,
  nowMs: number = Date.now()
): CalculatedAttendanceTimes {
  const isWorking = session?.state === 'Working';
  const isOnBreak = session?.state === 'On break';
  const isCompleted = session?.state === 'Completed' || session?.state === 'Clocked out';

  // 1. Resolve authoritative clock-in epoch timestamp
  const clockInMs = parseTimestampToEpochMs(
    session?.clockInTimestamp || session?.lastWorkStartTimestamp || session?.clockInIso,
    session?.date,
    session?.clockInDisplay || session?.clockedIn || session?.clockIn
  );

  // If completed/clocked out, preserve sealed/saved time and do not tick
  if (isCompleted) {
    const finalNet = session?.netWorkingSeconds ?? session?.accumulatedWorkedSeconds ?? session?.workedSeconds ?? 0;
    const finalBreaks = session?.totalBreakSeconds ?? session?.breakSeconds ?? (session?.breakMinutes ? session.breakMinutes * 60 : 0);
    const finalShift = session?.shiftElapsedSeconds ?? (finalNet + finalBreaks);

    return {
      clockInMs,
      shiftElapsedSeconds: finalShift,
      shiftElapsedDisplay: session?.shiftElapsedDisplay || formatDuration(finalShift),
      totalBreakSeconds: finalBreaks,
      breakMinutes: Math.floor(finalBreaks / 60),
      breakDisplay: session?.breakDisplay || formatDuration(finalBreaks),
      activeBreakSeconds: 0,
      activeBreakDisplay: '00h 00m 00s',
      netWorkingSeconds: finalNet,
      workedDisplay: session?.workedDisplay || session?.worked || formatDuration(finalNet),
      isWorking: false,
      isOnBreak: false,
      isCompleted: true,
    };
  }

  // 2. Calculate shift elapsed time from clock-in timestamp
  const shiftElapsedSeconds = clockInMs ? Math.max(0, Math.floor((nowMs - clockInMs) / 1000)) : 0;

  // 3. Calculate completed breaks from the breaks array or saved totals
  let completedBreakSeconds = 0;
  if (Array.isArray(session?.breaks) && session.breaks.length > 0) {
    for (const b of session.breaks) {
      if (typeof b.durationSeconds === 'number' && !isNaN(b.durationSeconds) && b.durationSeconds >= 0) {
        completedBreakSeconds += b.durationSeconds;
      } else {
        const start = parseTimestampToEpochMs(b.startTime || b.startIso, session?.date, b.startDisplay);
        const end = parseTimestampToEpochMs(b.endTime || b.endIso, session?.date, b.endDisplay);
        if (start && end && end >= start) {
          completedBreakSeconds += Math.max(0, Math.floor((end - start) / 1000));
        }
      }
    }
  } else if (typeof session?.totalBreakSeconds === 'number' && !isNaN(session.totalBreakSeconds)) {
    completedBreakSeconds = session.totalBreakSeconds;
  } else if (typeof session?.breakSeconds === 'number' && !isNaN(session.breakSeconds)) {
    completedBreakSeconds = session.breakSeconds;
  } else if (typeof session?.breakMinutes === 'number' && !isNaN(session.breakMinutes)) {
    completedBreakSeconds = session.breakMinutes * 60;
  }

  // 4. Calculate active break duration if currently on break
  let activeBreakSeconds = 0;
  if (isOnBreak) {
    const breakStartMs = parseTimestampToEpochMs(
      session?.currentBreakStart || session?.lastBreakStartTimestamp,
      session?.date
    ) || nowMs;
    activeBreakSeconds = Math.max(0, Math.floor((nowMs - breakStartMs) / 1000));
  }

  const totalBreakSeconds = completedBreakSeconds + activeBreakSeconds;
  const netWorkingSeconds = Math.max(0, shiftElapsedSeconds - totalBreakSeconds);

  return {
    clockInMs,
    shiftElapsedSeconds,
    shiftElapsedDisplay: formatDuration(shiftElapsedSeconds, { showSeconds: true }),
    totalBreakSeconds,
    breakMinutes: Math.floor(totalBreakSeconds / 60),
    breakDisplay: formatDuration(totalBreakSeconds, { showSeconds: true }),
    activeBreakSeconds,
    activeBreakDisplay: formatDuration(activeBreakSeconds, { showSeconds: true }),
    netWorkingSeconds,
    workedDisplay: formatDuration(netWorkingSeconds, { showSeconds: true }),
    isWorking,
    isOnBreak,
    isCompleted,
  };
}
