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
import { MessageIgnoredError } from './drivers/types.ts';
import type { Connection, TvConnection, TvDevices, TvDriver } from './drivers/types.ts';
import { MESSAGE_PROVIDERS, describeMessageProvider, getMessageProvider } from './messages/index.ts';
import type { MessageProviderDescription } from './messages/index.ts';
import type { MessageChannel, MessageProvider } from './messages/types.ts';

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
  /** The values of the driver's fields (IP address and the like). */
  driverConfig: Record<string, string>;
  weekdayMinutes: number;
  weekendMinutes: number;
  weekStartDay: number;
  /** When a Quota day begins and the Quota resets, "HH:MM". */
  dayStartTime: string;
  /** Turn Child mode off when a new Quota day begins. */
  autoOffAtRollover: boolean;
  /** Turn Child mode on automatically every day. */
  autoOnEnabled: boolean;
  /** When Child mode is turned on, "HH:MM". */
  autoOnTime: string;
  /** On-screen messages. Only `enabled` and `config` come from the settings page; the rest is owned by the app. */
  messages: MessageSettings;
}

export interface MessageSettings {
  /** Show On-screen messages. On by default, and a Parent can switch it off. */
  enabled: boolean;
  /** Id of the message provider that fits the Connected TV, or an empty string when none does. Set by the app. */
  provider: string;
  /** The values of the provider's fields (the TV's IP address). */
  config: Record<string, string>;
  /** The TV has been linked: the user approved the app on it once. Set by the app after the first connection. */
  linked: boolean;
}

/** What the settings page sends: `provider` and `linked` are decided by the app, never by the page. */
export type TvSettingsInput = Omit<TvSettings, 'messages'> & {
  messages?: { enabled?: boolean; config?: Record<string, string> };
};

export interface MessagesStatus {
  /**
   * `direct`: the TV shows messages itself, so only the switch is offered.
   * `provider`: a message provider fits the chosen Homey TV, so the IP field, Link and the switch are offered.
   * `unsupported`: a Homey TV is chosen but no provider fits it (see `appId`), so only a note is shown.
   * `none`: no TV is chosen.
   */
  mode: 'none' | 'direct' | 'provider' | 'unsupported';
  enabled: boolean;
  linked: boolean;
  /** The state of the message provider's link to the TV, or `off` when none is running. */
  connection: Connection | 'off';
  provider: MessageProviderDescription | null;
  config: Record<string, string>;
  /** Values the Homey device already knows (the TV's IP address), to prefill the fields with. */
  suggested: Record<string, string>;
  /** The Homey app the TV comes from when `mode` is `unsupported`, otherwise an empty string. */
  appId: string;
}

/** A TV in Homey, as the settings page lists it. */
export interface TvDeviceOption {
  id: string;
  name: string;
  zone: string;
}

export interface Status {
  configured: boolean;
  connection: Connection | 'unconfigured';
  /** The chosen Homey device does not exist in Homey any more. Always false for a Direct connection. */
  tvMissing: boolean;
  tvOn: boolean;
  childMode: boolean;
  locked: boolean;
  quotaMinutes: number;
  extraMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  weekUsedMinutes: number;
  messages: MessagesStatus;
  settings: TvSettings;
}

const TICK_MS = 5_000;
const SAVE_MS = 30_000;
const ENFORCE_MIN_INTERVAL_MS = 10_000;
const WELCOME_DELAY_MS = 8_000;
const TURN_OFF_DELAY_MS = 3_000;
/** How often the app asks Homey again which message provider fits the chosen TV. */
const RESOLVE_MS = 30_000;

const minutes = (ms: number) => Math.round(ms / 60_000);

/** Settings from before TV drivers had `host` and `mac` at the top level, and were always LG. */
export function migrateSavedSettings(saved: any): Partial<TvSettings> {
  if (!saved || typeof saved !== 'object') return {};
  const { host, mac, ...rest } = saved;
  if (rest.driver || (host === undefined && mac === undefined)) return rest;
  return { ...rest, driver: 'lg-webos', driverConfig: { host: String(host ?? ''), mac: String(mac ?? '') } };
}

/** "HH:MM" → minutes after midnight. Invalid text gives `fallback`. */
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
    messages: { enabled: true, provider: '', config: {}, linked: false },
  };
  private state: QuotaState = emptyState();
  private tv: TvConnection | null = null;
  private messageChannel: MessageChannel | null = null;
  private lastTargetLog = '';
  /** The app of the chosen Homey TV when no provider fits it, so the settings page can say why. */
  private unsupportedAppId: string | null = null;
  /** What Homey says about the chosen TV: which provider fits it, and what the device already knows. */
  private target: { provider: MessageProvider; suggested: Record<string, string> } | null = null;
  private timers: unknown[] = [];
  private lastEnforceMs = 0;

  private readonly host: Host;
  private readonly drivers: readonly TvDriver[];
  private readonly devices: TvDevices | undefined;
  private readonly providers: readonly MessageProvider[];

  /**
   * `devices` is the app's access to the TVs in Homey. Without it only Direct connections work.
   * `providers` are the message providers that can show On-screen messages for a Homey TV.
   */
  constructor(
    host: Host,
    drivers: readonly TvDriver[] = DRIVERS,
    devices?: TvDevices,
    providers: readonly MessageProvider[] = MESSAGE_PROVIDERS,
  ) {
    this.host = host;
    this.drivers = drivers;
    this.devices = devices;
    this.providers = providers;
  }

  async start(): Promise<void> {
    const saved = this.host.settings.get('tvSettings');
    if (saved) this.applySettings(migrateSavedSettings(saved));
    const timeZone = this.host.clock.getTimezone();
    if (timeZone) this.config.timeZone = timeZone;
    this.state = { ...emptyState(), ...(this.host.settings.get('state') ?? {}) };
    this.state.lastOnObservedMs = null;
    const now = Date.now();
    if (applyDayRolloverOff(this.state, now, this.config)) this.host.log('Child mode turned off at new Quota day (while the app was down)');
    if (applyAutoOn(this.state, now, this.config)) this.host.log('Child mode turned on automatically (while the app was down)');
    this.timers.push(this.host.setInterval(() => this.onTick(), TICK_MS));
    this.timers.push(this.host.setInterval(() => this.save(), SAVE_MS));
    this.timers.push(this.host.setInterval(() => void this.refreshMessages(), RESOLVE_MS));
    await this.connect();
    await this.resolveMessageTarget();
    await this.syncMessages();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) this.host.clearInterval(t);
    this.timers = [];
    this.save();
    await this.stopMessageChannel();
    await this.tv?.stop();
    this.tv = null;
  }

  async configure(input: TvSettingsInput): Promise<void> {
    const driver = getDriver(input.driver, this.drivers) ?? this.currentDriver();
    const { messages: incoming, ...rest } = input;
    const driverConfig = sanitizeConfig(driver, rest.driverConfig);
    const tvChanged =
      driver.id !== this.settings.driver ||
      JSON.stringify(driverConfig) !== JSON.stringify(this.settings.driverConfig);
    const messages = this.nextMessages(incoming, tvChanged);
    const messagesChanged = JSON.stringify(messages) !== JSON.stringify(this.settings.messages);
    const settings: TvSettings = { ...rest, driver: driver.id, driverConfig, messages };
    const dayStartChanged = settings.dayStartTime !== this.settings.dayStartTime;
    const autoOnChanged =
      settings.autoOnEnabled !== this.settings.autoOnEnabled || settings.autoOnTime !== this.settings.autoOnTime;
    this.applySettings(settings);
    // A new start time for the Quota day must not count as a rollover that turns Child mode off.
    if (dayStartChanged) this.state.lastDayKey = dayKey(Date.now(), this.config);
    if (autoOnChanged) rearmAutoOn(this.state, Date.now(), this.config);
    if (dayStartChanged || autoOnChanged) this.save();
    this.host.settings.set('tvSettings', this.settings);
    if (tvChanged) {
      await this.connect();
      await this.resolveMessageTarget();
      await this.syncMessages();
    } else if (messagesChanged) {
      await this.syncMessages();
    }
  }

  getStatus(now = Date.now()): Status {
    const quota = quotaMs(dayKey(now, this.config), this.config);
    return {
      configured: this.isTvConfigured(),
      connection: this.tv?.connection ?? 'unconfigured',
      tvMissing: Boolean(this.tv?.missing),
      tvOn: this.tv?.isOn ?? false,
      childMode: this.state.childMode,
      locked: isLocked(this.state, now, this.config),
      quotaMinutes: minutes(quota),
      extraMinutes: minutes(extraMs(this.state, now, this.config)),
      usedMinutes: minutes(usedMs(this.state, now, this.config)),
      remainingMinutes: Math.max(0, minutes(remainingMs(this.state, now, this.config))),
      weekUsedMinutes: minutes(weekUsedMs(this.state, now, this.config)),
      messages: this.messagesStatus(),
      settings: this.settings,
    };
  }

  setChildMode(on: boolean): Status {
    const changed = this.state.childMode !== on;
    setChildMode(this.state, on);
    this.save();
    this.enforce();
    if (changed) this.announceChildMode();
    return this.getStatus();
  }

  addExtraTime(extraMinutes: number): Status {
    addExtra(this.state, extraMinutes, Date.now(), this.config);
    this.save();
    return this.getStatus();
  }

  /** Removes minutes from today's Quota. When nothing is left, "time is up" is shown and the TV is turned off. */
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

  /**
   * The Link step: starts the connection to the TV so the user can press "Allow" on it. Nothing contacts the TV
   * before this. The TV counts as linked once it has connected (see `onMessageConnection`).
   */
  async linkMessages(config?: Record<string, string>): Promise<Status> {
    const provider = this.currentProvider();
    if (!provider || this.currentDriver().canToast) throw new Error(this.host.__('error.cannotLink'));
    const current = this.settings.messages;
    const next = sanitizeConfig(provider, config ?? current.config);
    if (!isConfigured(provider, next)) throw new Error(this.host.__('error.cannotLink'));
    const changed = JSON.stringify(next) !== JSON.stringify(current.config);
    this.settings = { ...this.settings, messages: { ...current, config: next, linked: changed ? false : current.linked } };
    this.persistSettings();
    await this.syncMessages(true);
    return this.getStatus();
  }

  /**
   * Shows a test message the way real messages are shown, so the user can see that the link works without waiting
   * for the Quota. Throws a message the user can read when it cannot be shown: the TV is off or unreachable, is not
   * linked, or messages are switched off.
   */
  async sendTestMessage(): Promise<void> {
    const text = this.host.__('toast.test');
    const failed = () => new Error(this.host.__('error.testFailed'));
    const tv = this.tv;
    const channel = this.messageChannel;
    const reachable = tv?.toast ? tv.connection === 'connected' : channel?.connection === 'connected';
    if (!this.settings.messages.enabled || !reachable) throw failed();
    try {
      if (tv?.toast) {
        await tv.toast(text);
      } else {
        this.host.log('Showing message:', text);
        await channel!.send(text);
      }
    } catch (err) {
      this.host.error('Test message failed:', err instanceof Error ? err.message : err);
      // A TV that is connected but stays silent gets its own explanation, so it is not mistaken for a broken link.
      if (err instanceof MessageIgnoredError) throw new Error(this.host.__('error.testIgnored'));
      throw failed();
    }
  }

  /** Forgets the link: stops the connection and the stored key. The on/off choice stays. */
  async unlinkMessages(): Promise<Status> {
    const provider = this.currentProvider();
    await this.stopMessageChannel();
    this.settings = { ...this.settings, messages: { ...this.settings.messages, linked: false } };
    // An empty key, not undefined: Homey stores settings as JSON, which drops undefined, and the old key would come back.
    if (provider) this.saveCredentials(provider.id, '');
    this.persistSettings();
    return this.getStatus();
  }

  /** The TV brands the app can control, with the fields the settings page draws, in the user's language. */
  getDrivers(): DriverDescription[] {
    return describeDrivers(this.host.i18n.getLanguage(), this.drivers);
  }

  /** The TVs in Homey that can be chosen as the Connected TV, sorted by name. Empty when Homey cannot be asked. */
  async getTvDevices(): Promise<TvDeviceOption[]> {
    if (!this.devices) return [];
    try {
      const list = await this.devices.list();
      return list
        .map(({ id, name, zone }) => ({ id, name, zone }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      this.host.error('Could not list the TVs in Homey:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** The message settings after the page saved: a new TV starts over, a new IP address needs a new Link. */
  private nextMessages(incoming: TvSettingsInput['messages'], tvChanged: boolean): MessageSettings {
    let messages = this.settings.messages;
    if (tvChanged) messages = { ...messages, provider: '', config: {}, linked: false };
    const provider = getMessageProvider(messages.provider, this.providers);
    if (provider && incoming?.config && !tvChanged) {
      const config = sanitizeConfig(provider, incoming.config);
      if (JSON.stringify(config) !== JSON.stringify(messages.config)) messages = { ...messages, config, linked: false };
    }
    if (typeof incoming?.enabled === 'boolean') messages = { ...messages, enabled: incoming.enabled };
    return messages;
  }

  private currentProvider(): MessageProvider | undefined {
    return this.target?.provider ?? getMessageProvider(this.settings.messages.provider, this.providers);
  }

  private messagesStatus(): MessagesStatus {
    const provider = this.currentProvider();
    const { enabled, linked, config } = this.settings.messages;
    const driver = getDriver(this.settings.driver, this.drivers);
    const mode = driver?.canToast ? 'direct' : provider ? 'provider' : this.unsupportedAppId !== null ? 'unsupported' : 'none';
    return {
      mode,
      enabled,
      linked,
      connection: this.messageChannel?.connection ?? 'off',
      provider: mode === 'provider' && provider ? describeMessageProvider(provider, this.host.i18n.getLanguage()) : null,
      config,
      suggested: mode === 'provider' ? (this.target?.suggested ?? {}) : {},
      appId: mode === 'unsupported' ? (this.unsupportedAppId ?? '') : '',
    };
  }

  /** The Homey device chosen as Connected TV, if the TV driver is a Homey device driver. */
  private chosenDeviceId(): string | null {
    const field = getDriver(this.settings.driver, this.drivers)?.fields.find((f) => f.kind === 'device');
    return (field && this.settings.driverConfig[field.key]) || null;
  }

  /**
   * Asks Homey which message provider fits the chosen TV, by the app that owns the device. Keeps the old answer
   * when Homey cannot be asked. Returns true when the provider the settings point at has changed.
   */
  private async resolveMessageTarget(): Promise<boolean> {
    const id = this.chosenDeviceId();
    if (!id || !this.devices) {
      this.target = null;
      this.unsupportedAppId = null;
      return this.adoptProvider('');
    }
    let info;
    try {
      info = await this.devices.get(id);
    } catch (err) {
      this.host.error('Could not ask Homey about the TV:', err instanceof Error ? err.message : err);
      return false;
    }
    const provider = info ? this.providers.find((p) => p.matches(info)) : undefined;
    this.target = provider && info ? { provider, suggested: provider.suggestConfig(info) } : null;
    this.unsupportedAppId = info && !provider ? info.appId : null;
    this.logTarget(info, provider);
    return this.adoptProvider(provider?.id ?? '');
  }

  /** Says in the log, once per change, why the settings page does or does not offer messages. Setting names only, never values. */
  private logTarget(info: Awaited<ReturnType<TvDevices['get']>>, provider: MessageProvider | undefined): void {
    const line = info
      ? `Connected TV is from app "${info.appId}" (settings: ${Object.keys(info.settings).join(', ') || 'none'}); message provider: ${provider?.id ?? 'none'}`
      : 'Connected TV was not found in Homey';
    if (line === this.lastTargetLog) return;
    this.lastTargetLog = line;
    this.host.log(line);
  }

  /** Remembers which provider fits. A provider that stops fitting takes its IP address and its link with it. */
  private adoptProvider(id: string): boolean {
    const current = this.settings.messages;
    if (current.provider === id) return false;
    const messages = current.provider ? { ...current, provider: id, config: {}, linked: false } : { ...current, provider: id };
    this.settings = { ...this.settings, messages };
    this.persistSettings();
    return true;
  }

  private async refreshMessages(): Promise<void> {
    try {
      if (await this.resolveMessageTarget()) await this.syncMessages();
    } catch (err) {
      this.host.error('Could not refresh the message provider:', err instanceof Error ? err.message : err);
    }
  }

  private async stopMessageChannel(): Promise<void> {
    const channel = this.messageChannel;
    this.messageChannel = null;
    await channel?.stop().catch((err) => this.host.error('Could not stop the message channel:', err.message));
  }

  /**
   * Makes the message channel match the settings: it runs only for a linked TV with messages on (or while the
   * user is linking), never for a TV that shows messages itself, and never before the user has pressed Link.
   */
  private async syncMessages(linking = false): Promise<void> {
    await this.stopMessageChannel();
    const messages = this.settings.messages;
    const provider = getMessageProvider(messages.provider, this.providers);
    if (!provider || this.currentDriver().canToast || !isConfigured(provider, messages.config)) return;
    if (!linking && !(messages.linked && messages.enabled)) {
      this.host.log(`Message channel not started: ${messages.linked ? 'messages are off' : 'the TV is not linked yet'}`);
      return;
    }
    this.host.log(`Message channel starting (${provider.id}, ${linking ? 'linking' : 'linked'})`);
    const channel = provider.createChannel({
      config: messages.config,
      credentials: this.loadCredentials(provider.id),
      saveCredentials: (credentials) => this.saveCredentials(provider.id, credentials),
      log: (...args) => this.host.log(...args),
    });
    this.messageChannel = channel;
    channel.on('connection', (connection) => this.onMessageConnection(channel, connection));
    try {
      await channel.start();
    } catch (err) {
      this.host.error('Could not start the message channel:', err instanceof Error ? err.message : err);
    }
  }

  /** The first connection is the Link: from then on the TV counts as linked, even while it is in standby. */
  private onMessageConnection(channel: MessageChannel, connection: Connection): void {
    if (channel !== this.messageChannel) return;
    this.host.log('Message channel:', connection);
    if (connection !== 'connected' || this.settings.messages.linked) return;
    this.host.log('Message channel connected for the first time: the TV is now linked');
    this.settings = { ...this.settings, messages: { ...this.settings.messages, linked: true } };
    this.persistSettings();
    // Linking with messages switched off: the link is kept, but nothing is shown.
    if (!this.settings.messages.enabled) void this.stopMessageChannel();
  }

  private persistSettings(): void {
    this.host.settings.set('tvSettings', this.settings);
  }

  private applySettings(settings: Partial<TvSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.settings.messages = { ...this.settings.messages, ...settings.messages };
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

  /** Pairing data per driver. LG used to store its key as `clientKey`; it is still read. */
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
      devices: driver.fields.some((f) => f.kind === 'device') ? this.devices : undefined,
    });
    tv.on('power', (on) => this.onPower(on));
    this.tv = tv;
    await tv.start();
  }

  private onTick(): void {
    const tv = this.tv;
    const now = Date.now();
    if (applyDayRolloverOff(this.state, now, this.config)) {
      this.host.log('Child mode turned off at new Quota day');
      this.save();
      this.announceChildMode();
    }
    if (applyAutoOn(this.state, now, this.config)) {
      this.host.log('Child mode turned on automatically');
      this.save();
      this.announceChildMode();
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

  /**
   * Tells whoever is watching that Child mode has just been switched on or off, by a Parent or automatically. Only
   * while the TV is on: a TV that is off cannot show it, and the message is not saved for later. When Child mode is
   * switched on with no time left, `enforce()` shows "time is up" instead, so the screen does not get two messages.
   */
  private announceChildMode(): void {
    if (!this.tv?.isOn) return;
    if (!this.state.childMode) {
      this.say(this.host.__('toast.childModeOff'));
      return;
    }
    const now = Date.now();
    if (isLocked(this.state, now, this.config)) return;
    const left = Math.max(0, minutes(remainingMs(this.state, now, this.config)));
    this.say(this.host.__('toast.childModeOn', { minutes: left }));
  }

  /** Turns the TV off if the Lock is engaged and the TV is on. */
  private enforce(): void {
    const now = Date.now();
    if (!this.tv?.isOn || !isLocked(this.state, now, this.config)) return;
    if (now - this.lastEnforceMs < ENFORCE_MIN_INTERVAL_MS) return;
    this.lastEnforceMs = now;
    this.say(this.host.__('toast.timeUp'));
    this.host.setTimeout(() => {
      if (!isLocked(this.state, Date.now(), this.config)) return;
      this.tv?.turnOff().catch((err) => this.host.error('turnOff failed:', err.message));
    }, TURN_OFF_DELAY_MS);
  }

  /**
   * Shows an On-screen message. A TV that shows messages itself does so; a Homey TV uses its message channel when
   * linked and reachable, and otherwise the message is dropped, never queued: a late "5 minutes left" is wrong.
   * Nothing here may affect counting or the Lock.
   */
  private say(message: string): void {
    if (!this.settings.messages.enabled) {
      this.host.log('Message not shown, messages are switched off:', message);
      return;
    }
    const toast = this.tv?.toast?.bind(this.tv);
    if (toast) {
      toast(message).catch((err) => this.host.error('toast failed:', err.message));
      return;
    }
    const channel = this.messageChannel;
    if (!channel) {
      this.host.log('Message not shown, the TV is not linked (no message channel):', message);
      return;
    }
    if (channel.connection !== 'connected') {
      this.host.log(`Message dropped, the message channel is ${channel.connection}:`, message);
      return;
    }
    this.host.log('Showing message:', message);
    channel.send(message).catch((err) => this.host.error('message failed:', err.message));
  }

  private save(): void {
    this.host.settings.set('state', this.state);
  }
}
