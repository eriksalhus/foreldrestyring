import { EventEmitter } from 'node:events';

type LgModule = typeof import('lgtv2', { with: { 'resolution-mode': 'import' } });
type LgClient = InstanceType<LgModule['default']>;

export type Connection = 'connecting' | 'prompt' | 'connected' | 'offline';

export interface TvOptions {
  host: string;
  mac?: string;
  clientKey?: string;
  saveKey: (key: string) => void;
  log: (...args: unknown[]) => void;
}

/** Tilstander der TV-en regnes som på: bildet kan være av, men TV-en er ikke i standby. */
const ON_STATES = new Set(['on', 'screen_off', 'screen_saver']);

/**
 * Tynt lag over lgtv2: holder TV-ens påslåtthet og tilkoblingsstatus oppdatert og
 * emitter `power` (boolean) når påslåttheten endrer seg.
 */
export class TvClient extends EventEmitter {
  connection: Connection = 'connecting';
  isOn = false;

  private lg: LgClient | null = null;
  private powerSubscription: string | undefined;

  constructor(private readonly options: TvOptions) {
    super();
  }

  async start(): Promise<void> {
    const { default: LG } = await import('lgtv2');
    const { host, mac, clientKey, saveKey, log } = this.options;
    const lg = new LG({
      host,
      mac: mac || undefined,
      clientKey: clientKey || undefined,
      saveKey: (key, cb) => {
        saveKey(key);
        cb();
      },
      learnMac: false,
      reconnect: 5000,
    });
    this.lg = lg;

    lg.on('connecting', () => {
      if (this.connection !== 'prompt') this.setConnection('connecting');
    });
    lg.on('prompt', () => this.setConnection('prompt'));
    lg.on('connect', () => {
      this.setConnection('connected');
      if (this.powerSubscription) lg.unsubscribe(this.powerSubscription);
      this.powerSubscription = lg.subscribePowerState((err, result) => {
        if (err || !result) return;
        this.setOn(ON_STATES.has(result.state));
      });
    });
    lg.on('close', () => {
      this.setConnection('offline');
      this.setOn(false);
    });
    lg.on('error', (err) => log('TV-feil:', err.message));
  }

  async stop(): Promise<void> {
    const lg = this.lg;
    this.lg = null;
    this.setOn(false);
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
    this.options.log('TV-tilkobling:', connection);
    this.emit('connection', connection);
  }

  private setOn(on: boolean): void {
    if (this.isOn === on) return;
    this.isOn = on;
    this.options.log('TV er', on ? 'på' : 'av');
    this.emit('power', on);
  }
}
