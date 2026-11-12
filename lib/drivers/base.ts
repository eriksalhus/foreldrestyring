import { EventEmitter } from 'node:events';
import type { Connection, DriverOptions, TvConnection } from './types.ts';

/**
 * Handy base for drivers. It holds `connection` and `isOn` and emits the events the app listens
 * for, so a driver only calls `setConnection()` and `setOn()` when something changes on the TV.
 */
export abstract class BaseTvConnection extends EventEmitter implements TvConnection {
  connection: Connection = 'connecting';
  isOn = false;

  protected readonly options: DriverOptions;

  constructor(options: DriverOptions) {
    super();
    this.options = options;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  toast?(message: string): Promise<void>;
  abstract turnOff(): Promise<void>;
  wake?(): Promise<void>;

  protected setConnection(connection: Connection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    this.options.log('TV connection:', connection);
    this.emit('connection', connection);
  }

  protected setOn(on: boolean): void {
    // A TV we cannot reach is never counted as on, or the Quota would keep running.
    const value = on && this.connection === 'connected';
    if (this.isOn === value) return;
    this.isOn = value;
    this.options.log('TV is', value ? 'on' : 'off');
    this.emit('power', value);
  }
}
