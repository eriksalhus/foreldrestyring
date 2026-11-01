export interface QuotaConfig {
  weekdayMinutes: number;
  weekendMinutes: number;
  /** Klokkeslettet et Kvotedøgn begynner, i hele timer. */
  resetHour: number;
  /** Ukedagen uka begynner på: 0 = søndag, 1 = mandag, … 6 = lørdag. */
  weekStartDay: number;
  /** Slår Barnemodus av når et nytt Kvotedøgn begynner. */
  autoOffAtRollover: boolean;
  /** Slår Barnemodus på av seg selv hver dag. */
  autoOnEnabled: boolean;
  /** Klokkeslettet Barnemodus slås på, i minutter etter midnatt lokal tid. */
  autoOnMinute: number;
  timeZone: string;
  /** Lengre hull mellom to observasjoner enn dette telles ikke som TV-tid. */
  maxGapMs: number;
}

export const DEFAULT_CONFIG: QuotaConfig = {
  weekdayMinutes: 30,
  weekendMinutes: 60,
  resetHour: 5,
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
  /** Tidspunktet TV-en sist ble observert på, eller null hvis den ikke er det. */
  lastOnObservedMs: number | null;
  /** Kvotedøgnet Barnemodus sist ble sjekket mot, for å se når et nytt begynner. */
  lastDayKey: string | null;
  /** Den lokale datoen (YYYY-MM-DD) automatisk påslåing sist ble utført eller hoppet over. */
  lastAutoOnDate: string | null;
  /** Nøkkel: Kvotedøgnets startdato, YYYY-MM-DD. */
  days: Record<string, DayRecord>;
}

/** Minutter igjen som utløser en varsling på TV-en. */
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

/** Kvotedøgnet `nowMs` tilhører, som startdato YYYY-MM-DD. */
export function dayKey(nowMs: number, config: QuotaConfig): string {
  const { year, month, day, hour } = localParts(nowMs, config.timeZone);
  let date = Date.UTC(year, month - 1, day);
  if (hour < config.resetHour) date -= DAY_MS;
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Slår Barnemodus av når et nytt Kvotedøgn har begynt siden forrige sjekk (kl. 05:00 lokal tid),
 * hvis `autoOffAtRollover` er på. Fanger også skiftet hvis det passerte mens appen var nede.
 * Returnerer true hvis Barnemodus ble slått av.
 */
export function applyDayRolloverOff(state: QuotaState, nowMs: number, config: QuotaConfig): boolean {
  const today = dayKey(nowMs, config);
  const rolledOver = state.lastDayKey !== null && state.lastDayKey !== today;
  state.lastDayKey = today;
  if (!config.autoOffAtRollover || !rolledOver || !state.childMode) return false;
  state.childMode = false;
  return true;
}

/** Lokal dato (YYYY-MM-DD) og minutter etter midnatt for `nowMs`. */
function localDateAndMinute(nowMs: number, config: QuotaConfig): { date: string; minute: number } {
  const { year, month, day, hour, minute } = localParts(nowMs, config.timeZone);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date, minute: hour * 60 + minute };
}

/**
 * Slår Barnemodus på første gang etter at klokkeslettet `autoOnMinute` er passert hver lokale dag, hvis
 * `autoOnEnabled` er på. En Forelder som slår Barnemodus av igjen samme dag blir ikke overstyrt.
 * Fanger også klokkeslettet hvis det passerte mens appen var nede. Returnerer true hvis Barnemodus ble slått på.
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
 * Kalles når innstillingene for automatisk påslåing er endret. Har klokkeslettet allerede passert i dag,
 * regnes i dag som utført, så Barnemodus ikke slås på i det øyeblikket en Forelder lagrer innstillingen.
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

/** TV-tid brukt i uka (fra `weekStartDay`) som Kvotedøgnet `nowMs` tilhører. */
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
  /** Terskler (minutter igjen) som ble krysset i dette tikket. */
  crossed: number[];
  locked: boolean;
}

/**
 * Registrerer en observasjon av om TV-en er på. Tid mellom to påfølgende «på»-observasjoner
 * telles bare i Barnemodus, og bare hvis hullet er kortere enn `maxGapMs`.
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
 * Trekker `minutes` fra dagens Kvote ved å gjøre Ekstra tid negativ. Det trekkes aldri mer enn det som er igjen,
 * så resten blir 0 og Låsen inntrer, men et senere tillegg starter fra 0. Returnerer minuttene som faktisk ble trukket.
 */
export function reduceTime(state: QuotaState, minutes: number, nowMs: number, config: QuotaConfig): number {
  const cutMs = Math.min(minutes * 60_000, Math.max(0, remainingMs(state, nowMs, config)));
  dayRecord(state, dayKey(nowMs, config)).extraMs -= cutMs;
  return cutMs / 60_000;
}

/** Nullstiller brukt tid og Ekstra tid for Kvotedøgnet `nowMs` tilhører. */
export function resetDay(state: QuotaState, nowMs: number, config: QuotaConfig): void {
  delete state.days[dayKey(nowMs, config)];
}

export function prune(state: QuotaState, nowMs: number): void {
  const cutoff = new Date(nowMs - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const key of Object.keys(state.days)) if (key < cutoff) delete state.days[key];
}
