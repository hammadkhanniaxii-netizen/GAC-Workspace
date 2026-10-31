import {
  getKarachiTimeParts,
  getKarachiCalendarDate,
  getKarachiBusinessDate,
  getBusinessDayRange,
  isTimestampInBusinessDay,
  calculateSessionWorkInWindow,
  parseTimestampToEpochMs,
  formatDuration,
} from '../src/utils/timeZone';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

function runTests() {
  console.log('--- Starting Attendance Business Day Boundary Tests (Asia/Karachi, 6:00 AM - 6:00 AM) ---\n');

  // Test Case 1: 5:59:59 AM PKT belongs to the previous business day
  {
    // 2026-10-28 05:59:59 PKT (UTC+5 is 2026-10-28 00:59:59 UTC)
    const epochMs = new Date('2026-10-28T05:59:59+05:00').getTime();
    const parts = getKarachiTimeParts(epochMs);
    assert(parts.hour === 5 && parts.minute === 59, 'Karachi time parts parsed accurately at 05:59 PKT');

    const calendarDate = getKarachiCalendarDate(epochMs);
    assert(calendarDate === '2026-10-28', 'Calendar date is 2026-10-28');

    const businessDate = getKarachiBusinessDate(epochMs);
    assert(businessDate === '2026-10-27', 'Test 1: 05:59 AM PKT belongs to previous business date 2026-10-27');
  }

  // Test Case 2: 6:00:00 AM PKT belongs to the new business day
  {
    // 2026-10-28 06:00:00 PKT (UTC+5 is 2026-10-28 01:00:00 UTC)
    const epochMs = new Date('2026-10-28T06:00:00+05:00').getTime();
    const parts = getKarachiTimeParts(epochMs);
    assert(parts.hour === 6 && parts.minute === 0, 'Karachi time parts parsed accurately at 06:00 PKT');

    const businessDate = getKarachiBusinessDate(epochMs);
    assert(businessDate === '2026-10-28', 'Test 2: 06:00 AM PKT belongs to current business date 2026-10-28');

    const range = getBusinessDayRange('2026-10-28');
    assert(range.startMs === epochMs, 'Business day window start is exactly 2026-10-28 06:00:00 PKT');
    assert(isTimestampInBusinessDay(epochMs, '2026-10-28'), '06:00:00 PKT is in business day 2026-10-28');
    assert(!isTimestampInBusinessDay(epochMs - 1, '2026-10-28'), '05:59:59.999 PKT is NOT in business day 2026-10-28');
  }

  // Test Case 3: Shift crossing midnight but ending before 6:00 AM belongs entirely to previous business day
  {
    // Clock-in: 2026-10-28 22:00:00 PKT
    // Clock-out: 2026-10-29 04:00:00 PKT
    // Total shift: 6 hours (21,600s)
    const clockInMs = new Date('2026-10-28T22:00:00+05:00').getTime();
    const clockOutMs = new Date('2026-10-29T04:00:00+05:00').getTime();

    const assignedBusinessDate = getKarachiBusinessDate(clockInMs);
    assert(assignedBusinessDate === '2026-10-28', 'Test 3a: Shift clocked in at 22:00 PKT is assigned to business date 2026-10-28');

    const session = {
      clockInTimestamp: clockInMs,
      clockOutTimestamp: clockOutMs,
      state: 'Completed',
      date: assignedBusinessDate,
      breaks: [],
    };

    const day28Range = getBusinessDayRange('2026-10-28');
    const day29Range = getBusinessDayRange('2026-10-29');

    const workInDay28 = calculateSessionWorkInWindow(session, day28Range.startMs, day28Range.endMs);
    const workInDay29 = calculateSessionWorkInWindow(session, day29Range.startMs, day29Range.endMs);

    assert(workInDay28.netWorkingSeconds === 6 * 3600, 'Test 3b: Entire 6 hours attributed to 2026-10-28 business window');
    assert(workInDay29.netWorkingSeconds === 0, 'Test 3c: 0 hours attributed to 2026-10-29 business window');
  }

  // Test Case 4: Shift crossing 6:00 AM splits correctly between business days without modifying original record
  {
    // Clock-in: 2026-10-28 22:00:00 PKT
    // Clock-out: 2026-10-29 09:00:00 PKT
    // Total duration: 11 hours (39,600s). 8 hours before 06:00 AM, 3 hours after 06:00 AM.
    const clockInMs = new Date('2026-10-28T22:00:00+05:00').getTime();
    const clockOutMs = new Date('2026-10-29T09:00:00+05:00').getTime();

    const session = {
      clockInTimestamp: clockInMs,
      clockOutTimestamp: clockOutMs,
      state: 'Completed',
      date: '2026-10-28',
      breaks: [],
    };

    const day28Range = getBusinessDayRange('2026-10-28');
    const day29Range = getBusinessDayRange('2026-10-29');

    const workInDay28 = calculateSessionWorkInWindow(session, day28Range.startMs, day28Range.endMs);
    const workInDay29 = calculateSessionWorkInWindow(session, day29Range.startMs, day29Range.endMs);

    assert(workInDay28.netWorkingSeconds === 8 * 3600, 'Test 4a: 8 hours (22:00 to 06:00) assigned to 2026-10-28 business day');
    assert(workInDay29.netWorkingSeconds === 3 * 3600, 'Test 4b: 3 hours (06:00 to 09:00) assigned to 2026-10-29 business day');
    assert(
      workInDay28.netWorkingSeconds + workInDay29.netWorkingSeconds === 11 * 3600,
      'Test 4c: Sum of split work matches total 11 hours exactly'
    );
  }

  // Test Case 5: Breaks crossing 6:00 AM boundary split correctly between business days
  {
    // Shift: 2026-10-28 22:00:00 PKT to 2026-10-29 09:00:00 PKT (11h total)
    // Break: 2026-10-29 05:30:00 PKT to 2026-10-29 06:30:00 PKT (1 hour total break)
    // 30 min break in day 2026-10-28 (05:30 to 06:00), 30 min break in day 2026-10-29 (06:00 to 06:30)
    const clockInMs = new Date('2026-10-28T22:00:00+05:00').getTime();
    const clockOutMs = new Date('2026-10-29T09:00:00+05:00').getTime();
    const breakStartMs = new Date('2026-10-29T05:30:00+05:00').getTime();
    const breakEndMs = new Date('2026-10-29T06:30:00+05:00').getTime();

    const session = {
      clockInTimestamp: clockInMs,
      clockOutTimestamp: clockOutMs,
      state: 'Completed',
      date: '2026-10-28',
      breaks: [
        {
          startTime: breakStartMs,
          endTime: breakEndMs,
          durationSeconds: 3600,
        },
      ],
    };

    const day28Range = getBusinessDayRange('2026-10-28');
    const day29Range = getBusinessDayRange('2026-10-29');

    const workInDay28 = calculateSessionWorkInWindow(session, day28Range.startMs, day28Range.endMs);
    const workInDay29 = calculateSessionWorkInWindow(session, day29Range.startMs, day29Range.endMs);

    assert(workInDay28.totalBreakSeconds === 1800, 'Test 5a: 30 minutes of break attributed to 2026-10-28 business window');
    assert(workInDay29.totalBreakSeconds === 1800, 'Test 5b: 30 minutes of break attributed to 2026-10-29 business window');

    // Day 28 net work: 8h elapsed - 30m break = 7.5h (27,000s)
    assert(workInDay28.netWorkingSeconds === 7.5 * 3600, 'Test 5c: 7.5h net work in 2026-10-28 window');

    // Day 29 net work: 3h elapsed - 30m break = 2.5h (9,000s)
    assert(workInDay29.netWorkingSeconds === 2.5 * 3600, 'Test 5d: 2.5h net work in 2026-10-29 window');

    assert(
      workInDay28.netWorkingSeconds + workInDay29.netWorkingSeconds === 10 * 3600,
      'Test 5e: Net total working time across days matches 10 hours exactly (11h shift - 1h break)'
    );
  }

  // Test Case 6: Active shift crossing 6:00 AM continues ticking accurately
  {
    // Employee clocked in at 2026-10-28 23:00:00 PKT
    // Current time is 2026-10-29 07:30:00 PKT (8.5h elapsed)
    const clockInMs = new Date('2026-10-28T23:00:00+05:00').getTime();
    const simulatedNowMs = new Date('2026-10-29T07:30:00+05:00').getTime();

    const activeSession = {
      clockInTimestamp: clockInMs,
      state: 'Working',
      isActive: true,
      date: '2026-10-28',
      breaks: [],
    };

    const day28Range = getBusinessDayRange('2026-10-28');
    const day29Range = getBusinessDayRange('2026-10-29');

    const workInDay28 = calculateSessionWorkInWindow(activeSession, day28Range.startMs, day28Range.endMs, simulatedNowMs);
    const workInDay29 = calculateSessionWorkInWindow(activeSession, day29Range.startMs, day29Range.endMs, simulatedNowMs);

    assert(workInDay28.netWorkingSeconds === 7 * 3600, 'Test 6a: Active shift: 7 hours (23:00 to 06:00) attributed to 2026-10-28');
    assert(workInDay29.netWorkingSeconds === 1.5 * 3600, 'Test 6b: Active shift: 1.5 hours (06:00 to 07:30) attributed to 2026-10-29');
    assert(
      workInDay28.netWorkingSeconds + workInDay29.netWorkingSeconds === 8.5 * 3600,
      'Test 6c: Active shift: Live sum equals 8.5 hours elapsed at 07:30 PKT without reset'
    );
  }

  console.log('\n🌟 All 6 Attendance Business Day Boundary Test Scenarios Passed Successfully! 🌟');
}

runTests();
