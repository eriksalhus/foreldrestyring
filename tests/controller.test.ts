import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Controller, migrateSavedSettings } from '../lib/controller.ts';
import type { Host, TvSettings } from '../lib/controller.ts';
import { homeyDevice } from '../lib/drivers/homey-device.ts';
import { createSimulatedDriver } from '../lib/drivers/simulated.ts';
import { FakeDevices } from './fake-devices.ts';

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

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The real driver order (Homey device first), with LG replaced by a stub so no test opens a network connection. */
function driversWithStubLg() {
  const { driver, connections } = createSimulatedDriver();
  const lg = { ...driver, id: 'lg-webos', fields: [{ key: 'host', label: 'IP', required: true }, { key: 'mac', label: 'MAC' }] };
  return { drivers: [homeyDevice, lg], lgConnections: connections };
}

async function setupHomey(initial: Record<string, unknown> = {}) {
  const fake = new FakeDevices();
  fake.add({ id: 'tv1', on: false });
  const env = fakeHost(initial);
  const { drivers, lgConnections } = driversWithStubLg();
  const controller = new Controller(env.host, drivers, fake);
  await controller.start();
  return { ...env, controller, fake, lgConnections };
}

const homeySettings = (over: Partial<TvSettings> = {}) =>
  settings({ driver: 'homey-device', driverConfig: { deviceId: 'tv1' }, ...over });

test('a Homey device is connected through the devices port and the Lock switches it off', async () => {
  const { controller, fake, timeouts } = await setupHomey();
  await controller.configure(homeySettings());
  await flush();
  const status = controller.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.connection, 'connected');
  assert.equal(status.tvMissing, false);

  controller.setChildMode(true);
  controller.reduceTime(1000);
  fake.press('tv1', true);
  for (const run of timeouts.splice(0)) run();
  await flush();

  assert.deepEqual(fake.setCalls, [{ id: 'tv1', on: false }]);
});

test('without a message capability the Lock and the warnings still work, and nothing is shown', async () => {
  const { controller, fake, timeouts } = await setupHomey();
  await controller.configure(homeySettings());
  await flush();
  controller.setChildMode(true);
  controller.reduceTime(1000);
  fake.press('tv1', true);
  assert.doesNotThrow(() => {
    for (const run of timeouts.splice(0)) run();
  });
  await flush();
  assert.equal(fake.setCalls.length, 1);
});

test('a Homey device that has been deleted shows as missing in the status', async () => {
  const { controller } = await setupHomey();
  await controller.configure(homeySettings({ driverConfig: { deviceId: 'gone' } }));
  await flush();
  const status = controller.getStatus();
  assert.equal(status.connection, 'offline');
  assert.equal(status.tvMissing, true);
  assert.equal(status.settings.driverConfig.deviceId, 'gone', 'the choice is kept, never switched to another TV');
});

test('getTvDevices lists the TVs in Homey for the settings page, sorted by name', async () => {
  const { controller, fake } = await setupHomey();
  fake.add({ id: 'tv2', name: 'Bedroom TV', zone: 'Bedroom' });
  assert.deepEqual(await controller.getTvDevices(), [
    { id: 'tv2', name: 'Bedroom TV', zone: 'Bedroom' },
    { id: 'tv1', name: 'Living room TV', zone: 'Living room' },
  ]);
});

test('getTvDevices gives an empty list without access to Homey devices or when Homey fails', async () => {
  const env = fakeHost();
  const without = new Controller(env.host, driversWithStubLg().drivers);
  await without.start();
  assert.deepEqual(await without.getTvDevices(), []);

  const failing = new FakeDevices();
  failing.list = async () => {
    throw new Error('no permission');
  };
  const withFailure = new Controller(fakeHost().host, driversWithStubLg().drivers, failing);
  await withFailure.start();
  assert.deepEqual(await withFailure.getTvDevices(), []);
});

test('a new installation defaults to the Homey device driver, an existing LG installation keeps LG', async () => {
  const fresh = await setupHomey();
  assert.equal(fresh.controller.getStatus().settings.driver, homeyDevice.id);

  const upgraded = await setupHomey({
    tvSettings: { driver: 'lg-webos', driverConfig: { host: '10.0.0.5', mac: '' } },
  });
  const status = upgraded.controller.getStatus();
  assert.equal(status.settings.driver, 'lg-webos');
  assert.equal(status.configured, true);
  assert.equal(upgraded.lgConnections.length, 1);
  assert.equal(upgraded.fake.getCalls.length, 0, 'the Homey devices are not touched for an LG setup');
});

test('settings from before TV drivers still become LG when the Homey device driver is listed first', async () => {
  const { controller } = await setupHomey({ tvSettings: { host: '10.0.0.5', mac: 'AA:BB', weekdayMinutes: 20 } });
  const status = controller.getStatus();
  assert.equal(status.settings.driver, 'lg-webos');
  assert.deepEqual(status.settings.driverConfig, { host: '10.0.0.5', mac: 'AA:BB' });
});

test('switching Child mode on or off shows a message while the TV is on', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  connections[0].simulatePower(true);

  controller.setChildMode(true);
  controller.setChildMode(true);
  controller.setChildMode(false);
  controller.setChildMode(false);

  assert.deepEqual(connections[0].toasts, ['toast.childModeOn', 'toast.childModeOff'], 'only real changes are shown');
});

test('switching Child mode shows nothing while the TV is off', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  controller.setChildMode(true);
  controller.setChildMode(false);
  assert.deepEqual(connections[0].toasts, []);
});

test('switching Child mode on with no time left shows only "time is up"', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  controller.reduceTime(1000);
  connections[0].simulatePower(true);
  controller.setChildMode(true);
  assert.deepEqual(connections[0].toasts, ['toast.timeUp']);
});

test('Child mode switched on at the set time and off at the new Quota day shows a message on a TV that is on', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-12T13:00:00Z') }); // 14:00 in Oslo
  try {
    const { driver, connections } = createSimulatedDriver();
    const env = fakeHost();
    const intervals: Array<() => void> = [];
    env.host.setInterval = (fn) => {
      intervals.push(fn);
      return fn;
    };
    const controller = new Controller(env.host, [driver]);
    await controller.start();
    await controller.configure(settings({ autoOnEnabled: true, autoOnTime: '15:00', dayStartTime: '05:00' }));
    const onTick = intervals[0];
    connections[0].simulatePower(true);

    mock.timers.tick(61 * 60_000); // 15:01
    onTick();
    assert.equal(controller.getStatus().childMode, true);
    assert.deepEqual(connections[0].toasts, ['toast.childModeOn']);

    mock.timers.tick(14 * 60 * 60_000); // 05:01 the next day
    onTick();
    assert.equal(controller.getStatus().childMode, false);
    assert.deepEqual(connections[0].toasts, ['toast.childModeOn', 'toast.childModeOff']);
  } finally {
    mock.timers.reset();
  }
});
