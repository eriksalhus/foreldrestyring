import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LgSession } from '../lib/lg/session.ts';
import type { LgClientLike, LgClientOptions } from '../lib/lg/session.ts';
import type { Connection } from '../lib/drivers/types.ts';
import { FakeLg } from './fake-lg.ts';

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

test('a message that cannot be shown at all logs the last frames from the TV, with the pairing key hidden', async () => {
  const lg = new FakeLg();
  const logs: string[] = [];
  const session = new LgSession({
    host: '10.0.0.5',
    credentials: undefined,
    saveCredentials: () => {},
    log: (...args) => void logs.push(args.join(' ')),
    createClient: async () => lg as unknown as LgClientLike,
  });
  await session.start();
  lg.emit('message', '{"type":"registered","id":"r1","payload":{"client-key":"SECRET-KEY-123"}}');
  lg.emit('message', '{"type":"response","id":"s1","payload":{"state":"Active"}}');
  lg.rejectWith = new Error('timeout');
  await assert.rejects(session.toast('Hello'), /timeout/);
  const line = logs.find((l) => l.startsWith('SSAP message failed: timeout'));
  assert.ok(line, 'the failure is logged');
  assert.ok(line.includes('"state":"Active"'), 'recent frames are included');
  assert.ok(!line.includes('SECRET-KEY-123'), 'the pairing key is never logged');
  assert.ok(line.includes('***'));
});

test('only the last few frames are kept, and long ones are cut', async () => {
  const lg = new FakeLg();
  const logs: string[] = [];
  const session = new LgSession({
    host: '10.0.0.5',
    credentials: undefined,
    saveCredentials: () => {},
    log: (...args) => void logs.push(args.join(' ')),
    createClient: async () => lg as unknown as LgClientLike,
  });
  await session.start();
  for (let i = 0; i < 20; i++) lg.emit('message', '{"n":' + i + '}');
  lg.emit('message', 'x'.repeat(1000));
  lg.rejectWith = new Error('timeout');
  await assert.rejects(session.toast('Hello'));
  const line = logs.find((l) => l.startsWith('SSAP message failed'))!;
  assert.ok(!line.includes('{"n":0}'), 'old frames are dropped');
  assert.ok(line.includes('{"n":19}'));
  assert.ok(line.length < 2500, 'long frames are cut');
});

const TOAST = 'ssap://system.notifications/createToast';
const ALERT = 'ssap://system.notifications/createAlert';

function alertSetup(over: { toastWaitMs?: number; now?: () => number } = {}) {
  const lg = new FakeLg();
  const logs: string[] = [];
  const session = new LgSession({
    host: '10.0.0.5',
    credentials: undefined,
    saveCredentials: () => {},
    log: (...args) => void logs.push(args.join(' ')),
    createClient: async () => lg as unknown as LgClientLike,
    toastWaitMs: over.toastWaitMs ?? 20,
    now: over.now,
  });
  return { session, lg, logs };
}

test('a TV that answers the toast gets a toast and never an alert', async () => {
  const { session, lg } = alertSetup();
  await session.start();
  await session.toast('Hello');
  assert.deepEqual(lg.requests.map((r) => r.uri), [TOAST]);
});

test('a TV that ignores the toast gets an alert instead, and the next messages go straight to alerts', async () => {
  const { session, lg, logs } = alertSetup();
  await session.start();
  lg.hangOn.add(TOAST);
  await session.toast('You have 5 min left');
  assert.deepEqual(lg.requests.map((r) => r.uri), [TOAST, ALERT]);
  assert.deepEqual(lg.requests[1].payload, { message: 'You have 5 min left', buttons: [{ label: 'OK' }] });
  assert.ok(logs.some((l) => /did not answer createToast.*alerts/.test(l)));

  await session.toast('TV time is up');
  assert.deepEqual(lg.requests.map((r) => r.uri), [TOAST, ALERT, ALERT], 'no more waiting for a toast');
});

test('a TV that refuses the toast with an error also gets an alert', async () => {
  const { session, lg } = alertSetup();
  await session.start();
  lg.rejectWith = new Error('401 insufficient permissions');
  lg.responses[ALERT] = { returnValue: true, alertId: 'a1' };
  await session.toast('Hello');
  assert.deepEqual(lg.requests.map((r) => r.uri), [TOAST, ALERT]);
});

test('the toast is tried again after an hour, in case the TV behaves differently later', async () => {
  let clock = 1_000_000;
  const { session, lg } = alertSetup({ now: () => clock });
  await session.start();
  lg.hangOn.add(TOAST);
  await session.toast('one');
  await session.toast('two');
  assert.deepEqual(lg.requests.map((r) => r.uri), [TOAST, ALERT, ALERT]);
  clock += 61 * 60 * 1000;
  lg.hangOn.delete(TOAST);
  await session.toast('three');
  assert.deepEqual(lg.requests.map((r) => r.uri), [TOAST, ALERT, ALERT, TOAST], 'the toast works again, so no alert');
  await session.toast('four');
  assert.deepEqual(lg.requests.map((r) => r.uri).slice(-1), [TOAST], 'and it stays a toast');
});

test('when neither the toast nor the alert can be shown the error reaches the caller', async () => {
  const { session, lg } = alertSetup();
  await session.start();
  lg.hangOn.add(TOAST);
  lg.rejectWith = new Error('boom');
  await assert.rejects(session.toast('Hello'), /boom/);
});

test('a message after stop shows nothing and throws nothing', async () => {
  const { session, lg } = alertSetup();
  await session.start();
  await session.stop();
  await session.toast('late');
  assert.equal(lg.requests.length, 0);
});
