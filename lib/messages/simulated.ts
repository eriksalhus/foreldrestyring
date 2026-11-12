import { EventEmitter } from 'node:events';
import type { Connection, TvDeviceInfo } from '../drivers/types.ts';
import type { MessageChannel, MessageOptions, MessageProvider } from './types.ts';

/**
 * A message provider that exists only in memory. It is not offered to users. Tests use it to run the Controller
 * without a TV, and it is a small, complete example of a provider.
 */
export class SimulatedChannel extends EventEmitter implements MessageChannel {
  connection: Connection = 'connecting';
  readonly sent: string[] = [];
  started = false;
  stopped = false;
  readonly options: MessageOptions;

  constructor(options: MessageOptions) {
    super();
    this.options = options;
  }

  async start(): Promise<void> {
    this.started = true;
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.started = false;
    this.setConnection('offline');
  }

  async send(text: string): Promise<void> {
    this.sent.push(text);
  }

  /** Test hook: the TV waits for the user to press "Allow". */
  simulatePrompt(): void {
    this.setConnection('prompt');
  }

  /** Test hook: the user pressed "Allow", or the TV is reachable again. */
  simulateConnected(): void {
    this.setConnection('connected');
  }

  /** Test hook: the link drops, for example because the TV is in standby. */
  simulateOffline(): void {
    this.setConnection('offline');
  }

  /** Test hook: what the provider has been given as `credentials`, and a way to save a key. */
  saveCredentials(credentials: unknown): void {
    this.options.saveCredentials(credentials);
  }

  private setConnection(connection: Connection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    this.emit('connection', connection);
  }
}

/** Recognises devices of the app `appId` and suggests their `ipAddress` setting. */
export function createSimulatedProvider(appId = 'com.example.simulated'): { provider: MessageProvider; channels: SimulatedChannel[] } {
  const channels: SimulatedChannel[] = [];
  const provider: MessageProvider = {
    id: 'simulated',
    name: 'Simulated TV',
    fields: [{ key: 'host', label: 'IP address', required: true }],
    matches: (device: TvDeviceInfo) => device.appId === appId,
    suggestConfig(device: TvDeviceInfo): Record<string, string> {
      const ip = device.settings.ipAddress;
      return device.appId === appId && typeof ip === 'string' ? { host: ip } : {};
    },
    createChannel(options: MessageOptions) {
      const channel = new SimulatedChannel(options);
      channels.push(channel);
      return channel;
    },
  };
  return { provider, channels };
}
