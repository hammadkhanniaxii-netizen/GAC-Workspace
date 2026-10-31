import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  formatKarachiTime,
  getKarachiDateString,
  formatDuration,
  parseTimestampToEpochMs,
  calculateAttendanceTimes,
} from '../utils/timeZone';

export interface AttendanceHistoryItem {
  id: string;
  sessionId?: string;
  date: string;
  clockIn: string;
  clockOut: string;
  worked: string;
  breakMinutes: number;
  status: string;
  shiftElapsedSeconds?: number;
  netWorkingSeconds?: number;
  breaks?: any[];
  requiresReview?: boolean;
}

export interface AuthoritativeAttendanceSession {
  userId: string;
  sessionId: string;
  employeeName: string;
  employeeEmail: string;
  department?: string;
  title?: string;
  date: string; // YYYY-MM-DD (PKT)
  state: 'Working' | 'On break' | 'Clocked out';
  isActive: boolean;

  clockInTimestamp: number | null;
  clockInIso: string | null;
  clockInDisplay: string;
  clockedIn?: string;

  clockOutTimestamp?: number | null;
  clockOutIso?: string | null;
  clockOutDisplay?: string;

  lastWorkStartTimestamp: number | null;
  lastBreakStartTimestamp?: number | null;
  currentBreakStart: number | null;

  totalBreakSeconds: number;
  breakSeconds: number;
  breakMinutes: number;
  breaks: Array<{
    id: string;
    startTime: number;
    startIso: string;
    startDisplay: string;
    endTime?: number | null;
    endIso?: string | null;
    endDisplay?: string | null;
    durationSeconds?: number;
    durationDisplay?: string;
  }>;

  accumulatedWorkedSeconds: number;
  workedSeconds: number;
  worked: string;
  shiftElapsedSeconds?: number;
  netWorkingSeconds?: number;

  status?: string;
  requiresReview?: boolean;
  isMissedClockout?: boolean;

  history: AttendanceHistoryItem[];
  updatedAt: string;
}

// Multi-tab BroadcastChannel for instantaneous same-origin tab synchronization
let attendanceChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    attendanceChannel = new BroadcastChannel('ga_workforce_attendance_sync');
  }
} catch (e) {
  console.warn('BroadcastChannel not supported in this context', e);
}

export function broadcastAttendanceUpdate(data: Partial<AuthoritativeAttendanceSession>) {
  try {
    if (attendanceChannel) {
      attendanceChannel.postMessage({
        type: 'ATTENDANCE_STATE_CHANGED',
        payload: data,
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    console.warn('Broadcast attendance error:', e);
  }
}

export function listenToAttendanceBroadcast(
  callback: (data: Partial<AuthoritativeAttendanceSession>) => void
): () => void {
  if (!attendanceChannel) return () => {};

  const handler = (ev: MessageEvent) => {
    if (ev.data && ev.data.type === 'ATTENDANCE_STATE_CHANGED' && ev.data.payload) {
      callback(ev.data.payload);
    }
  };

  attendanceChannel.addEventListener('message', handler);
  return () => {
    attendanceChannel?.removeEventListener('message', handler);
  };
}

/**
 * Creates default clean Clocked Out state for a given user.
 */
export function getDefaultAttendanceState(
  userId: string = '',
  name: string = '',
  email: string = ''
): AuthoritativeAttendanceSession {
  return {
    userId,
    sessionId: '',
    employeeName: name,
    employeeEmail: email,
    date: getKarachiDateString(),
    state: 'Clocked out',
    isActive: false,
    clockInTimestamp: null,
    clockInIso: null,
    clockInDisplay: '—',
    clockedIn: '—',
    clockOutTimestamp: null,
    clockOutIso: null,
    clockOutDisplay: '—',
    lastWorkStartTimestamp: null,
    lastBreakStartTimestamp: null,
    currentBreakStart: null,
    totalBreakSeconds: 0,
    breakSeconds: 0,
    breakMinutes: 0,
    breaks: [],
    accumulatedWorkedSeconds: 0,
    workedSeconds: 0,
    worked: '00h 00m',
    status: 'Ready',
    requiresReview: false,
    isMissedClockout: false,
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Clock In action: Persists directly to Firestore (with API attempt),
 * creating an authoritative active session.
 */
export async function clockInSession(
  user: { id: string; name?: string; email?: string; department?: string; title?: string },
  idToken?: string
): Promise<AuthoritativeAttendanceSession> {
  const userId = user.id;
  if (!userId) throw new Error('Authentication required: user ID is missing.');

  const nowMs = Date.now();
  const todayStr = getKarachiDateString(nowMs);
  const timeDisplay = formatKarachiTime(nowMs);
  const sessionId = `ATT-${nowMs.toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

  // 1. First attempt via server API if idToken is present
  if (idToken) {
    try {
      const res = await fetch('/api/attendance/clock-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success && data.session) {
          broadcastAttendanceUpdate(data.session);
          return data.session;
        }
      }
    } catch (apiErr) {
      console.warn('API clock-in failed or unavailable; falling back to direct Firestore:', apiErr);
    }
  }

  // 2. Direct Firestore Authoritative Execution (Primary for Netlify / Serverless)
  const attRef = doc(db, 'attendance', userId);
  const existingSnap = await getDoc(attRef);
  let existingHistory: AttendanceHistoryItem[] = [];

  if (existingSnap.exists()) {
    const existingData = existingSnap.data() as AuthoritativeAttendanceSession;
    if (Array.isArray(existingData.history)) {
      existingHistory = existingData.history;
    }

    // Check if session is already active today
    if (existingData.date === todayStr && existingData.isActive && (existingData.state === 'Working' || existingData.state === 'On break')) {
      throw new Error('You already have an active work session in progress for today.');
    }
  }

  const newSession: AuthoritativeAttendanceSession = {
    userId,
    sessionId,
    employeeName: user.name || 'Member',
    employeeEmail: user.email || '',
    department: user.department || 'Enterprise Advisory',
    title: user.title || 'Consultant',
    date: todayStr,
    state: 'Working',
    isActive: true,
    clockInTimestamp: nowMs,
    clockInIso: new Date(nowMs).toISOString(),
    clockInDisplay: timeDisplay,
    clockedIn: timeDisplay,
    clockOutTimestamp: null,
    clockOutIso: null,
    clockOutDisplay: '—',
    lastWorkStartTimestamp: nowMs,
    lastBreakStartTimestamp: null,
    currentBreakStart: null,
    totalBreakSeconds: 0,
    breakSeconds: 0,
    breakMinutes: 0,
    breaks: [],
    accumulatedWorkedSeconds: 0,
    workedSeconds: 0,
    worked: '00h 00m',
    status: 'In Progress',
    requiresReview: false,
    isMissedClockout: false,
    history: existingHistory,
    updatedAt: new Date(nowMs).toISOString(),
  };

  // Persist canonical session to attendance/${userId}
  await setDoc(attRef, newSession, { merge: true });

  // Also write auxiliary records for admin audits
  try {
    await setDoc(doc(db, 'attendance', `active_${userId}`), newSession, { merge: true });
  } catch (auxErr) {
    console.warn('Active attendance write notice:', auxErr);
  }
  try {
    await setDoc(doc(db, 'attendance', `rec_${sessionId}`), newSession, { merge: true });
  } catch (recErr) {
    console.warn('Session record write notice:', recErr);
  }

  broadcastAttendanceUpdate(newSession);
  return newSession;
}

/**
 * Start Break action: Sets state to 'On break', stores currentBreakStart.
 */
export async function startBreakSession(
  user: { id: string; name?: string; email?: string },
  currentSession: AuthoritativeAttendanceSession,
  idToken?: string
): Promise<AuthoritativeAttendanceSession> {
  const userId = user.id;
  if (!userId) throw new Error('Authentication required.');

  // 1. Attempt API
  if (idToken) {
    try {
      const res = await fetch('/api/attendance/start-break', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success && data.session) {
          broadcastAttendanceUpdate(data.session);
          return data.session;
        }
      }
    } catch (apiErr) {
      console.warn('API start-break failed; falling back to direct Firestore:', apiErr);
    }
  }

  // 2. Direct Firestore Execution
  const attRef = doc(db, 'attendance', userId);
  const snap = await getDoc(attRef);
  if (!snap.exists()) {
    throw new Error('No active work session found to take a break.');
  }

  const dbSession = snap.data() as AuthoritativeAttendanceSession;
  if (!dbSession.isActive || dbSession.state === 'Clocked out') {
    throw new Error('No active work session found in the database to pause.');
  }
  if (dbSession.state === 'On break') {
    throw new Error('You are already on an active break.');
  }

  const nowMs = Date.now();
  const stretch = dbSession.lastWorkStartTimestamp
    ? Math.max(0, Math.floor((nowMs - dbSession.lastWorkStartTimestamp) / 1000))
    : 0;
  const newAccumulated = (dbSession.accumulatedWorkedSeconds || 0) + stretch;

  const updated: AuthoritativeAttendanceSession = {
    ...dbSession,
    state: 'On break',
    lastWorkStartTimestamp: null,
    lastBreakStartTimestamp: nowMs,
    currentBreakStart: nowMs,
    accumulatedWorkedSeconds: newAccumulated,
    updatedAt: new Date(nowMs).toISOString(),
  };

  await setDoc(attRef, updated, { merge: true });
  try {
    await setDoc(doc(db, 'attendance', `active_${userId}`), updated, { merge: true });
    if (updated.sessionId) {
      await setDoc(doc(db, 'attendance', `rec_${updated.sessionId}`), updated, { merge: true });
    }
  } catch {}

  broadcastAttendanceUpdate(updated);
  return updated;
}

/**
 * End Break action: Seals active break, calculates break duration, resumes 'Working'.
 */
export async function endBreakSession(
  user: { id: string; name?: string; email?: string },
  currentSession: AuthoritativeAttendanceSession,
  idToken?: string
): Promise<AuthoritativeAttendanceSession> {
  const userId = user.id;
  if (!userId) throw new Error('Authentication required.');

  // 1. Attempt API
  if (idToken) {
    try {
      const res = await fetch('/api/attendance/end-break', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success && data.session) {
          broadcastAttendanceUpdate(data.session);
          return data.session;
        }
      }
    } catch (apiErr) {
      console.warn('API end-break failed; falling back to direct Firestore:', apiErr);
    }
  }

  // 2. Direct Firestore Execution
  const attRef = doc(db, 'attendance', userId);
  const snap = await getDoc(attRef);
  if (!snap.exists()) {
    throw new Error('No active work session found.');
  }

  const dbSession = snap.data() as AuthoritativeAttendanceSession;
  if (dbSession.state !== 'On break') {
    throw new Error('No active break session to resume from.');
  }

  const nowMs = Date.now();
  const breakStart = dbSession.currentBreakStart || dbSession.lastBreakStartTimestamp || nowMs;
  const breakDuration = Math.max(0, Math.floor((nowMs - breakStart) / 1000));
  const newTotalBreak = (dbSession.totalBreakSeconds || 0) + breakDuration;

  const breakItem = {
    id: `BRK-${nowMs.toString().slice(-4)}`,
    startTime: breakStart,
    startIso: new Date(breakStart).toISOString(),
    startDisplay: formatKarachiTime(breakStart),
    endTime: nowMs,
    endIso: new Date(nowMs).toISOString(),
    endDisplay: formatKarachiTime(nowMs),
    durationSeconds: breakDuration,
    durationDisplay: `${Math.floor(breakDuration / 60)}m ${breakDuration % 60}s`,
  };

  const updatedBreaks = Array.isArray(dbSession.breaks) ? [...dbSession.breaks, breakItem] : [breakItem];

  const updated: AuthoritativeAttendanceSession = {
    ...dbSession,
    state: 'Working',
    currentBreakStart: null,
    lastBreakStartTimestamp: null,
    lastWorkStartTimestamp: nowMs,
    totalBreakSeconds: newTotalBreak,
    breakSeconds: newTotalBreak,
    breakMinutes: Math.floor(newTotalBreak / 60),
    breaks: updatedBreaks,
    updatedAt: new Date(nowMs).toISOString(),
  };

  await setDoc(attRef, updated, { merge: true });
  try {
    await setDoc(doc(db, 'attendance', `active_${userId}`), updated, { merge: true });
    if (updated.sessionId) {
      await setDoc(doc(db, 'attendance', `rec_${updated.sessionId}`), updated, { merge: true });
    }
  } catch {}

  broadcastAttendanceUpdate(updated);
  return updated;
}

/**
 * Clock Out action: Finalizes the shift, calculates net working time,
 * records to history, seals session in Firestore.
 */
export async function clockOutSession(
  user: { id: string; name?: string; email?: string },
  currentSession: AuthoritativeAttendanceSession,
  idToken?: string
): Promise<AuthoritativeAttendanceSession> {
  const userId = user.id;
  if (!userId) throw new Error('Authentication required.');

  // 1. Attempt API
  if (idToken) {
    try {
      const res = await fetch('/api/attendance/clock-out', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success && data.session) {
          broadcastAttendanceUpdate(data.session);
          return data.session;
        }
      }
    } catch (apiErr) {
      console.warn('API clock-out failed; falling back to direct Firestore:', apiErr);
    }
  }

  // 2. Direct Firestore Execution
  const attRef = doc(db, 'attendance', userId);
  const snap = await getDoc(attRef);
  if (!snap.exists()) {
    throw new Error('No active work session found in database to clock out.');
  }

  const dbSession = snap.data() as AuthoritativeAttendanceSession;
  if (!dbSession.isActive && dbSession.state === 'Clocked out') {
    throw new Error('Your session is already completed and clocked out.');
  }

  const nowMs = Date.now();
  const clockOutDisplay = formatKarachiTime(nowMs);
  let totalBreakSeconds = dbSession.totalBreakSeconds || 0;
  const breaks = Array.isArray(dbSession.breaks) ? [...dbSession.breaks] : [];
  let accumulated = dbSession.accumulatedWorkedSeconds || 0;

  // Auto-close open break if clocking out while on break
  if (dbSession.state === 'On break') {
    const breakStart = dbSession.currentBreakStart || dbSession.lastBreakStartTimestamp || nowMs;
    const breakDuration = Math.max(0, Math.floor((nowMs - breakStart) / 1000));
    totalBreakSeconds += breakDuration;
    breaks.push({
      id: `BRK-${nowMs.toString().slice(-4)}`,
      startTime: breakStart,
      startIso: new Date(breakStart).toISOString(),
      startDisplay: formatKarachiTime(breakStart),
      endTime: nowMs,
      endIso: new Date(nowMs).toISOString(),
      endDisplay: clockOutDisplay,
      durationSeconds: breakDuration,
      durationDisplay: `${Math.floor(breakDuration / 60)}m ${breakDuration % 60}s`,
    });
  } else if (dbSession.state === 'Working' && dbSession.lastWorkStartTimestamp) {
    const currentStretch = Math.max(0, Math.floor((nowMs - dbSession.lastWorkStartTimestamp) / 1000));
    accumulated += currentStretch;
  }

  const clockInEpoch = dbSession.clockInTimestamp || nowMs;
  const shiftElapsedSeconds = Math.max(0, Math.floor((nowMs - clockInEpoch) / 1000));
  const netWorkingSeconds = Math.max(0, shiftElapsedSeconds - totalBreakSeconds);
  const isExcessiveShift = shiftElapsedSeconds > 14 * 3600;

  const finalStatus = isExcessiveShift
    ? 'Requires Review'
    : netWorkingSeconds >= 28800
    ? 'Compliant'
    : 'Verified';

  const sessionId = dbSession.sessionId || `ATT-${nowMs.toString().slice(-6)}`;
  const completedHistoryItem: AttendanceHistoryItem = {
    id: sessionId,
    sessionId,
    date: dbSession.date,
    clockIn: dbSession.clockInDisplay || '—',
    clockOut: clockOutDisplay,
    worked: formatDuration(netWorkingSeconds, { showSeconds: true }),
    breakMinutes: Math.floor(totalBreakSeconds / 60),
    status: finalStatus,
    shiftElapsedSeconds,
    netWorkingSeconds,
    breaks,
    requiresReview: isExcessiveShift,
  };

  const existingHistory = Array.isArray(dbSession.history) ? dbSession.history : [];
  const updatedHistory = [completedHistoryItem, ...existingHistory];

  const closedSession: AuthoritativeAttendanceSession = {
    ...dbSession,
    state: 'Clocked out',
    isActive: false,
    status: finalStatus,
    clockOutTimestamp: nowMs,
    clockOutIso: new Date(nowMs).toISOString(),
    clockOutDisplay,
    shiftElapsedSeconds,
    netWorkingSeconds,
    totalBreakSeconds,
    breakSeconds: totalBreakSeconds,
    breakMinutes: Math.floor(totalBreakSeconds / 60),
    breaks,
    workedSeconds: netWorkingSeconds,
    worked: formatDuration(netWorkingSeconds, { showSeconds: true }),
    lastWorkStartTimestamp: null,
    lastBreakStartTimestamp: null,
    currentBreakStart: null,
    history: updatedHistory,
    requiresReview: isExcessiveShift,
    isMissedClockout: isExcessiveShift,
    updatedAt: new Date(nowMs).toISOString(),
  };

  await setDoc(attRef, closedSession, { merge: true });

  // Delete active pointer and record permanent historical record
  try {
    await deleteDoc(doc(db, 'attendance', `active_${userId}`));
  } catch (delErr) {
    console.warn('Active pointer cleanup notice:', delErr);
  }
  try {
    await setDoc(doc(db, 'attendance', `rec_${sessionId}`), closedSession, { merge: true });
  } catch (recErr) {
    console.warn('Session record archive notice:', recErr);
  }

  broadcastAttendanceUpdate(closedSession);
  return closedSession;
}
