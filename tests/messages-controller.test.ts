import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller } from '../lib/controller.ts';
import type { Host, TvSettingsInput } from '../lib/controller.ts';
import { homeyDevice } from '../lib/drivers/homey-device.ts';
import { createSimulatedDriver } from '../lib/drivers/simulated.ts';
import { createSimulatedProvider } from '../lib/messages/simulated.ts';
import { FakeDevices } from './fake-devices.ts';

const APP = 'com.example.simulated';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeHost(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const timeouts: Array<() => void> = [];
  const logs: string[] = [];
  const host: Host = {
    settings: { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) },
    log: (...args) => void logs.push(args.join(' ')),
    error: () => {},
    setInterval: (fn) => fn,
    clearInterval: () => {},
    setTimeout: (fn) => {
      timeouts.push(fn);
      return fn;
    },
    __: (key) => key,
    clock: { getTimezone: () => 'Europe/Oslo' },
    i18n: { getLanguage: () => 'en' },
  };
  return { store, timeouts, host, logs };
}

const base = {
  weekdayMinutes: 30,
  weekendMinutes: 30,
  weekStartDay: 1,
  dayStartTime: '05:00',
  autoOffAtRollover: true,
  autoOnEnabled: false,
  autoOnTime: '15:00',
};
const homeySettings = (over: Partial<TvSettingsInput> = {}): TvSettingsInput => ({
  ...base,
  driver: 'homey-device',
  driverConfig: { deviceId: 'tv1' },
  ...over,
});

async function setup(initial: Record<string, unknown> = {}, deviceOver: Record<string, unknown> = {}) {
  const fake = new FakeDevices();
  fake.add({ id: 'tv1', appId: APP, settings: { ipAddress: '10.0.0.9' }, ...deviceOver });
  fake.add({ id: 'tv2', name: 'Bedroom TV', appId: APP, settings: { ipAddress: '10.0.0.10' } });
  fake.add({ id: 'other', name: 'Other TV', appId: 'com.example.unknown' });
  const { driver: direct } = createSimulatedDriver();
  const directDriver = { ...direct, canToast: true };
  const { provider, channels } = createSimulatedProvider(APP);
  const env = fakeHost(initial);
  const controller = new Controller(env.host, [homeyDevice, directDriver], fake, [provider]);
  await controller.start();
  await flush();
  return { ...env, controller, fake, channels, provider };
}

const stored = (store: Map<string, unknown>) => store.get('tvSettings') as { messages: { linked: boolean; enabled: boolean; provider: string; config: Record<string, string> } };

test('a Homey TV from a recognised app offers messages, with the IP the device knows suggested', async () => {
  const { controller } = await setup();
  await controller.configure(homeySettings());
  const { messages } = controller.getStatus();
  assert.equal(messages.mode, 'provider');
  assert.equal(messages.provider?.id, 'simulated');
  assert.equal(messages.provider?.fields[0].key, 'host');
  assert.deepEqual(messages.suggested, { host: '10.0.0.9' });
  assert.deepEqual(messages.config, {});
  assert.equal(messages.enabled, true, 'on by default');
  assert.equal(messages.linked, false);
  assert.equal(messages.connection, 'off');
});

test('a Homey TV from an unknown app is marked unsupported, with the app named so the page can say why', async () => {
  const { controller } = await setup();
  await controller.configure(homeySettings({ driverConfig: { deviceId: 'other' } }));
  const { messages } = controller.getStatus();
  assert.equal(messages.mode, 'unsupported');
  assert.equal(messages.appId, 'com.example.unknown');
  assert.equal(messages.provider, null);
  assert.equal(messages.enabled, true);
});

test('without a chosen TV there is no message section and no note', async () => {
  const { controller } = await setup();
  const { messages } = controller.getStatus();
  assert.equal(messages.mode, 'none');
  assert.equal(messages.appId, '');
});

test('a TV that was deleted in Homey has no message section', async () => {
  const { controller } = await setup();
  await controller.configure(homeySettings({ driverConfig: { deviceId: 'gone' } }));
  assert.equal(controller.getStatus().messages.mode, 'none');
});

test('a direct connection that can show messages needs no provider', async () => {
  const { controller } = await setup();

  await controller.configure({ ...base, driver: 'simulated', driverConfig: { name: 'Living room' } });
  const { messages } = controller.getStatus();
  assert.equal(messages.mode, 'direct');
  assert.equal(messages.enabled, true);
});

test('nothing contacts the TV until Link is pressed', async () => {
  const { controller, channels } = await setup();
  await controller.configure(homeySettings({ messages: { config: { host: '10.0.0.9' } } }));
  await flush();
  assert.equal(channels.length, 0);
  assert.equal(controller.getStatus().messages.connection, 'off');
});

test('Link starts the channel, shows the Allow prompt, and a connection marks the TV as linked for good', async () => {
  const { controller, channels, store } = await setup();
  await controller.configure(homeySettings());
  const status = await controller.linkMessages({ host: '10.0.0.9' });
  assert.equal(channels.length, 1);
  assert.deepEqual(channels[0].options.config, { host: '10.0.0.9' });
  assert.equal(status.messages.linked, false);
  assert.equal(status.messages.connection, 'connecting');

  channels[0].simulatePrompt();
  assert.equal(controller.getStatus().messages.connection, 'prompt');
  assert.equal(controller.getStatus().messages.linked, false);

  channels[0].simulateConnected();
  assert.equal(controller.getStatus().messages.linked, true);
  assert.equal(stored(store).messages.linked, true);
  assert.deepEqual(stored(store).messages.config, { host: '10.0.0.9' });

  channels[0].simulateOffline(); // the TV goes to standby: still linked
  assert.equal(controller.getStatus().messages.linked, true);
  assert.equal(controller.getStatus().messages.connection, 'offline');
});

test('Link needs the required fields, and does nothing for a TV without a provider', async () => {
  const { controller, channels } = await setup();
  await controller.configure(homeySettings());
  await assert.rejects(controller.linkMessages({ host: '' }), /error.cannotLink/);
  await controller.configure(homeySettings({ driverConfig: { deviceId: 'other' } }));
  await assert.rejects(controller.linkMessages({ host: '10.0.0.9' }), /error.cannotLink/);
  assert.equal(channels.length, 0);
});

async function linked(over: Record<string, unknown> = {}) {
  const env = await setup(over);
  await env.controller.configure(homeySettings());
  await env.controller.linkMessages({ host: '10.0.0.9' });
  env.channels[0].simulateConnected();
  return env;
}

test('the Lock shows "time is up" through the channel and still turns the TV off', async () => {
  const { controller, channels, fake, timeouts } = await linked();
  controller.setChildMode(true);
  controller.reduceTime(1000);
  fake.press('tv1', true);
  for (const run of timeouts.splice(0)) run();
  await flush();
  assert.deepEqual(channels[0].sent, ['toast.timeUp']);
  assert.deepEqual(fake.setCalls, [{ id: 'tv1', on: false }]);
});

test('a message is dropped, not queued, when the channel is not connected, and the Lock is unaffected', async () => {
  const { controller, channels, fake, timeouts } = await linked();
  channels[0].simulateOffline();
  controller.setChildMode(true);
  controller.reduceTime(1000);
  fake.press('tv1', true);
  for (const run of timeouts.splice(0)) run();
  await flush();
  assert.deepEqual(channels[0].sent, []);
  assert.deepEqual(fake.setCalls, [{ id: 'tv1', on: false }]);
  channels[0].simulateConnected();
  assert.deepEqual(channels[0].sent, [], 'nothing arrives late');
});

test('a message that fails to send never breaks counting or the Lock', async () => {
  const { controller, channels, fake, timeouts } = await linked();
  channels[0].send = async () => {
    throw new Error('TV said no');
  };
  controller.setChildMode(true);
  controller.reduceTime(1000);
  fake.press('tv1', true);
  for (const run of timeouts.splice(0)) run();
  await flush();
  assert.deepEqual(fake.setCalls, [{ id: 'tv1', on: false }]);
});

test('switching messages off disconnects but keeps the link, and switching on connects again', async () => {
  const { controller, channels, store } = await linked();
  await controller.configure(homeySettings({ messages: { enabled: false } }));
  assert.equal(channels[0].stopped, true);
  assert.equal(controller.getStatus().messages.connection, 'off');
  assert.equal(controller.getStatus().messages.linked, true);
  assert.equal(stored(store).messages.enabled, false);

  await controller.configure(homeySettings({ messages: { enabled: true } }));
  assert.equal(channels.length, 2);
  assert.equal(channels[1].started, true);
});

test('changing the IP address clears the link and stops the channel', async () => {
  const { controller, channels } = await linked();
  await controller.configure(homeySettings({ messages: { config: { host: '10.0.0.77' } } }));
  assert.equal(channels[0].stopped, true);
  const { messages } = controller.getStatus();
  assert.equal(messages.linked, false);
  assert.equal(messages.connection, 'off');
  assert.deepEqual(messages.config, { host: '10.0.0.77' });
});

test('saving the same IP address again keeps the link', async () => {
  const { controller, channels } = await linked();
  await controller.configure(homeySettings({ messages: { enabled: true, config: { host: '10.0.0.9', evil: 'x' } as any } }));
  assert.equal(channels.length, 1);
  assert.equal(controller.getStatus().messages.linked, true);
  assert.deepEqual(controller.getStatus().messages.config, { host: '10.0.0.9' }, 'only the provider\'s fields are kept');
});

test('Unlink stops the channel, forgets the key and keeps the on/off choice', async () => {
  const { controller, channels, store } = await linked();
  channels[0].saveCredentials('the-key');
  assert.deepEqual(store.get('tvCredentials'), { simulated: 'the-key' });
  await controller.configure(homeySettings({ messages: { enabled: false } }));
  const status = await controller.unlinkMessages();
  assert.equal(channels[0].stopped, true);
  assert.equal(status.messages.linked, false);
  assert.equal(status.messages.enabled, false);
  assert.equal((store.get('tvCredentials') as Record<string, unknown>).simulated, undefined);
});

test('the pairing key is stored by provider id and given back to the channel', async () => {
  const { controller, channels } = await setup({ tvCredentials: { simulated: 'earlier-key' } });
  await controller.configure(homeySettings());
  await controller.linkMessages({ host: '10.0.0.9' });
  assert.equal(channels[0].options.credentials, 'earlier-key');
});

test('after a restart a linked TV connects by itself, and an unlinked one does not', async () => {
  const messages = { enabled: true, provider: 'simulated', config: { host: '10.0.0.9' }, linked: true };
  const settings = { ...base, driver: 'homey-device', driverConfig: { deviceId: 'tv1' } };
  const again = await setup({ tvSettings: { ...settings, messages } });
  assert.equal(again.channels.length, 1);
  assert.equal(again.channels[0].started, true);

  const fresh = await setup({ tvSettings: { ...settings, messages: { ...messages, linked: false } } });
  assert.equal(fresh.channels.length, 0);

  const off = await setup({ tvSettings: { ...settings, messages: { ...messages, enabled: false } } });
  assert.equal(off.channels.length, 0);
});

test('choosing another TV starts messages over: a different app clears everything, another recognised TV clears the link', async () => {
  const { controller, channels } = await linked();
  await controller.configure(homeySettings({ driverConfig: { deviceId: 'tv2' } }));
  assert.equal(channels[0].stopped, true);
  let { messages } = controller.getStatus();
  assert.equal(messages.linked, false);
  assert.deepEqual(messages.config, {});
  assert.deepEqual(messages.suggested, { host: '10.0.0.10' });

  await controller.configure(homeySettings({ driverConfig: { deviceId: 'other' } }));
  messages = controller.getStatus().messages;
  assert.equal(messages.mode, 'unsupported');
});

async function directLock(initial: Record<string, unknown> = {}) {
  const { driver, connections } = createSimulatedDriver();
  const directDriver = { ...driver, canToast: true };
  const env = fakeHost(initial);
  const controller = new Controller(env.host, [homeyDevice, directDriver], new FakeDevices(), []);
  await controller.start();
  await controller.configure({ ...base, driver: 'simulated', driverConfig: { name: 'Living room' } });
  controller.setChildMode(true);
  controller.reduceTime(1000);
  connections[0].simulatePower(true);
  for (const run of env.timeouts.splice(0)) run();
  return { controller, tv: connections[0] };
}

test('with a direct connection the TV shows messages itself', async () => {
  const { tv } = await directLock();
  assert.deepEqual(tv.toasts, ['toast.timeUp']);
  assert.equal(tv.turnOffCalls, 1);
});

test('with a direct connection messages can be switched off, and the Lock does not depend on them', async () => {
  const { driver, connections } = createSimulatedDriver();
  const directDriver = { ...driver, canToast: true };
  const env = fakeHost();
  const controller = new Controller(env.host, [homeyDevice, directDriver], new FakeDevices(), []);
  await controller.start();
  await controller.configure({ ...base, driver: 'simulated', driverConfig: { name: 'Living room' }, messages: { enabled: false } });
  assert.equal(controller.getStatus().messages.enabled, false);
  controller.setChildMode(true);
  controller.reduceTime(1000);
  connections[0].simulatePower(true);
  for (const run of env.timeouts.splice(0)) run();
  assert.deepEqual(connections[0].toasts, []);
  assert.equal(connections[0].turnOffCalls, 1);
});

test('settings saved before messages existed get the defaults', async () => {
  const { controller } = await setup({
    tvSettings: { ...base, driver: 'homey-device', driverConfig: { deviceId: 'tv1' } },
  });
  const { messages } = controller.getStatus().settings;
  assert.deepEqual(messages, { enabled: true, provider: 'simulated', config: {}, linked: false });
});

async function lockWithTvOn(env: Awaited<ReturnType<typeof setup>>) {
  env.controller.setChildMode(true);
  env.controller.reduceTime(1000);
  env.fake.press('tv1', true);
  for (const run of env.timeouts.splice(0)) run();
  await flush();
}

test('the log says when a message was not shown because the TV is not linked', async () => {
  const env = await setup();
  await env.controller.configure(homeySettings());
  await lockWithTvOn(env);
  assert.ok(env.logs.some((l) => /not shown, the TV is not linked/.test(l)));
});

test('the log says when a message was dropped because the channel is not connected', async () => {
  const env = await linked();
  env.channels[0].simulateOffline();
  await lockWithTvOn(env);
  assert.ok(env.logs.some((l) => /dropped, the message channel is offline/.test(l)));
});

test('the log says when a message is shown, and follows the Link states', async () => {
  const env = await setup();
  await env.controller.configure(homeySettings());
  await env.controller.linkMessages({ host: '10.0.0.9' });
  env.channels[0].simulatePrompt();
  env.channels[0].simulateConnected();
  assert.ok(env.logs.includes('Message channel: prompt'));
  assert.ok(env.logs.includes('Message channel: connected'));
  assert.ok(env.logs.some((l) => /now linked/.test(l)));
  await lockWithTvOn(env);
  assert.ok(env.logs.some((l) => l === 'Showing message: toast.timeUp'));
  assert.deepEqual(env.channels[0].sent, ['toast.timeUp']);
});

test('the log says when a message was not shown because messages are switched off', async () => {
  const env = await linked();
  await env.controller.configure(homeySettings({ messages: { enabled: false } }));
  await lockWithTvOn(env);
  assert.ok(env.logs.some((l) => /not shown, messages are switched off/.test(l)));
});
