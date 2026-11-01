import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_CONFIG,
  addExtra,
  applyAutoOn,
  applyDayRolloverOff,
  dayKey,
  emptyState,
  isLocked,
  rearmAutoOn,
  reduceTime,
  remainingMs,
  resetDay,
  setChildMode,
  tick,
  usedMs,
  weekUsedMs,
} from '../lib/quota.ts';

const cfg = DEFAULT_CONFIG;
const MIN = 60_000;
// Monday 2026-10-26 at 16:00 Norwegian time (CET, UTC+1)
const MON_16 = Date.parse('2026-10-26T15:00:00Z');

/** Runs a tick every 5 seconds for `minutes` minutes with the TV on. */
function watch(state: ReturnType<typeof emptyState>, from: number, minutes: number) {
  const crossed: number[] = [];
  let locked = false;
  for (let t = from; t <= from + minutes * MIN; t += 5_000) {
    const r = tick(state, t, true, cfg);
    crossed.push(...r.crossed);
    locked = r.locked;
  }
  return { crossed, locked, end: from + minutes * MIN };
}

test('the Quota day begins at 05:00 local time', () => {
  assert.equal(dayKey(Date.parse('2026-10-26T03:59:00Z'), cfg), '2026-10-25'); // 04:59 local
  assert.equal(dayKey(Date.parse('2026-10-26T04:00:00Z'), cfg), '2026-10-26'); // 05:00 local
  assert.equal(dayKey(Date.parse('2026-10-26T22:30:00Z'), cfg), '2026-10-26');
});

test('time is not counted when Child mode is off', () => {
  const s = emptyState();
  watch(s, MON_16, 10);
  assert.equal(usedMs(s, MON_16, cfg), 0);
  assert.equal(isLocked(s, MON_16, cfg), false);
});

test('time is counted in Child mode, and the Lock engages when the Quota is used up', () => {
  const s = emptyState();
  setChildMode(s, true);
  const r = watch(s, MON_16, 30);
  assert.equal(r.locked, true);
  assert.equal(remainingMs(s, r.end, cfg), 0);
  assert.deepEqual(r.crossed, [5, 1]);
});

test('a gap longer than maxGapMs is not counted (lost contact)', () => {
  const s = emptyState();
  setChildMode(s, true);
  tick(s, MON_16, true, cfg);
  tick(s, MON_16 + 10 * MIN, true, cfg);
  assert.equal(usedMs(s, MON_16, cfg), 0);
});

test('TV off stops the counting and it restarts at the next power-on', () => {
  const s = emptyState();
  setChildMode(s, true);
  tick(s, MON_16, true, cfg);
  tick(s, MON_16 + 5_000, false, cfg);
  tick(s, MON_16 + 10_000, true, cfg);
  tick(s, MON_16 + 15_000, true, cfg);
  assert.equal(usedMs(s, MON_16, cfg), 5_000);
});

test('Extra time opens the Lock and warnings can be crossed again', () => {
  const s = emptyState();
  setChildMode(s, true);
  const first = watch(s, MON_16, 30);
  assert.equal(first.locked, true);
  addExtra(s, 15, first.end, cfg);
  assert.equal(isLocked(s, first.end, cfg), false);
  const second = watch(s, first.end + 5_000, 15);
  assert.equal(second.locked, true);
  assert.deepEqual(second.crossed, [5, 1]);
});

test('Extra time only applies to the current Quota day', () => {
  const s = emptyState();
  setChildMode(s, true);
  addExtra(s, 15, MON_16, cfg);
  assert.equal(remainingMs(s, MON_16 + 24 * 60 * MIN, cfg), 30 * MIN);
});

test('weekends have their own Quota', () => {
  const sat = Date.parse('2026-10-31T11:00:00Z');
  assert.equal(remainingMs(emptyState(), sat, cfg), 60 * MIN);
});

test('the weekly total counts from Monday until now', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 10);
  const wed = MON_16 + 2 * 24 * 60 * MIN;
  watch(s, wed, 5);
  assert.equal(weekUsedMs(s, wed + 5 * MIN, cfg), 15 * MIN);
  const nextMon = MON_16 + 7 * 24 * 60 * MIN;
  assert.equal(weekUsedMs(s, nextMon, cfg), 0);
});

test('reset removes used time and Extra time for the day, but not for other days', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 10);
  addExtra(s, 30, MON_16, cfg);
  const tue = MON_16 + 24 * 60 * MIN;
  watch(s, tue, 5);
  resetDay(s, tue, cfg);
  assert.equal(remainingMs(s, tue, cfg), 30 * MIN);
  assert.equal(usedMs(s, MON_16, cfg), 10 * MIN);
  assert.equal(s.childMode, true);
});

test('the week can begin on another weekday', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 10); // Monday
  const wed = MON_16 + 2 * 24 * 60 * MIN;
  watch(s, wed, 5); // Wednesday
  const sundayWeek = { ...cfg, weekStartDay: 0 };
  assert.equal(weekUsedMs(s, wed, sundayWeek), 15 * MIN); // week from Sunday: Monday + Wednesday
  const wedWeek = { ...cfg, weekStartDay: 3 };
  assert.equal(weekUsedMs(s, wed + 5 * MIN, wedWeek), 5 * MIN); // week from Wednesday: Wednesday only
});

const MON_0459 = Date.parse('2026-10-26T03:59:00Z'); // 04:59 local time
const MON_0501 = Date.parse('2026-10-26T04:01:00Z'); // 05:01 local time

test('Child mode is turned off when a new Quota day begins at 05:00', () => {
  const s = emptyState();
  setChildMode(s, true);
  assert.equal(applyDayRolloverOff(s, MON_0459, cfg), false);
  assert.equal(s.childMode, true);
  assert.equal(applyDayRolloverOff(s, MON_0501, cfg), true);
  assert.equal(s.childMode, false);
});

test('midnight does not affect Child mode', () => {
  const s = emptyState();
  setChildMode(s, true);
  applyDayRolloverOff(s, MON_16, cfg);
  assert.equal(applyDayRolloverOff(s, Date.parse('2026-10-26T23:30:00Z'), cfg), false); // 00:30 local time
  assert.equal(s.childMode, true);
});

test('the Quota day rollover does nothing when Child mode is already off', () => {
  const s = emptyState();
  applyDayRolloverOff(s, MON_0459, cfg);
  assert.equal(applyDayRolloverOff(s, MON_0501, cfg), false);
  assert.equal(s.childMode, false);
});

test('Child mode turned on after 05:00 stays on for the rest of the Quota day', () => {
  const s = emptyState();
  applyDayRolloverOff(s, MON_0501, cfg);
  setChildMode(s, true);
  assert.equal(applyDayRolloverOff(s, MON_0501 + 10 * 60 * MIN, cfg), false);
  assert.equal(s.childMode, true);
});

test('a rollover that passed while the app was down is caught at the next check', () => {
  const s = emptyState();
  setChildMode(s, true);
  applyDayRolloverOff(s, MON_16, cfg);
  assert.equal(applyDayRolloverOff(s, MON_16 + 24 * 60 * MIN, cfg), true);
  assert.equal(s.childMode, false);
});

test('Remove time reduces what is left', () => {
  const s = emptyState();
  setChildMode(s, true);
  assert.equal(reduceTime(s, 10, MON_16, cfg), 10);
  assert.equal(remainingMs(s, MON_16, cfg), 20 * MIN);
  assert.equal(isLocked(s, MON_16, cfg), false);
});

test('Remove time down to 0 engages the Lock', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 5);
  reduceTime(s, 25, MON_16 + 5 * MIN, cfg);
  assert.equal(remainingMs(s, MON_16 + 5 * MIN, cfg), 0);
  assert.equal(isLocked(s, MON_16 + 5 * MIN, cfg), true);
});

test('Remove time never goes below 0, so Extra time afterwards gives the right time', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 20); // 10 min left
  const now = MON_16 + 20 * MIN;
  assert.equal(reduceTime(s, 30, now, cfg), 10);
  assert.equal(remainingMs(s, now, cfg), 0);
  assert.equal(reduceTime(s, 15, now, cfg), 0);
  addExtra(s, 10, now, cfg);
  assert.equal(remainingMs(s, now, cfg), 10 * MIN);
  assert.equal(isLocked(s, now, cfg), false);
});

test('Remove time only applies to the current Quota day', () => {
  const s = emptyState();
  setChildMode(s, true);
  reduceTime(s, 10, MON_16, cfg);
  assert.equal(remainingMs(s, MON_16 + 24 * 60 * MIN, cfg), 30 * MIN);
});

test('Child mode stays on across the Quota day rollover when automatic turn-off is disabled', () => {
  const noReset = { ...cfg, autoOffAtRollover: false };
  const s = emptyState();
  setChildMode(s, true);
  applyDayRolloverOff(s, Date.parse('2026-10-26T20:00:00Z'), noReset);
  assert.equal(applyDayRolloverOff(s, Date.parse('2026-10-27T05:00:00Z'), noReset), false);
  assert.equal(s.childMode, true);
});

const autoOn = { ...cfg, autoOnEnabled: true, autoOnMinute: 16 * 60 }; // at 16:00
// Monday 2026-10-26 (CET, UTC+1): 15:59 and 16:00 local time
const MON_1559 = Date.parse('2026-10-26T14:59:00Z');
const MON_1600 = Date.parse('2026-10-26T15:00:00Z');

test('Child mode is turned on automatically at the chosen time', () => {
  const s = emptyState();
  assert.equal(applyAutoOn(s, MON_1559, autoOn), false);
  assert.equal(s.childMode, false);
  assert.equal(applyAutoOn(s, MON_1600, autoOn), true);
  assert.equal(s.childMode, true);
});

test('automatic turn-on does nothing when it is disabled', () => {
  const s = emptyState();
  assert.equal(applyAutoOn(s, MON_1600, cfg), false);
  assert.equal(s.childMode, false);
});

test('a Parent who turns Child mode off after automatic turn-on is not overridden the same day', () => {
  const s = emptyState();
  applyAutoOn(s, MON_1600, autoOn);
  setChildMode(s, false);
  assert.equal(applyAutoOn(s, MON_1600 + 60 * MIN, autoOn), false);
  assert.equal(s.childMode, false);
  // The next day it is turned on again
  assert.equal(applyAutoOn(s, MON_1600 + 24 * 60 * MIN, autoOn), true);
});

test('automatic turn-on catches a time that passed while the app was down', () => {
  const s = emptyState();
  assert.equal(applyAutoOn(s, MON_1600 + 3 * 60 * MIN, autoOn), true);
});

test('saving after the time has passed does not turn Child mode on until the next day', () => {
  const s = emptyState();
  const evening = MON_1600 + 2 * 60 * MIN;
  rearmAutoOn(s, evening, autoOn);
  assert.equal(applyAutoOn(s, evening, autoOn), false);
  assert.equal(applyAutoOn(s, MON_1600 + 24 * 60 * MIN, autoOn), true);
});

test('saving before the time has passed turns Child mode on at that time today', () => {
  const s = emptyState();
  rearmAutoOn(s, MON_1559, autoOn);
  assert.equal(applyAutoOn(s, MON_1600, autoOn), true);
});

test('the Quota day can begin at another time, also with minutes', () => {
  const late = { ...cfg, dayStartMinute: 7 * 60 + 30 }; // at 07:30
  assert.equal(dayKey(Date.parse('2026-10-26T06:29:00Z'), late), '2026-10-25'); // 07:29 local
  assert.equal(dayKey(Date.parse('2026-10-26T06:30:00Z'), late), '2026-10-26'); // 07:30 local
  const early = { ...cfg, dayStartMinute: 0 }; // midnight
  assert.equal(dayKey(Date.parse('2026-10-25T23:00:00Z'), early), '2026-10-26'); // 00:00 local
});

test('Child mode is turned off at the chosen start time of the Quota day', () => {
  const late = { ...cfg, dayStartMinute: 7 * 60 };
  const s = emptyState();
  setChildMode(s, true);
  applyDayRolloverOff(s, Date.parse('2026-10-26T05:00:00Z'), late); // 06:00 local, still yesterday
  assert.equal(applyDayRolloverOff(s, Date.parse('2026-10-26T05:59:00Z'), late), false); // 06:59 local
  assert.equal(s.childMode, true);
  assert.equal(applyDayRolloverOff(s, Date.parse('2026-10-26T06:00:00Z'), late), true); // 07:00 local
  assert.equal(s.childMode, false);
});
