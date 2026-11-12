import { EventEmitter } from 'node:events';

/** A stand-in for the lgtv2 client: the test plays the TV by emitting events. */
export class FakeLg extends EventEmitter {
  readonly requests: Array<{ uri: string; payload?: object }> = [];
  readonly wakes: Array<string | undefined> = [];
  readonly unsubscribed: string[] = [];
  disconnected = false;
  /** How many times the app asked the open connection to register again (a new Allow prompt). */
  connectCalls = 0;
  /** When set, `request` fails with it, like the lgtv2 timeout does. */
  rejectWith: Error | null = null;
  /** Answers by uri, taking precedence over `rejectWith`. */
  responses: Record<string, unknown> = {};
  /** Requests to these uris are never answered, like a TV that ignores them. */
  hangOn = new Set<string>();
  powerCallback: ((err: Error | null, result?: { state: string }) => void) | null = null;

  async request(uri: string, payload?: object) {
    this.requests.push({ uri, payload });
    if (this.hangOn.has(uri)) return new Promise(() => {});
    if (uri in this.responses) return this.responses[uri];
    if (this.rejectWith) throw this.rejectWith;
  }
  subscribePowerState(cb: (err: Error | null, result?: { state: string }) => void) {
    this.powerCallback = cb;
    return 'sub1';
  }
  unsubscribe(id: string) {
    this.unsubscribed.push(id);
  }
  connect() {
    this.connectCalls++;
  }
  async disconnect() {
    this.disconnected = true;
    this.emit('close');
  }
  async wake(mac?: string) {
    this.wakes.push(mac);
  }
  power(state: string) {
    this.powerCallback?.(null, { state });
  }
}
