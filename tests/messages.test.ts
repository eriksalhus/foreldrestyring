import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveText } from '../lib/drivers/index.ts';
import type { TvDeviceInfo } from '../lib/drivers/types.ts';
import type { LgClientLike } from '../lib/lg/session.ts';
import { MESSAGE_PROVIDERS, describeMessageProvider, getMessageProvider } from '../lib/messages/index.ts';
import { LG_APP_IDS, createLgMessageProvider } from '../lib/messages/lg-webos.ts';
import { createSimulatedProvider } from '../lib/messages/simulated.ts';
import type { MessageProvider } from '../lib/messages/types.ts';
import { FakeLg } from './fake-lg.ts';

const device = (over: Partial<TvDeviceInfo> = {}): TvDeviceInfo => ({
  id: 'tv1',
  name: 'TV',
  zone: '',
  on: false,
  available: true,
  appId: '',
  settings: {},
  ...over,
});

const options = (config: Record<string, string> = {}) => ({
  config,
  credentials: undefined,
  saveCredentials: () => {},
  log: () => {},
});

// The contract every message provider must meet. New providers are added to MESSAGE_PROVIDERS and tested here for free.
const all: MessageProvider[] = [...MESSAGE_PROVIDERS, createSimulatedProvider().provider];

for (const provider of all) {
  test(`${provider.id}: the description is valid`, () => {
    assert.match(provider.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'id must be lowercase kebab-case');
    assert.ok(provider.name.trim(), 'name must be set');
    assert.ok(provider.fields.some((f) => f.required), 'at least one required field');
    const keys = provider.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, 'field keys must be unique');
    for (const f of provider.fields) {
      assert.ok(resolveText(f.label, 'en'), `field ${f.key} needs a label`);
      assert.notEqual(f.kind, 'device', 'message providers have text fields only');
    }
    if (provider.hint && typeof provider.hint === 'object') assert.ok(provider.hint.en, 'hint needs an English text');
  });

  test(`${provider.id}: matching ignores a device without an app and suggests nothing for it`, () => {
    assert.equal(provider.matches(device()), false);
    assert.deepEqual(provider.suggestConfig(device()), {});
  });

  test(`${provider.id}: a new channel is connecting and has the contract's methods`, () => {
    const channel = provider.createChannel(options(Object.fromEntries(provider.fields.map((f) => [f.key, '10.0.0.5']))));
    assert.equal(channel.connection, 'connecting');
    for (const m of ['start', 'stop', 'send'] as const) assert.equal(typeof channel[m], 'function', m);
  });
}

test('the LG provider recognises a TV by the app that owns the device, never by its name', () => {
  const lg = getMessageProvider('lg-webos')!;
  assert.ok(LG_APP_IDS.has('com.maxvandelaar.webos-plus'));
  assert.equal(lg.matches(device({ appId: 'com.lg.webos' })), true, 'the official LG WebOS TV app');
  assert.equal(lg.matches(device({ appId: 'com.lge.thinq.appliance' })), true, 'LG ThinQ, for a device of class tv');
  assert.equal(lg.matches(device({ appId: 'com.maxvandelaar.webos-plus' })), true);
  assert.equal(lg.matches(device({ appId: 'com.example.other', name: 'LG OLED' })), false);
  assert.equal(lg.matches(device({ appId: '', name: 'LG webOS TV' })), false);
});

test('the LG provider suggests the IP address the device knows, and nothing it cannot trust', () => {
  const lg = getMessageProvider('lg-webos')!;
  const suggest = (ipAddress: unknown) => lg.suggestConfig(device({ appId: 'com.maxvandelaar.webos-plus', settings: { ipAddress } }));
  assert.deepEqual(suggest('192.168.1.50'), { host: '192.168.1.50' });
  assert.deepEqual(suggest(' 10.0.0.5 '), { host: '10.0.0.5' });
  for (const bad of ['0.0.0.0', '', undefined, null, 5, '999.1.1.1', '10.0.0', 'tv.local', '10.0.0.5.6']) {
    assert.deepEqual(suggest(bad), {}, String(bad));
  }
  assert.deepEqual(lg.suggestConfig(device({ appId: 'com.maxvandelaar.webos-plus' })), {});
});

test('the LG provider looks under a few setting names, takes the first usable address, and ignores unknown names', () => {
  const lg = getMessageProvider('lg-webos')!;
  const suggest = (settings: Record<string, unknown>) => lg.suggestConfig(device({ appId: 'com.lg.webos', settings }));
  assert.deepEqual(suggest({ ip: '192.168.1.60' }), { host: '192.168.1.60' });
  assert.deepEqual(suggest({ host: '192.168.1.61' }), { host: '192.168.1.61' });
  assert.deepEqual(suggest({ ipAddress: '0.0.0.0', ip: '192.168.1.62' }), { host: '192.168.1.62' }, 'an unusable value falls through');
  assert.deepEqual(suggest({ ipAddress: '192.168.1.1', ip: '192.168.1.2' }), { host: '192.168.1.1' }, 'the first one wins');
  assert.deepEqual(suggest({ macAddress: '10.0.0.5', name: 'x' }), {}, 'other names are never guessed');
  const thinq = lg.suggestConfig(device({ appId: 'com.lge.thinq.appliance', settings: { energy_value_off: 1, energy_value_on: 80 } }));
  assert.deepEqual(thinq, {}, 'ThinQ keeps no IP address, so the user types it');
});

test('the LG channel links, shows messages and only ever shows messages', async () => {
  const lg = new FakeLg();
  let clientOptions: { host: string; clientKey: string | undefined } | undefined;
  const saved: unknown[] = [];
  const provider = createLgMessageProvider(async (o) => {
    clientOptions = o;
    return lg as unknown as LgClientLike;
  });
  const channel = provider.createChannel({
    config: { host: '10.0.0.5' },
    credentials: 'stored-key',
    saveCredentials: (c) => saved.push(c),
    log: () => {},
  });
  const states: string[] = [];
  channel.on('connection', (c) => states.push(c));

  await channel.start();
  assert.equal(clientOptions!.host, '10.0.0.5');
  assert.equal(clientOptions!.clientKey, 'stored-key');
  lg.emit('prompt');
  assert.equal(channel.connection, 'prompt');
  lg.emit('connect');
  assert.equal(channel.connection, 'connected');
  assert.ok(lg.powerCallback, 'like the direct driver, the channel subscribes to the power state');

  await channel.send('5 minutes left');
  assert.deepEqual(lg.requests, [{ uri: 'ssap://system.notifications/createToast', payload: { message: '5 minutes left' } }]);

  await channel.stop();
  assert.equal(channel.connection, 'offline');
  assert.deepEqual(states, ['prompt', 'connected', 'offline']);
});

test('the registry finds providers by id and describes them in the user\'s language', () => {
  assert.equal(getMessageProvider('lg-webos')?.name, 'LG webOS');
  assert.equal(getMessageProvider('nope'), undefined);
  const description = describeMessageProvider(getMessageProvider('lg-webos')!, 'no');
  assert.equal(description.id, 'lg-webos');
  assert.equal(description.fields[0].key, 'host');
  assert.equal(description.fields[0].required, true);
  assert.equal(description.fields[0].label, 'TV-ens IP-adresse');
  assert.match(description.hint, /Tillat/);
});

test('the LG channel logs the TV power state, so a toast without an answer can be explained', async () => {
  const lg = new FakeLg();
  const logs: string[] = [];
  const provider = createLgMessageProvider(async () => lg as unknown as LgClientLike);
  const channel = provider.createChannel({
    config: { host: '10.0.0.5' },
    credentials: undefined,
    saveCredentials: () => {},
    log: (...args) => void logs.push(args.join(' ')),
  });
  await channel.start();
  lg.emit('connect');
  lg.power('on');
  lg.power('active_standby');
  assert.deepEqual(logs, ['TV power (message link): on', 'TV power (message link): off or standby']);
});
