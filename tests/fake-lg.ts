import { EventEmitter } from 'node:events';

/** A stand-in for the lgtv2 client: the test plays the TV by emitting events. */
export class FakeLg extends EventEmitter {
  readonly requests: Array<{ uri: string; payload?: object }> = [];
  readonly wakes: Array<string | undefined> = [];
  readonly unsubscribed: string[] = [];
  disconnected = false;
  powerCallback: ((err: Error | null, result?: { state: string }) => void) | null = null;

  async request(uri: string, payload?: object) {
    this.requests.push({ uri, payload });
  }
  subscribePowerState(cb: (err: Error | null, result?: { state: string }) => void) {
    this.powerCallback = cb;
    return 'sub1';
  }
  unsubscribe(id: string) {
    this.unsubscribed.push(id);
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
