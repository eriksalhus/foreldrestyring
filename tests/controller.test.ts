import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, migrateSavedSettings } from '../lib/controller.ts';
import type { Host, TvSettings } from '../lib/controller.ts';
import { createSimulatedDriver } from '../lib/drivers/simulated.ts';

function fakeHost(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const timeouts: Array<() => void> = [];
  const host: Host = {
    settings: { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) },
    log: () => {},
    error: () => {},
    setInterval: (fn) => fn,
    clearInterval: () => {},
    setTimeout: (fn) => {
      timeouts.push(fn);
      return fn;
    },
    __: (key) => key,
    clock: { getTimezone: () => 'Europe/Oslo' },
    i18n: { getLanguage: () => 'no' },
  };
  return { store, timeouts, host };
}

const settings = (over: Partial<TvSettings> = {}): TvSettings => ({
  driver: 'simulated',
  driverConfig: { name: 'Living room' },
  weekdayMinutes: 30,
  weekendMinutes: 30,
  weekStartDay: 1,
  dayStartTime: '05:00',
  autoOffAtRollover: true,
  autoOnEnabled: false,
  autoOnTime: '15:00',
  ...over,
});

async function setup(initial: Record<string, unknown> = {}) {
  const { driver, connections } = createSimulatedDriver();
  const env = fakeHost(initial);
  const controller = new Controller(env.host, [driver]);
  await controller.start();
  return { ...env, controller, connections, driver };
}

test('without setup the TV is not configured and no connection is created', async () => {
  const { controller, connections } = await setup();
  const status = controller.getStatus();
  assert.equal(status.configured, false);
  assert.equal(status.connection, 'unconfigured');
  assert.equal(connections.length, 0);
});

test('configure connects through the driver and cleans the fields', async () => {
  const { controller, connections, store } = await setup();
  await controller.configure(settings({ driverConfig: { name: '  Living room ', evil: 'x' } as any }));
  const status = controller.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.connection, 'connected');
  assert.deepEqual(status.settings.driverConfig, { name: 'Living room' });
  assert.equal(connections.length, 1);
  assert.deepEqual((store.get('tvSettings') as TvSettings).driverConfig, { name: 'Living room' });
});

test('a missing required field gives no connection', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings({ driverConfig: { name: '' } }));
  assert.equal(controller.getStatus().configured, false);
  assert.equal(connections.length, 0);
});

test('an unknown driver in configure keeps the old one', async () => {
  const { controller } = await setup();
  await controller.configure(settings({ driver: 'finnes-ikke' }));
  assert.equal(controller.getStatus().settings.driver, 'simulated');
});

test('unchanged TV setup does not reconnect, changed setup does', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  await controller.configure(settings({ weekdayMinutes: 45 }));
  assert.equal(connections.length, 1);
  await controller.configure(settings({ driverConfig: { name: 'Basement' } }));
  assert.equal(connections.length, 2);
});

test('the Lock turns the TV off through the driver and shows a message', async () => {
  const { controller, connections, timeouts } = await setup();
  await controller.configure(settings());
  controller.setChildMode(true);
  controller.reduceTime(1000);
  assert.equal(controller.getStatus().locked, true);

  connections[0].simulatePower(true);
  for (const run of timeouts.splice(0)) run();

  assert.equal(connections[0].turnOffCalls, 1);
  assert.deepEqual(connections[0].toasts, ['toast.timeUp']);
  assert.equal(connections[0].isOn, false);
});

test('without Child mode the TV is left alone', async () => {
  const { controller, connections, timeouts } = await setup();
  await controller.configure(settings());
  controller.reduceTime(1000);
  connections[0].simulatePower(true);
  for (const run of timeouts.splice(0)) run();
  assert.equal(connections[0].turnOffCalls, 0);
});

test('wakeTv goes through the driver', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  await controller.wakeTv();
  assert.equal(connections[0].wakeCalls, 1);
});

test('pairing data is stored per driver', async () => {
  const { controller, connections, store } = await setup();
  await controller.configure(settings());
  connections[0].saveCredentials('secret');
  assert.deepEqual(store.get('tvCredentials'), { simulated: 'secret' });
  await controller.configure(settings({ driverConfig: { name: 'Other' } }));
  assert.equal(connections[1].credentials, 'secret');
});

test('old settings with host and mac become the LG driver', () => {
  assert.deepEqual(migrateSavedSettings({ host: '10.0.0.5', mac: 'AA:BB', weekdayMinutes: 20 }), {
    weekdayMinutes: 20,
    driver: 'lg-webos',
    driverConfig: { host: '10.0.0.5', mac: 'AA:BB' },
  });
  const modern = { driver: 'simulated', driverConfig: { name: 'x' }, weekdayMinutes: 20 };
  assert.deepEqual(migrateSavedSettings(modern), modern);
  assert.deepEqual(migrateSavedSettings(undefined), {});
});

test('an upgrade keeps the LG setup and the old clientKey', async () => {
  const { driver, connections } = createSimulatedDriver();
  const lg = { ...driver, id: 'lg-webos', fields: [{ key: 'host', label: 'IP', required: true }] };
  const env = fakeHost({ tvSettings: { host: '10.0.0.5', mac: '', weekdayMinutes: 20 }, clientKey: 'old-key' });
  const controller = new Controller(env.host, [lg]);
  await controller.start();
  const status = controller.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.settings.driver, 'lg-webos');
  assert.equal(status.settings.weekdayMinutes, 20);
  assert.equal(connections[0].credentials, 'old-key');
});

test('time can be set before Child mode is turned on, and turning it on or off never changes the time left', async () => {
  const { controller } = await setup();
  await controller.configure(settings({ weekdayMinutes: 30, weekendMinutes: 30 }));
  assert.equal(controller.getStatus().childMode, false);

  controller.addExtraTime(60);
  controller.reduceTime(30);
  assert.equal(controller.getStatus().remainingMinutes, 60);
  assert.equal(controller.getStatus().locked, false);

  controller.setChildMode(true);
  assert.equal(controller.getStatus().remainingMinutes, 60);
  controller.setChildMode(false);
  assert.equal(controller.getStatus().remainingMinutes, 60);
});

test('removing all time while Child mode is off does not lock until it is turned on', async () => {
  const { controller } = await setup();
  await controller.configure(settings({ weekdayMinutes: 30, weekendMinutes: 30 }));
  controller.reduceTime(30);
  const off = controller.getStatus();
  assert.equal(off.remainingMinutes, 0);
  assert.equal(off.locked, false);
  assert.equal(controller.setChildMode(true).locked, true);
});
