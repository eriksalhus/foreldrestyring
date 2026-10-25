import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_CONFIG,
  addExtra,
  applyDayRolloverOff,
  dayKey,
  emptyState,
  isLocked,
  remainingMs,
  resetDay,
  setChildMode,
  tick,
  usedMs,
  weekUsedMs,
} from '../lib/quota.ts';

const cfg = DEFAULT_CONFIG;
const MIN = 60_000;
// Mandag 2026-10-26 kl. 16:00 norsk tid (CET, UTC+1)
const MON_16 = Date.parse('2026-10-26T15:00:00Z');

/** Kjører tikk hvert 5. sekund i `minutes` minutter med TV-en på. */
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

test('Kvotedøgnet begynner kl. 05:00 lokal tid', () => {
  assert.equal(dayKey(Date.parse('2026-10-26T03:59:00Z'), cfg), '2026-10-25'); // 04:59 lokal
  assert.equal(dayKey(Date.parse('2026-10-26T04:00:00Z'), cfg), '2026-10-26'); // 05:00 lokal
  assert.equal(dayKey(Date.parse('2026-10-26T22:30:00Z'), cfg), '2026-10-26');
});

test('tid telles ikke når Barnemodus er av', () => {
  const s = emptyState();
  watch(s, MON_16, 10);
  assert.equal(usedMs(s, MON_16, cfg), 0);
  assert.equal(isLocked(s, MON_16, cfg), false);
});

test('tid telles i Barnemodus, og Låsen inntrer når Kvoten er brukt opp', () => {
  const s = emptyState();
  setChildMode(s, true);
  const r = watch(s, MON_16, 30);
  assert.equal(r.locked, true);
  assert.equal(remainingMs(s, r.end, cfg), 0);
  assert.deepEqual(r.crossed, [5, 1]);
});

test('hull lengre enn maxGapMs telles ikke (tapt kontakt)', () => {
  const s = emptyState();
  setChildMode(s, true);
  tick(s, MON_16, true, cfg);
  tick(s, MON_16 + 10 * MIN, true, cfg);
  assert.equal(usedMs(s, MON_16, cfg), 0);
});

test('TV av stopper tellingen og starter på nytt ved neste påslag', () => {
  const s = emptyState();
  setChildMode(s, true);
  tick(s, MON_16, true, cfg);
  tick(s, MON_16 + 5_000, false, cfg);
  tick(s, MON_16 + 10_000, true, cfg);
  tick(s, MON_16 + 15_000, true, cfg);
  assert.equal(usedMs(s, MON_16, cfg), 5_000);
});

test('Ekstra tid åpner Låsen og varsler kan krysses på nytt', () => {
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

test('Ekstra tid gjelder bare inneværende Kvotedøgn', () => {
  const s = emptyState();
  setChildMode(s, true);
  addExtra(s, 15, MON_16, cfg);
  assert.equal(remainingMs(s, MON_16 + 24 * 60 * MIN, cfg), 30 * MIN);
});

test('helg har egen Kvote', () => {
  const sat = Date.parse('2026-10-31T11:00:00Z');
  assert.equal(remainingMs(emptyState(), sat, cfg), 60 * MIN);
});

test('ukesummen teller mandag til nå', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 10);
  const wed = MON_16 + 2 * 24 * 60 * MIN;
  watch(s, wed, 5);
  assert.equal(weekUsedMs(s, wed + 5 * MIN, cfg), 15 * MIN);
  const nextMon = MON_16 + 7 * 24 * 60 * MIN;
  assert.equal(weekUsedMs(s, nextMon, cfg), 0);
});

test('nullstilling fjerner brukt tid og Ekstra tid for dagen, men ikke andre dager', () => {
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

test('uka kan begynne på en annen ukedag', () => {
  const s = emptyState();
  setChildMode(s, true);
  watch(s, MON_16, 10); // mandag
  const wed = MON_16 + 2 * 24 * 60 * MIN;
  watch(s, wed, 5); // onsdag
  const sundayWeek = { ...cfg, weekStartDay: 0 };
  assert.equal(weekUsedMs(s, wed, sundayWeek), 15 * MIN); // uke fra søndag: mandag + onsdag
  const wedWeek = { ...cfg, weekStartDay: 3 };
  assert.equal(weekUsedMs(s, wed + 5 * MIN, wedWeek), 5 * MIN); // uke fra onsdag: bare onsdag
});

const MON_0459 = Date.parse('2026-10-26T03:59:00Z'); // 04:59 lokal tid
const MON_0501 = Date.parse('2026-10-26T04:01:00Z'); // 05:01 lokal tid

test('Barnemodus slås av når nytt Kvotedøgn begynner kl. 05:00', () => {
  const s = emptyState();
  setChildMode(s, true);
  assert.equal(applyDayRolloverOff(s, MON_0459, cfg), false);
  assert.equal(s.childMode, true);
  assert.equal(applyDayRolloverOff(s, MON_0501, cfg), true);
  assert.equal(s.childMode, false);
});

test('midnatt påvirker ikke Barnemodus', () => {
  const s = emptyState();
  setChildMode(s, true);
  applyDayRolloverOff(s, MON_16, cfg);
  assert.equal(applyDayRolloverOff(s, Date.parse('2026-10-26T23:30:00Z'), cfg), false); // 00:30 lokal tid
  assert.equal(s.childMode, true);
});

test('Kvotedøgn-skiftet gjør ingenting når Barnemodus allerede er av', () => {
  const s = emptyState();
  applyDayRolloverOff(s, MON_0459, cfg);
  assert.equal(applyDayRolloverOff(s, MON_0501, cfg), false);
  assert.equal(s.childMode, false);
});

test('Barnemodus slått på etter 05:00 blir stående resten av Kvotedøgnet', () => {
  const s = emptyState();
  applyDayRolloverOff(s, MON_0501, cfg);
  setChildMode(s, true);
  assert.equal(applyDayRolloverOff(s, MON_0501 + 10 * 60 * MIN, cfg), false);
  assert.equal(s.childMode, true);
});

test('skiftet som passerte mens appen var nede fanges ved neste sjekk', () => {
  const s = emptyState();
  setChildMode(s, true);
  applyDayRolloverOff(s, MON_16, cfg);
  assert.equal(applyDayRolloverOff(s, MON_16 + 24 * 60 * MIN, cfg), true);
  assert.equal(s.childMode, false);
});
