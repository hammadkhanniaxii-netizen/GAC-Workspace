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
 * Retrieves the local Asia/Karachi (PKT, UTC+5) date and time components.
 */
export function getKarachiTimeParts(timestampOrIso: number | string | Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  epochMs: number;
} {
  const d = new Date(timestampOrIso);
  const epochMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  const validDate = new Date(epochMs);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KARACHI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(validDate);

  const year = parseInt(parts.find((p) => p.type === 'year')?.value || '1970', 10);
  const month = parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10);
  const day = parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);

  return { year, month, day, hour, minute, second, epochMs };
}

/**
 * Returns the calendar date in Asia/Karachi as YYYY-MM-DD (standard midnight-to-midnight).
 */
export function getKarachiCalendarDate(
  timestampOrIso: number | string | Date = new Date()
): string {
  const { year, month, day } = getKarachiTimeParts(timestampOrIso);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Defines the attendance business date in Asia/Karachi (6:00 AM to following 6:00 AM):
 * - If local time is 6:00 AM or later, use the current local calendar date.
 * - If local time is before 6:00 AM, use the previous local calendar date.
 */
export function getKarachiBusinessDate(
  timestampOrIso: number | string | Date = new Date()
): string {
  const { year, month, day, hour } = getKarachiTimeParts(timestampOrIso);

  if (hour >= 6) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else {
    // Falls into previous calendar day's business window
    const prevDateObj = new Date(Date.UTC(year, month - 1, day - 1));
    const py = prevDateObj.getUTCFullYear();
    const pm = String(prevDateObj.getUTCMonth() + 1).padStart(2, '0');
    const pd = String(prevDateObj.getUTCDate()).padStart(2, '0');
    return `${py}-${pm}-${pd}`;
  }
}

/**
 * Standard business date string helper for workforce attendance.
 * Returns the Asia/Karachi 6:00 AM-to-6:00 AM attendance business date (YYYY-MM-DD).
 */
export function getKarachiDateString(
  timestampOrIso: number | string | Date = new Date()
): string {
  return getKarachiBusinessDate(timestampOrIso);
}

/**
 * Returns the exact epoch millisecond boundaries for an attendance business day window.
 * A business day includes events from 6:00 AM inclusive up to, but not including, the next day's 6:00 AM (Asia/Karachi).
 */
export function getBusinessDayRange(businessDate: string): {
  startMs: number;
  endMs: number;
  businessDate: string;
} {
  const [y, m, d] = businessDate.split('-').map(Number);
  const startIso = `${businessDate}T06:00:00.000+05:00`;
  const startMs = new Date(startIso).getTime();

  const nextDateObj = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDateObj.getUTCFullYear();
  const nm = String(nextDateObj.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(nextDateObj.getUTCDate()).padStart(2, '0');
  const nextDateStr = `${ny}-${nm}-${nd}`;
  const endIso = `${nextDateStr}T06:00:00.000+05:00`;
  const endMs = new Date(endIso).getTime();

  return { startMs, endMs, businessDate };
}

/**
 * Returns true if a timestamp falls within the 6:00 AM - 6:00 AM window for a given business day.
 */
export function isTimestampInBusinessDay(timestampMs: number, businessDate: string): boolean {
  const { startMs, endMs } = getBusinessDayRange(businessDate);
  return timestampMs >= startMs && timestampMs < endMs;
}

/**
 * Result of splitting a session's work across a specific time window.
 */
export interface WindowWorkBreakdown {
  shiftElapsedSeconds: number;
  totalBreakSeconds: number;
  netWorkingSeconds: number;
  workedDisplay: string;
  breakDisplay: string;
}

/**
 * Calculates the exact portion of shift elapsed time, break duration, and net working time
 * that falls within a given time window [windowStartMs, windowEndMs).
 * Preserves the original session record and does not modify any saved timestamps.
 */
export function calculateSessionWorkInWindow(
  session: any,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number = Date.now()
): WindowWorkBreakdown {
  const clockInMs = parseTimestampToEpochMs(
    session?.clockInTimestamp ||
      session?.clockInEpochMs ||
      session?.clockInMs ||
      session?.lastWorkStartTimestamp ||
      session?.clockInIso,
    session?.date,
    session?.clockInDisplay || session?.clockedIn || session?.clockIn
  );

  if (!clockInMs) {
    return {
      shiftElapsedSeconds: 0,
      totalBreakSeconds: 0,
      netWorkingSeconds: 0,
      workedDisplay: '00h 00m',
      breakDisplay: '00h 00m',
    };
  }

  const isCompleted = session?.state === 'Completed' || session?.state === 'Clocked out';
  let clockOutMs: number | null = null;
  if (isCompleted) {
    clockOutMs = parseTimestampToEpochMs(
      session?.clockOutTimestamp || session?.clockOutIso,
      session?.date,
      session?.clockOutDisplay || session?.clockOut
    );
    if (!clockOutMs) {
      const net = session?.netWorkingSeconds ?? session?.accumulatedWorkedSeconds ?? 0;
      const brk = session?.totalBreakSeconds ?? (session?.breakMinutes ? session.breakMinutes * 60 : 0);
      clockOutMs = clockInMs + (net + brk) * 1000;
    }
  } else {
    clockOutMs = nowMs;
  }

  // Overlap of shift with [windowStartMs, windowEndMs)
  const shiftOverlapStart = Math.max(clockInMs, windowStartMs);
  const shiftOverlapEnd = Math.min(clockOutMs, windowEndMs);

  if (shiftOverlapStart >= shiftOverlapEnd) {
    return {
      shiftElapsedSeconds: 0,
      totalBreakSeconds: 0,
      netWorkingSeconds: 0,
      workedDisplay: '00h 00m',
      breakDisplay: '00h 00m',
    };
  }

  const shiftElapsedSeconds = Math.max(0, Math.floor((shiftOverlapEnd - shiftOverlapStart) / 1000));

  // Overlap of breaks with [windowStartMs, windowEndMs)
  let breakSecondsInWindow = 0;
  if (Array.isArray(session?.breaks) && session.breaks.length > 0) {
    for (const b of session.breaks) {
      const bStart = parseTimestampToEpochMs(b.startTime || b.startIso, session?.date, b.startDisplay);
      let bEnd = parseTimestampToEpochMs(b.endTime || b.endIso, session?.date, b.endDisplay);
      if (!bEnd && session.state === 'On break') {
        bEnd = nowMs;
      }
      if (bStart && bEnd && bEnd > bStart) {
        const bOverlapStart = Math.max(bStart, windowStartMs);
        const bOverlapEnd = Math.min(bEnd, windowEndMs);
        if (bOverlapEnd > bOverlapStart) {
          breakSecondsInWindow += Math.max(0, Math.floor((bOverlapEnd - bOverlapStart) / 1000));
        }
      }
    }
  } else {
    const totalBreaks = session?.totalBreakSeconds || (session?.breakMinutes ? session.breakMinutes * 60 : 0);
    if (totalBreaks > 0) {
      const totalShiftDuration = Math.max(1, Math.floor((clockOutMs - clockInMs) / 1000));
      const ratio = shiftElapsedSeconds / totalShiftDuration;
      breakSecondsInWindow = Math.round(totalBreaks * ratio);
    }
  }

  // Active ongoing break
  if (session?.state === 'On break' && session?.currentBreakStart) {
    const curBreakStartMs = parseTimestampToEpochMs(session.currentBreakStart, session?.date) || nowMs;
    const curBreakOverlapStart = Math.max(curBreakStartMs, windowStartMs);
    const curBreakOverlapEnd = Math.min(nowMs, windowEndMs);
    if (curBreakOverlapEnd > curBreakOverlapStart) {
      const hasInArray = Array.isArray(session?.breaks) && session.breaks.some((b: any) => parseTimestampToEpochMs(b.startTime) === curBreakStartMs);
      if (!hasInArray) {
        breakSecondsInWindow += Math.max(0, Math.floor((curBreakOverlapEnd - curBreakOverlapStart) / 1000));
      }
    }
  }

  breakSecondsInWindow = Math.min(shiftElapsedSeconds, breakSecondsInWindow);
  const netWorkingSeconds = Math.max(0, shiftElapsedSeconds - breakSecondsInWindow);

  return {
    shiftElapsedSeconds,
    totalBreakSeconds: breakSecondsInWindow,
    netWorkingSeconds,
    workedDisplay: formatDuration(netWorkingSeconds),
    breakDisplay: formatDuration(breakSecondsInWindow),
  };
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
 * Parses any timestamp representation into epoch milliseconds.
 */
export function parseTimestampToEpochMs(
  val: any,
  fallbackDate?: string,
  fallbackTime?: string
): number | null {
  if (val !== null && val !== undefined) {
    if (typeof val === 'number' && !isNaN(val) && val > 0) {
      if (val < 10000000000) return val * 1000;
      return val;
    }

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

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (/^\d+$/.test(trimmed)) {
        const parsedNum = parseInt(trimmed, 10);
        if (!isNaN(parsedNum) && parsedNum > 0) {
          if (parsedNum < 10000000000) return parsedNum * 1000;
          return parsedNum;
        }
      }
      const parsedDate = new Date(trimmed).getTime();
      if (!isNaN(parsedDate) && parsedDate > 0) {
        return parsedDate;
      }
    }
  }

  // Fallback: Parse from date & time string in Asia/Karachi timezone
  if (fallbackTime && typeof fallbackTime === 'string') {
    const timeClean = fallbackTime.replace(/[—–-]/g, '').trim();
    if (timeClean) {
      let targetDate = fallbackDate || getKarachiDateString();
      const match = timeClean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (match) {
        let hour = parseInt(match[1], 10);
        const min = parseInt(match[2], 10);
        const sec = match[3] ? parseInt(match[3], 10) : 0;
        const meridian = (match[4] || '').toUpperCase();

        if (meridian === 'PM' && hour < 12) hour += 12;
        if (meridian === 'AM' && hour === 12) hour = 0;

        // If targetDate is a business date and hour < 6, the calendar day is the next calendar date
        if (hour < 6 && targetDate) {
          const [y, m, d] = targetDate.split('-').map(Number);
          const nextDayObj = new Date(Date.UTC(y, m - 1, d + 1));
          const ny = nextDayObj.getUTCFullYear();
          const nm = String(nextDayObj.getUTCMonth() + 1).padStart(2, '0');
          const nd = String(nextDayObj.getUTCDate()).padStart(2, '0');
          targetDate = `${ny}-${nm}-${nd}`;
        }

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
    session?.clockInTimestamp ||
      session?.clockInEpochMs ||
      session?.clockInMs ||
      session?.lastWorkStartTimestamp ||
      session?.clockInIso,
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
