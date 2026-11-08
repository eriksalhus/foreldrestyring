import { EventEmitter } from 'node:events';
import type { Connection } from '../drivers/types.ts';

/** The part of the lgtv2 client (SSAP over wss) that the app uses. */
export interface LgClientLike {
  on(event: 'connecting' | 'prompt' | 'connect' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
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

export interface LgSessionOptions {
  host: string;
  /** Needed only for `wake()`. */
  mac?: string;
  /** The pairing key saved earlier (a string), or anything else for none. */
  credentials: unknown;
  /** Called with the pairing key when the user has pressed "Allow" on the TV. */
  saveCredentials(credentials: unknown): void;
  log(...args: unknown[]): void;
  /** Follow the TV's power state and emit `power`. A session that only shows messages does not need it. Default true. */
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
  }

  async stop(): Promise<void> {
    const lg = this.lg;
    this.lg = null;
    this.setConnection('offline');
    await lg?.disconnect();
  }

  async toast(message: string): Promise<void> {
    await this.lg?.request('ssap://system.notifications/createToast', { message });
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
