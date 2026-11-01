import {
  DEFAULT_CONFIG,
  QuotaConfig,
  QuotaState,
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
} from './quota';
import { Connection, TvClient } from './tv';

export interface Host {
  settings: { get(key: string): any; set(key: string, value: any): unknown };
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: any): void;
  setTimeout(fn: () => void, ms: number): unknown;
  __(key: string, tokens?: Record<string, string | number>): string;
  clock: { getTimezone(): string };
}

export interface TvSettings {
  host: string;
  mac: string;
  weekdayMinutes: number;
  weekendMinutes: number;
  weekStartDay: number;
  /** Slå av Barnemodus når et nytt Kvotedøgn begynner (kl. 05:00). */
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

/** «HH:MM» → minutter etter midnatt. Ugyldig tekst gir standardtiden. */
function parseTime(time: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : DEFAULT_CONFIG.autoOnMinute;
}

export class Controller {
  private config: QuotaConfig = { ...DEFAULT_CONFIG };
  private settings: TvSettings = {
    host: '',
    mac: '',
    weekdayMinutes: 30,
    weekendMinutes: 60,
    weekStartDay: 1,
    autoOffAtRollover: true,
    autoOnEnabled: false,
    autoOnTime: '15:00',
  };
  private state: QuotaState = emptyState();
  private tv: TvClient | null = null;
  private timers: unknown[] = [];
  private lastEnforceMs = 0;

  constructor(private readonly host: Host) {}

  async start(): Promise<void> {
    const saved = this.host.settings.get('tvSettings');
    if (saved) this.applySettings(saved);
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
    const hostChanged = settings.host !== this.settings.host || settings.mac !== this.settings.mac;
    const autoOnChanged =
      settings.autoOnEnabled !== this.settings.autoOnEnabled || settings.autoOnTime !== this.settings.autoOnTime;
    this.applySettings(settings);
    if (autoOnChanged) {
      rearmAutoOn(this.state, Date.now(), this.config);
      this.save();
    }
    this.host.settings.set('tvSettings', this.settings);
    if (hostChanged) await this.connect();
  }

  getStatus(now = Date.now()): Status {
    const quota = quotaMs(dayKey(now, this.config), this.config);
    return {
      configured: Boolean(this.settings.host),
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
    await this.tv?.wake();
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
      autoOnMinute: parseTime(this.settings.autoOnTime),
    };
  }

  private async connect(): Promise<void> {
    await this.tv?.stop();
    this.tv = null;
    if (!this.settings.host) return;
    const tv = new TvClient({
      host: this.settings.host,
      mac: this.settings.mac,
      clientKey: this.host.settings.get('clientKey') || undefined,
      saveKey: (key) => this.host.settings.set('clientKey', key),
      log: (...args) => this.host.log(...args),
    });
    tv.on('power', (on: boolean) => this.onPower(on));
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
