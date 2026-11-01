import {
  DEFAULT_CONFIG,
  addExtra,
  applyAutoOn,
  applyDayRolloverOff,
  dayKey,
  emptyState,
  extraMs,
  isLocked,
  prune,
  reduceTime,
  resetDay,
  quotaMs,
  rearmAutoOn,
  remainingMs,
  setChildMode,
  tick,
  usedMs,
  weekUsedMs,
} from './quota.ts';
import type { QuotaConfig, QuotaState } from './quota.ts';
import { DEFAULT_DRIVER_ID, DRIVERS, describeDrivers, getDriver, isConfigured, sanitizeConfig } from './drivers/index.ts';
import type { DriverDescription } from './drivers/index.ts';
import type { Connection, TvConnection, TvDriver } from './drivers/types.ts';

export type { Connection };

export interface Host {
  settings: { get(key: string): any; set(key: string, value: any): unknown };
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: any): void;
  setTimeout(fn: () => void, ms: number): unknown;
  __(key: string, tokens?: Record<string, string | number>): string;
  clock: { getTimezone(): string };
  i18n: { getLanguage(): string };
}

export interface TvSettings {
  /** Id for the TV driver, e.g. `lg-webos`. */
  driver: string;
  /** Verdiene i driverens felt (IP-adresse og lignende). */
  driverConfig: Record<string, string>;
  weekdayMinutes: number;
  weekendMinutes: number;
  weekStartDay: number;
  /** Klokkeslettet et Kvotedøgn begynner og Kvoten nullstilles, «HH:MM». */
  dayStartTime: string;
  /** Slå av Barnemodus når et nytt Kvotedøgn begynner. */
  autoOffAtRollover: boolean;
  /** Slå på Barnemodus automatisk hver dag. */
  autoOnEnabled: boolean;
  /** Klokkeslettet Barnemodus slås på, «HH:MM». */
  autoOnTime: string;
}

export interface Status {
  configured: boolean;
  connection: Connection | 'unconfigured';
  tvOn: boolean;
  childMode: boolean;
  locked: boolean;
  quotaMinutes: number;
  extraMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  weekUsedMinutes: number;
  settings: TvSettings;
}

const TICK_MS = 5_000;
const SAVE_MS = 30_000;
const ENFORCE_MIN_INTERVAL_MS = 10_000;
const WELCOME_DELAY_MS = 8_000;
const TURN_OFF_DELAY_MS = 3_000;

const minutes = (ms: number) => Math.round(ms / 60_000);

/** Innstillinger fra før TV-driverne kom hadde `host` og `mac` på toppnivå, og alltid LG. */
export function migrateSavedSettings(saved: any): Partial<TvSettings> {
  if (!saved || typeof saved !== 'object') return {};
  const { host, mac, ...rest } = saved;
  if (rest.driver || (host === undefined && mac === undefined)) return rest;
  return { ...rest, driver: 'lg-webos', driverConfig: { host: String(host ?? ''), mac: String(mac ?? '') } };
}

/** «HH:MM» → minutter etter midnatt. Ugyldig tekst gir `fallback`. */
function parseTime(time: string, fallback: number): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

export class Controller {
  private config: QuotaConfig = { ...DEFAULT_CONFIG };
  private settings: TvSettings = {
    driver: DEFAULT_DRIVER_ID,
    driverConfig: {},
    weekdayMinutes: 30,
    weekendMinutes: 60,
    weekStartDay: 1,
    dayStartTime: '05:00',
    autoOffAtRollover: true,
    autoOnEnabled: false,
    autoOnTime: '15:00',
  };
  private state: QuotaState = emptyState();
  private tv: TvConnection | null = null;
  private timers: unknown[] = [];
  private lastEnforceMs = 0;

  private readonly host: Host;
  private readonly drivers: readonly TvDriver[];

  constructor(host: Host, drivers: readonly TvDriver[] = DRIVERS) {
    this.host = host;
    this.drivers = drivers;
  }

  async start(): Promise<void> {
    const saved = this.host.settings.get('tvSettings');
    if (saved) this.applySettings(migrateSavedSettings(saved));
    const timeZone = this.host.clock.getTimezone();
    if (timeZone) this.config.timeZone = timeZone;
    this.state = { ...emptyState(), ...(this.host.settings.get('state') ?? {}) };
    this.state.lastOnObservedMs = null;
    const now = Date.now();
    if (applyDayRolloverOff(this.state, now, this.config)) this.host.log('Barnemodus slått av ved nytt Kvotedøgn (mens appen var nede)');
    if (applyAutoOn(this.state, now, this.config)) this.host.log('Barnemodus slått på automatisk (mens appen var nede)');
    this.timers.push(this.host.setInterval(() => this.onTick(), TICK_MS));
    this.timers.push(this.host.setInterval(() => this.save(), SAVE_MS));
    await this.connect();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) this.host.clearInterval(t);
    this.timers = [];
    this.save();
    await this.tv?.stop();
    this.tv = null;
  }

  async configure(settings: TvSettings): Promise<void> {
    const driver = getDriver(settings.driver, this.drivers) ?? this.currentDriver();
    settings = { ...settings, driver: driver.id, driverConfig: sanitizeConfig(driver, settings.driverConfig) };
    const tvChanged =
      settings.driver !== this.settings.driver ||
      JSON.stringify(settings.driverConfig) !== JSON.stringify(this.settings.driverConfig);
    const dayStartChanged = settings.dayStartTime !== this.settings.dayStartTime;
    const autoOnChanged =
      settings.autoOnEnabled !== this.settings.autoOnEnabled || settings.autoOnTime !== this.settings.autoOnTime;
    this.applySettings(settings);
    // Nytt starttidspunkt for Kvotedøgnet skal ikke telle som et døgnskifte som slår av Barnemodus.
    if (dayStartChanged) this.state.lastDayKey = dayKey(Date.now(), this.config);
    if (autoOnChanged) rearmAutoOn(this.state, Date.now(), this.config);
    if (dayStartChanged || autoOnChanged) this.save();
    this.host.settings.set('tvSettings', this.settings);
    if (tvChanged) await this.connect();
  }

  getStatus(now = Date.now()): Status {
    const quota = quotaMs(dayKey(now, this.config), this.config);
    return {
      configured: this.isTvConfigured(),
      connection: this.tv?.connection ?? 'unconfigured',
      tvOn: this.tv?.isOn ?? false,
      childMode: this.state.childMode,
      locked: isLocked(this.state, now, this.config),
      quotaMinutes: minutes(quota),
      extraMinutes: minutes(extraMs(this.state, now, this.config)),
      usedMinutes: minutes(usedMs(this.state, now, this.config)),
      remainingMinutes: Math.max(0, minutes(remainingMs(this.state, now, this.config))),
      weekUsedMinutes: minutes(weekUsedMs(this.state, now, this.config)),
      settings: this.settings,
    };
  }

  setChildMode(on: boolean): Status {
    setChildMode(this.state, on);
    this.save();
    this.enforce();
    return this.getStatus();
  }

  addExtraTime(extraMinutes: number): Status {
    addExtra(this.state, extraMinutes, Date.now(), this.config);
    this.save();
    return this.getStatus();
  }

  /** Trekker minutter fra dagens Kvote. Når resten blir 0, vises «tiden er brukt opp» og TV-en slås av. */
  reduceTime(reduceMinutes: number): Status {
    reduceTime(this.state, reduceMinutes, Date.now(), this.config);
    this.save();
    this.enforce();
    return this.getStatus();
  }

  resetToday(): Status {
    resetDay(this.state, Date.now(), this.config);
    this.save();
    return this.getStatus();
  }

  async wakeTv(): Promise<void> {
    await this.tv?.wake?.();
  }

  /** TV-merkene appen kan styre, med feltene innstillingssiden skal tegne, på brukerens språk. */
  getDrivers(): DriverDescription[] {
    return describeDrivers(this.host.i18n.getLanguage(), this.drivers);
  }

  private applySettings(settings: Partial<TvSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.config = {
      ...this.config,
      weekdayMinutes: this.settings.weekdayMinutes,
      weekendMinutes: this.settings.weekendMinutes,
      weekStartDay: this.settings.weekStartDay,
      autoOffAtRollover: this.settings.autoOffAtRollover,
      autoOnEnabled: this.settings.autoOnEnabled,
      autoOnMinute: parseTime(this.settings.autoOnTime, DEFAULT_CONFIG.autoOnMinute),
      dayStartMinute: parseTime(this.settings.dayStartTime, DEFAULT_CONFIG.dayStartMinute),
    };
  }

  private currentDriver(): TvDriver {
    return getDriver(this.settings.driver, this.drivers) ?? getDriver(DEFAULT_DRIVER_ID, this.drivers) ?? this.drivers[0];
  }

  private isTvConfigured(): boolean {
    const driver = getDriver(this.settings.driver, this.drivers);
    return Boolean(driver && isConfigured(driver, this.settings.driverConfig));
  }

  /** Paringsdata per driver. LG lagret tidligere nøkkelen som `clientKey`, den leses fortsatt. */
  private loadCredentials(driverId: string): unknown {
    const all = this.host.settings.get('tvCredentials') ?? {};
    if (driverId in all) return all[driverId];
    return driverId === 'lg-webos' ? this.host.settings.get('clientKey') || undefined : undefined;
  }

  private saveCredentials(driverId: string, credentials: unknown): void {
    this.host.settings.set('tvCredentials', { ...(this.host.settings.get('tvCredentials') ?? {}), [driverId]: credentials });
  }

  private async connect(): Promise<void> {
    await this.tv?.stop();
    this.tv = null;
    const driver = getDriver(this.settings.driver, this.drivers);
    if (!driver || !isConfigured(driver, this.settings.driverConfig)) return;
    const tv = driver.createConnection({
      config: this.settings.driverConfig,
      credentials: this.loadCredentials(driver.id),
      saveCredentials: (credentials) => this.saveCredentials(driver.id, credentials),
      log: (...args) => this.host.log(...args),
    });
    tv.on('power', (on) => this.onPower(on));
    this.tv = tv;
    await tv.start();
  }

  private onTick(): void {
    const tv = this.tv;
    const now = Date.now();
    if (applyDayRolloverOff(this.state, now, this.config)) {
      this.host.log('Barnemodus slått av ved nytt Kvotedøgn');
      this.save();
    }
    if (applyAutoOn(this.state, now, this.config)) {
      this.host.log('Barnemodus slått på automatisk');
      this.save();
    }
    const on = Boolean(tv?.isOn && tv.connection === 'connected');
    const { crossed } = tick(this.state, now, on, this.config);
    if (crossed.length) {
      const min = Math.min(...crossed);
      this.say(this.host.__('toast.minutesLeft', { minutes: min }));
    }
    prune(this.state, now);
    this.enforce();
  }

  private onPower(on: boolean): void {
    if (!on) return;
    const now = Date.now();
    this.enforce();
    if (this.state.childMode && !isLocked(this.state, now, this.config)) {
      this.host.setTimeout(() => {
        const left = minutes(remainingMs(this.state, Date.now(), this.config));
        if (this.state.childMode && this.tv?.isOn) this.say(this.host.__('toast.minutesLeft', { minutes: left }));
      }, WELCOME_DELAY_MS);
    }
  }

  /** Slår TV-en av hvis Låsen er aktiv og TV-en er på. */
  private enforce(): void {
    const now = Date.now();
    if (!this.tv?.isOn || !isLocked(this.state, now, this.config)) return;
    if (now - this.lastEnforceMs < ENFORCE_MIN_INTERVAL_MS) return;
    this.lastEnforceMs = now;
    this.say(this.host.__('toast.timeUp'));
    this.host.setTimeout(() => {
      if (!isLocked(this.state, Date.now(), this.config)) return;
      this.tv?.turnOff().catch((err) => this.host.error('turnOff feilet:', err.message));
    }, TURN_OFF_DELAY_MS);
  }

  private say(message: string): void {
    this.tv?.toast(message).catch((err) => this.host.error('toast feilet:', err.message));
  }

  private save(): void {
    this.host.settings.set('state', this.state);
  }
}
