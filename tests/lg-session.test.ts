import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { LgSession } from '../lib/lg/session.ts';
import type { LgClientLike, LgClientOptions } from '../lib/lg/session.ts';
import type { Connection } from '../lib/drivers/types.ts';

/** A stand-in for the lgtv2 client: the test plays the TV by emitting events. */
class FakeLg extends EventEmitter {
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

function setup(over: { credentials?: unknown; followPower?: boolean; mac?: string } = {}) {
  const lg = new FakeLg();
  let clientOptions: LgClientOptions | undefined;
  const saved: unknown[] = [];
  const session = new LgSession({
    host: '10.0.0.5',
    mac: over.mac,
    credentials: over.credentials,
    saveCredentials: (c) => saved.push(c),
    log: () => {},
    followPower: over.followPower,
    createClient: async (options) => {
      clientOptions = options;
      return lg as unknown as LgClientLike;
    },
  });
  const states: Connection[] = [];
  const power: boolean[] = [];
  session.on('connection', (c) => states.push(c));
  session.on('power', (on) => power.push(on));
  return { session, lg, saved, states, power, options: () => clientOptions! };
}

test('start connects to the host with the stored key and reconnects by itself', async () => {
  const { session, options } = setup({ credentials: 'key-1', mac: 'AA:BB' });
  await session.start();
  assert.equal(options().host, '10.0.0.5');
  assert.equal(options().mac, 'AA:BB');
  assert.equal(options().clientKey, 'key-1');
  assert.equal(options().reconnect, 5000);
  assert.equal(options().learnMac, false);
  assert.equal(session.connection, 'connecting');
});

test('a key that is not text is ignored, and a new key is saved as the credentials', async () => {
  const { session, saved, options } = setup({ credentials: { weird: true } });
  await session.start();
  assert.equal(options().clientKey, undefined);
  await new Promise<void>((resolve) => options().saveKey('new-key', resolve));
  assert.deepEqual(saved, ['new-key']);
});

test('connection states follow the TV, and "connecting" never hides the Allow prompt', async () => {
  const { session, lg, states } = setup();
  await session.start();
  lg.emit('prompt');
  lg.emit('connecting');
  assert.equal(session.connection, 'prompt');
  lg.emit('connect');
  assert.equal(session.connection, 'connected');
  lg.emit('close');
  assert.equal(session.connection, 'offline');
  lg.emit('connecting');
  assert.deepEqual(states, ['prompt', 'connected', 'offline', 'connecting']);
});

test('the power state is followed once connected: on, screen off and screensaver count as on', async () => {
  const { session, lg, power } = setup();
  await session.start();
  lg.emit('connect');
  for (const state of ['on', 'screen_off', 'screen_saver', 'active_standby', 'on', 'suspend']) lg.power(state);
  assert.deepEqual(power, [true, true, true, false, true, false]);
});

test('a power error is ignored, and the power state is not followed when it is not wanted', async () => {
  const quiet = setup({ followPower: false });
  await quiet.session.start();
  quiet.lg.emit('connect');
  assert.equal(quiet.lg.powerCallback, null, 'a message-only session never subscribes');

  const { session, lg, power } = setup();
  await session.start();
  lg.emit('connect');
  lg.powerCallback!(new Error('boom'));
  assert.deepEqual(power, []);
});

test('a reconnect replaces the power subscription', async () => {
  const { session, lg } = setup();
  await session.start();
  lg.emit('connect');
  lg.emit('connect');
  assert.deepEqual(lg.unsubscribed, ['sub1']);
});

test('toast, turnOff and wake are the SSAP calls the driver always used', async () => {
  const { session, lg } = setup({ mac: 'AA:BB' });
  await session.start();
  await session.toast('Hello');
  await session.turnOff();
  await session.wake();
  assert.deepEqual(lg.requests, [
    { uri: 'ssap://system.notifications/createToast', payload: { message: 'Hello' } },
    { uri: 'ssap://system/turnOff', payload: undefined },
  ]);
  assert.deepEqual(lg.wakes, ['AA:BB']);
});

test('stop disconnects and leaves the session offline', async () => {
  const { session, lg, states } = setup();
  await session.start();
  lg.emit('connect');
  await session.stop();
  assert.equal(lg.disconnected, true);
  assert.equal(session.connection, 'offline');
  assert.equal(states.at(-1), 'offline');
  await session.toast('late'); // after stop nothing is sent and nothing throws
  assert.equal(lg.requests.length, 0);
});
