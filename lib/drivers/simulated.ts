import { BaseTvConnection } from './base.ts';
import type { DriverOptions, TvDriver } from './types.ts';

/**
 * A TV that exists only in memory. It is not offered to users. Tests use it to run the
 * Controller without a real TV, and it is a small, complete example of a driver.
 */
export class SimulatedConnection extends BaseTvConnection {
  readonly toasts: string[] = [];
  turnOffCalls = 0;
  wakeCalls = 0;

  async start(): Promise<void> {
    this.setConnection('connected');
  }

  async stop(): Promise<void> {
    this.setOn(false);
    this.setConnection('offline');
  }

  async toast(message: string): Promise<void> {
    this.toasts.push(message);
  }

  async turnOff(): Promise<void> {
    this.turnOffCalls++;
    this.setOn(false);
  }

  async wake(): Promise<void> {
    this.wakeCalls++;
    this.setOn(true);
  }

  /** Test hook: the user presses the power button. */
  simulatePower(on: boolean): void {
    this.setOn(on);
  }

  /** Test hook: the user must approve the pairing on the TV. */
  simulatePrompt(): void {
    this.setConnection('prompt');
  }

  /** Test hook: the link drops. */
  simulateOffline(): void {
    this.setOn(false);
    this.setConnection('offline');
  }

  /** Test hook: what the driver has been given as `credentials` and what it saved. */
  get credentials(): unknown {
    return this.options.credentials;
  }

  saveCredentials(credentials: unknown): void {
    this.options.saveCredentials(credentials);
  }
}

export function createSimulatedDriver(): { driver: TvDriver; connections: SimulatedConnection[] } {
  const connections: SimulatedConnection[] = [];
  const driver: TvDriver = {
    id: 'simulated',
    name: 'Simulated TV',
    canWake: true,
    fields: [{ key: 'name', label: 'Name', required: true }],
    createConnection(options: DriverOptions) {
      const connection = new SimulatedConnection(options);
      connections.push(connection);
      return connection;
    },
  };
  return { driver, connections };
}
