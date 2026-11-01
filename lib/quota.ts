export interface QuotaConfig {
  weekdayMinutes: number;
  weekendMinutes: number;
  /** When a Quota day begins, in minutes after local midnight. */
  dayStartMinute: number;
  /** The weekday the week starts on: 0 = Sunday, 1 = Monday, … 6 = Saturday. */
  weekStartDay: number;
  /** Turn Child mode off when a new Quota day begins. */
  autoOffAtRollover: boolean;
  /** Turn Child mode on by itself every day. */
  autoOnEnabled: boolean;
  /** When Child mode is turned on, in minutes after local midnight. */
  autoOnMinute: number;
  timeZone: string;
  /** A gap between two observations longer than this does not count as TV time. */
  maxGapMs: number;
}

export const DEFAULT_CONFIG: QuotaConfig = {
  weekdayMinutes: 30,
  weekendMinutes: 60,
  dayStartMinute: 5 * 60,
  weekStartDay: 1,
  autoOffAtRollover: true,
  autoOnEnabled: false,
  autoOnMinute: 15 * 60,
  timeZone: 'Europe/Oslo',
  maxGapMs: 60_000,
};

export interface DayRecord {
  usedMs: number;
  extraMs: number;
}

export interface QuotaState {
  childMode: boolean;
  /** When the TV was last observed on, or null if it was not. */
  lastOnObservedMs: number | null;
  /** The Quota day Child mode was last checked against, to notice when a new one begins. */
  lastDayKey: string | null;
  /** The local date (YYYY-MM-DD) automatic turn-on last ran or was skipped. */
  lastAutoOnDate: string | null;
  /** Key: the start date of the Quota day, YYYY-MM-DD. */
  days: Record<string, DayRecord>;
}

/** Minutes left that trigger a warning on the TV. */
export const WARN_THRESHOLDS_MIN = [5, 1];

const DAY_MS = 86_400_000;
const KEEP_DAYS = 60;

export function emptyState(): QuotaState {
  return { childMode: false, lastOnObservedMs: null, lastDayKey: null, lastAutoOnDate: null, days: {} };
}

function localParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** The Quota day `nowMs` belongs to, as its start date YYYY-MM-DD. */
export function dayKey(nowMs: number, config: QuotaConfig): string {
  const { year, month, day, hour, minute } = localParts(nowMs, config.timeZone);
  let date = Date.UTC(year, month - 1, day);
  if (hour * 60 + minute < config.dayStartMinute) date -= DAY_MS;
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Turns Child mode off when a new Quota day has begun since the last check (at `dayStartMinute`),
 * if `autoOffAtRollover` is on. Also catches the rollover if it passed while the app was down.
 * Returns true if Child mode was turned off.
 */
export function applyDayRolloverOff(state: QuotaState, nowMs: number, config: QuotaConfig): boolean {
  const today = dayKey(nowMs, config);
  const rolledOver = state.lastDayKey !== null && state.lastDayKey !== today;
  state.lastDayKey = today;
  if (!config.autoOffAtRollover || !rolledOver || !state.childMode) return false;
  state.childMode = false;
  return true;
}

/** Local date (YYYY-MM-DD) and minutes after midnight for `nowMs`. */
function localDateAndMinute(nowMs: number, config: QuotaConfig): { date: string; minute: number } {
  const { year, month, day, hour, minute } = localParts(nowMs, config.timeZone);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date, minute: hour * 60 + minute };
}

/**
 * Turns Child mode on the first time `autoOnMinute` has passed each local day, if `autoOnEnabled` is on.
 * A Parent who turns Child mode off again the same day is not overridden. Also catches the time if it
 * passed while the app was down. Returns true if Child mode was turned on.
 */
export function applyAutoOn(state: QuotaState, nowMs: number, config: QuotaConfig): boolean {
  if (!config.autoOnEnabled) return false;
  const { date, minute } = localDateAndMinute(nowMs, config);
  if (minute < config.autoOnMinute || state.lastAutoOnDate === date) return false;
  state.lastAutoOnDate = date;
  if (state.childMode) return false;
  state.childMode = true;
  return true;
}

/**
 * Call when the automatic turn-on settings have changed. If the time has already passed today,
 * today counts as done, so Child mode is not turned on the moment a Parent saves the setting.
 */
export function rearmAutoOn(state: QuotaState, nowMs: number, config: QuotaConfig): void {
  const { date, minute } = localDateAndMinute(nowMs, config);
  state.lastAutoOnDate = minute >= config.autoOnMinute ? date : null;
}

function isWeekend(key: string): boolean {
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export function quotaMs(key: string, config: QuotaConfig): number {
  return (isWeekend(key) ? config.weekendMinutes : config.weekdayMinutes) * 60_000;
}

function dayRecord(state: QuotaState, key: string): DayRecord {
  return (state.days[key] ??= { usedMs: 0, extraMs: 0 });
}

export function usedMs(state: QuotaState, nowMs: number, config: QuotaConfig): number {
  return state.days[dayKey(nowMs, config)]?.usedMs ?? 0;
}

export function extraMs(state: QuotaState, nowMs: number, config: QuotaConfig): number {
  return state.days[dayKey(nowMs, config)]?.extraMs ?? 0;
}

export function remainingMs(state: QuotaState, nowMs: number, config: QuotaConfig): number {
  const key = dayKey(nowMs, config);
  const day = state.days[key];
  return quotaMs(key, config) + (day?.extraMs ?? 0) - (day?.usedMs ?? 0);
}

export function isLocked(state: QuotaState, nowMs: number, config: QuotaConfig): boolean {
  return state.childMode && remainingMs(state, nowMs, config) <= 0;
}

/** TV time used in the week (from `weekStartDay`) that the Quota day `nowMs` belongs to. */
export function weekUsedMs(state: QuotaState, nowMs: number, config: QuotaConfig): number {
  const key = dayKey(nowMs, config);
  const date = new Date(`${key}T00:00:00Z`).getTime();
  const sinceWeekStart = (new Date(date).getUTCDay() - config.weekStartDay + 7) % 7;
  let total = 0;
  for (let i = 0; i <= sinceWeekStart; i++) {
    total += state.days[new Date(date - i * DAY_MS).toISOString().slice(0, 10)]?.usedMs ?? 0;
  }
  return total;
}

export interface TickResult {
  /** Thresholds (minutes left) crossed in this tick. */
  crossed: number[];
  locked: boolean;
}

/**
 * Records an observation of whether the TV is on. Time between two consecutive "on" observations
 * only counts in Child mode, and only if the gap is shorter than `maxGapMs`.
 */
export function tick(state: QuotaState, nowMs: number, tvOn: boolean, config: QuotaConfig): TickResult {
  const before = remainingMs(state, nowMs, config);
  if (state.childMode && tvOn && state.lastOnObservedMs !== null) {
    const gap = nowMs - state.lastOnObservedMs;
    if (gap > 0 && gap <= config.maxGapMs) dayRecord(state, dayKey(nowMs, config)).usedMs += gap;
  }
  state.lastOnObservedMs = tvOn ? nowMs : null;
  const after = remainingMs(state, nowMs, config);
  const crossed =
    state.childMode && tvOn
      ? WARN_THRESHOLDS_MIN.filter((min) => before > min * 60_000 && after <= min * 60_000)
      : [];
  return { crossed, locked: isLocked(state, nowMs, config) };
}

export function setChildMode(state: QuotaState, on: boolean): void {
  state.childMode = on;
}

export function addExtra(state: QuotaState, minutes: number, nowMs: number, config: QuotaConfig): void {
  dayRecord(state, dayKey(nowMs, config)).extraMs += minutes * 60_000;
}

/**
 * Removes `minutes` from today's Quota by making Extra time negative. Never removes more than what is left,
 * so the remainder becomes 0 and the Lock engages, but a later addition starts from 0. Returns the minutes actually removed.
 */
export function reduceTime(state: QuotaState, minutes: number, nowMs: number, config: QuotaConfig): number {
  const cutMs = Math.min(minutes * 60_000, Math.max(0, remainingMs(state, nowMs, config)));
  dayRecord(state, dayKey(nowMs, config)).extraMs -= cutMs;
  return cutMs / 60_000;
}

/** Resets used time and Extra time for the Quota day `nowMs` belongs to. */
export function resetDay(state: QuotaState, nowMs: number, config: QuotaConfig): void {
  delete state.days[dayKey(nowMs, config)];
}

export function prune(state: QuotaState, nowMs: number): void {
  const cutoff = new Date(nowMs - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const key of Object.keys(state.days)) if (key < cutoff) delete state.days[key];
}
