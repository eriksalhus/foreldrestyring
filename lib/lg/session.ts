import { EventEmitter } from 'node:events';
import type { Connection } from '../drivers/types.ts';

/** The part of the lgtv2 client (SSAP over wss) that the app uses. */
export interface LgClientLike {
  on(event: 'connecting' | 'prompt' | 'connect' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  /** Every frame the TV sends, as text. */
  on(event: 'message', listener: (text: string) => void): unknown;
  request(uri: string, payload?: object): unknown;
  subscribePowerState(callback: (err: Error | null, result?: { state: string }) => void): string;
  unsubscribe(id: string): void;
  disconnect(): unknown;
  wake(mac?: string): unknown;
}

export interface LgClientOptions {
  host: string;
  mac: string | undefined;
  clientKey: string | undefined;
  saveKey(key: string, callback: (err?: Error) => void): void;
  learnMac: boolean;
  reconnect: number;
}

/** States in which the TV counts as on: the picture may be off, but the TV is not in standby. */
const ON_STATES = new Set(['on', 'screen_off', 'screen_saver']);

/** How many of the TV's latest frames are kept to explain a request that got no answer, and how long each may be. */
const FRAMES_KEPT = 8;
const FRAME_MAX = 300;

/** A frame for the log: cut short, and without the pairing key, which is a credential. */
function frameForLog(text: string): string {
  return text.replace(/("client-key"\s*:\s*")[^"]*(")/g, '$1***$2').slice(0, FRAME_MAX);
}

export interface LgSessionOptions {
  host: string;
  /** Needed only for `wake()`. */
  mac?: string;
  /** The pairing key saved earlier (a string), or anything else for none. */
  credentials: unknown;
  /** Called with the pairing key when the user has pressed "Allow" on the TV. */
  saveCredentials(credentials: unknown): void;
  log(...args: unknown[]): void;
  /** Follow the TV's power state and emit `power`. Default true; both the direct driver and the message link do. */
  followPower?: boolean;
  /** Makes the lgtv2 client. Tests pass a fake; the default connects for real. */
  createClient?: (options: LgClientOptions) => Promise<LgClientLike>;
  /** How long to wait for the TV to answer a toast before showing an alert instead. A working TV answers within milliseconds. */
  toastWaitMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

/** The TV answers a toast within milliseconds when it accepts it, so two seconds of silence means it is ignoring it. */
const TOAST_WAIT_MS = 2000;
/** A TV that ignored a toast is asked again after this long, in case its firmware or state is different by then. */
const TOAST_RETRY_MS = 60 * 60 * 1000;

async function createLgtv2Client(options: LgClientOptions): Promise<LgClientLike> {
  const { default: LG } = await import('lgtv2');
  return new LG(options) as unknown as LgClientLike;
}

/**
 * One SSAP link to one LG webOS TV, shared by everything that talks to LG: the direct TV driver (power state,
 * turn off, wake, messages) and the LG message provider (messages only). It connects and keeps reconnecting by
 * itself. Events: `connection` (a `Connection`) and `power` (true while the TV is on).
 */
export class LgSession extends EventEmitter {
  connection: Connection = 'connecting';

  private lg: LgClientLike | null = null;
  private powerSubscription: string | undefined;
  private readonly recentFrames: string[] = [];
  /** When the TV last ignored a toast, or null while toasts work. */
  private toastIgnoredAt: number | null = null;
  private readonly options: LgSessionOptions;

  constructor(options: LgSessionOptions) {
    super();
    this.options = options;
  }

  async start(): Promise<void> {
    const { host, mac, credentials, saveCredentials, log, createClient = createLgtv2Client } = this.options;
    const lg = await createClient({
      host,
      mac: mac || undefined,
      clientKey: typeof credentials === 'string' && credentials ? credentials : undefined,
      saveKey: (key, callback) => {
        saveCredentials(key);
        callback();
      },
      learnMac: false,
      reconnect: 5000,
    });
    this.lg = lg;

    lg.on('connecting', () => {
      // "connecting" must not hide the Allow prompt while the TV waits for the user.
      if (this.connection !== 'prompt') this.setConnection('connecting');
    });
    lg.on('prompt', () => this.setConnection('prompt'));
    lg.on('connect', () => {
      this.setConnection('connected');
      if (this.options.followPower === false) return;
      if (this.powerSubscription) lg.unsubscribe(this.powerSubscription);
      this.powerSubscription = lg.subscribePowerState((err, result) => {
        if (err || !result) return;
        this.emit('power', ON_STATES.has(result.state));
      });
    });
    lg.on('close', () => this.setConnection('offline'));
    lg.on('error', (err) => log('TV error:', err.message));
    lg.on('message', (text) => {
      this.recentFrames.push(frameForLog(text));
      if (this.recentFrames.length > FRAMES_KEPT) this.recentFrames.shift();
    });
  }

  async stop(): Promise<void> {
    const lg = this.lg;
    this.lg = null;
    this.setConnection('offline');
    await lg?.disconnect();
  }

  /**
   * Shows a short message on the TV: as a toast, which fades by itself. Some TVs (LG keeps toasts for system apps on
   * newer webOS) register, answer every other request and silently ignore the toast. Such a TV gets an alert instead,
   * a dialog with an OK button that stays until someone presses OK, because the TV cannot close it from here.
   * After one ignored toast the session goes straight to alerts, and tries a toast again after an hour.
   */
  async toast(message: string): Promise<void> {
    const lg = this.lg;
    if (!lg) return;
    const now = (this.options.now ?? Date.now)();
    const ignoring = this.toastIgnoredAt !== null && now - this.toastIgnoredAt < TOAST_RETRY_MS;
    if (!ignoring) {
      if (await this.tryToast(lg, message)) {
        this.toastIgnoredAt = null;
        return;
      }
      if (this.toastIgnoredAt === null) {
        this.options.log('The TV did not answer createToast, so messages are shown as alerts (an alert stays until OK is pressed)');
      }
      this.toastIgnoredAt = now;
    }
    try {
      await lg.request('ssap://system.notifications/createAlert', { message, buttons: [{ label: 'OK' }] });
    } catch (err) {
      // The TV's latest frames show what it does answer when it stays silent.
      this.options.log(
        'SSAP message failed:',
        err instanceof Error ? err.message : err,
        '| last frames from the TV:',
        this.recentFrames.join(' | ') || 'none',
      );
      throw err;
    }
  }

  /** True when the TV answered the toast in time. A silence or an error means it is not shown. */
  private async tryToast(lg: LgClientLike, message: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const silence = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('no answer')), this.options.toastWaitMs ?? TOAST_WAIT_MS);
      });
      await Promise.race([Promise.resolve(lg.request('ssap://system.notifications/createToast', { message })), silence]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async turnOff(): Promise<void> {
    await this.lg?.request('ssap://system/turnOff');
  }

  async wake(): Promise<void> {
    await this.lg?.wake(this.options.mac || undefined);
  }

  private setConnection(connection: Connection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    this.emit('connection', connection);
  }
}
