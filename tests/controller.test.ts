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
  driverConfig: { name: 'Stue' },
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

test('uten oppsett er TV-en ikke satt opp og ingen tilkobling opprettes', async () => {
  const { controller, connections } = await setup();
  const status = controller.getStatus();
  assert.equal(status.configured, false);
  assert.equal(status.connection, 'unconfigured');
  assert.equal(connections.length, 0);
});

test('configure kobler til via driveren og renser feltene', async () => {
  const { controller, connections, store } = await setup();
  await controller.configure(settings({ driverConfig: { name: '  Stue ', evil: 'x' } as any }));
  const status = controller.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.connection, 'connected');
  assert.deepEqual(status.settings.driverConfig, { name: 'Stue' });
  assert.equal(connections.length, 1);
  assert.deepEqual((store.get('tvSettings') as TvSettings).driverConfig, { name: 'Stue' });
});

test('manglende påkrevd felt gir ikke noen tilkobling', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings({ driverConfig: { name: '' } }));
  assert.equal(controller.getStatus().configured, false);
  assert.equal(connections.length, 0);
});

test('en ukjent driver i configure beholder den gamle', async () => {
  const { controller } = await setup();
  await controller.configure(settings({ driver: 'finnes-ikke' }));
  assert.equal(controller.getStatus().settings.driver, 'simulated');
});

test('uendret TV-oppsett kobler ikke til på nytt, endret gjør det', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  await controller.configure(settings({ weekdayMinutes: 45 }));
  assert.equal(connections.length, 1);
  await controller.configure(settings({ driverConfig: { name: 'Kjellerstua' } }));
  assert.equal(connections.length, 2);
});

test('Låsen slår av TV-en gjennom driveren og viser melding', async () => {
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

test('uten Barnemodus røres ikke TV-en', async () => {
  const { controller, connections, timeouts } = await setup();
  await controller.configure(settings());
  controller.reduceTime(1000);
  connections[0].simulatePower(true);
  for (const run of timeouts.splice(0)) run();
  assert.equal(connections[0].turnOffCalls, 0);
});

test('wakeTv går via driveren', async () => {
  const { controller, connections } = await setup();
  await controller.configure(settings());
  await controller.wakeTv();
  assert.equal(connections[0].wakeCalls, 1);
});

test('paringsdata lagres per driver', async () => {
  const { controller, connections, store } = await setup();
  await controller.configure(settings());
  connections[0].saveCredentials('hemmelig');
  assert.deepEqual(store.get('tvCredentials'), { simulated: 'hemmelig' });
  await controller.configure(settings({ driverConfig: { name: 'Annen' } }));
  assert.equal(connections[1].credentials, 'hemmelig');
});

test('gamle innstillinger med host og mac blir til LG-driveren', () => {
  assert.deepEqual(migrateSavedSettings({ host: '10.0.0.5', mac: 'AA:BB', weekdayMinutes: 20 }), {
    weekdayMinutes: 20,
    driver: 'lg-webos',
    driverConfig: { host: '10.0.0.5', mac: 'AA:BB' },
  });
  const modern = { driver: 'simulated', driverConfig: { name: 'x' }, weekdayMinutes: 20 };
  assert.deepEqual(migrateSavedSettings(modern), modern);
  assert.deepEqual(migrateSavedSettings(undefined), {});
});

test('en oppgradering beholder LG-oppsettet og den gamle clientKey', async () => {
  const { driver, connections } = createSimulatedDriver();
  const lg = { ...driver, id: 'lg-webos', fields: [{ key: 'host', label: 'IP', required: true }] };
  const env = fakeHost({ tvSettings: { host: '10.0.0.5', mac: '', weekdayMinutes: 20 }, clientKey: 'gammel-nøkkel' });
  const controller = new Controller(env.host, [lg]);
  await controller.start();
  const status = controller.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.settings.driver, 'lg-webos');
  assert.equal(status.settings.weekdayMinutes, 20);
  assert.equal(connections[0].credentials, 'gammel-nøkkel');
});
