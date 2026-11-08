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

/** Read-only requests that tell whether the TV answers requests at all, used when a toast gets no answer. */
const PROBES = [
  'ssap://system/getSystemInfo',
  'ssap://com.webos.applicationManager/getForegroundAppInfo',
  'ssap://audio/getVolume',
];

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
}

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

  async toast(message: string): Promise<void> {
    try {
      await this.lg?.request('ssap://system.notifications/createToast', { message });
    } catch (err) {
      // The TV's latest frames show what it does answer when it stays silent on this request.
      this.options.log(
        'SSAP createToast failed:',
        err instanceof Error ? err.message : err,
        '| last frames from the TV:',
        this.recentFrames.join(' | ') || 'none',
      );
      void this.probe();
      throw err;
    }
  }

  /**
   * Diagnostic, only after a toast got no answer: asks the TV a few harmless read-only questions and logs which ones
   * it answers. Answers to those but not to the toast point at the toast; answers to none point at requests in general.
   */
  private async probe(): Promise<void> {
    const lg = this.lg;
    if (!lg) return;
    const results = await Promise.allSettled(PROBES.map((uri) => Promise.resolve(lg.request(uri))));
    const line = PROBES.map((uri, i) => {
      const result = results[i];
      const answer = result.status === 'fulfilled' ? JSON.stringify(result.value) : result.reason instanceof Error ? result.reason.message : String(result.reason);
      return `${uri.split('/').pop()}: ${String(answer).slice(0, 120)}`;
    }).join(' | ');
    this.options.log('SSAP probe after the failed toast:', line);
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
