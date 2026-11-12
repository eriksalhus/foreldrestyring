import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomeyDevices } from '../lib/homey-devices.ts';
import type { ApiDevice as Dev, HomeyApi } from '../lib/homey-devices.ts';

const device = (over: Partial<Dev> & { id: string }): Dev =>
  ({
    name: over.id,
    zone: 'z1',
    class: 'tv',
    capabilities: ['onoff', 'volume_set'],
    capabilitiesObj: { onoff: { value: false } },
    available: true,
    ownerUri: 'homey:app:com.example.tv',
    settings: { ipAddress: '10.0.0.7' },
    makeCapabilityInstance: () => ({ destroy() {} }),
    ...over,
  }) as Dev;

function fakeApi(devices: Dev[]) {
  const calls: Array<{ deviceId: string; capabilityId: string; value: boolean }> = [];
  const instances: Array<{ id: string; listener: (v: unknown) => void; destroyed: boolean }> = [];
  const byId = Object.fromEntries(devices.map((d) => [d.id, d]));
  const api: HomeyApi = {
    devices: {
      getDevices: async () => byId,
      getDevice: async ({ id }) => {
        const found = byId[id];
        if (!found) throw Object.assign(new Error('Not Found'), { statusCode: 404 });
        return {
          ...found,
          makeCapabilityInstance: (capabilityId, listener) => {
            const instance = { id: capabilityId, listener, destroyed: false };
            instances.push(instance);
            return { destroy: () => void (instance.destroyed = true) };
          },
        };
      },
      setCapabilityValue: async (opts) => void calls.push(opts),
    },
    zones: { getZones: async () => ({ z1: { id: 'z1', name: 'Living room' } }) },
  };
  return { api, calls, instances };
}

test('list offers only TVs with onoff, honours a class the user overrode, and names the zone', async () => {
  const { api } = fakeApi([
    device({ id: 'tv', name: 'LG', capabilitiesObj: { onoff: { value: true } } }),
    device({ id: 'plug', class: 'socket' }),
    device({ id: 'tv-no-onoff', capabilities: ['volume_set'] }),
    device({ id: 'speaker-as-tv', class: 'speaker', virtualClass: 'tv' }),
    device({ id: 'tv-as-lamp', class: 'tv', virtualClass: 'light' }),
  ]);
  const list = await new HomeyDevices(async () => api).list();
  assert.deepEqual(list.map((d) => d.id).sort(), ['speaker-as-tv', 'tv']);
  assert.deepEqual(list.find((d) => d.id === 'tv'), {
    id: 'tv',
    name: 'LG',
    zone: 'Living room',
    on: true,
    available: true,
    appId: 'com.example.tv',
    settings: { ipAddress: '10.0.0.7' },
  });
});

test('get gives the state, null for a removed device, and rejects for other errors', async () => {
  const { api } = fakeApi([device({ id: 'tv', available: false, capabilitiesObj: { onoff: { value: true } } })]);
  const devices = new HomeyDevices(async () => api);
  assert.deepEqual(await devices.get('tv'), {
    id: 'tv',
    name: 'tv',
    zone: '',
    on: true,
    available: false,
    appId: 'com.example.tv',
    settings: { ipAddress: '10.0.0.7' },
  });
  assert.equal(await devices.get('gone'), null);

  api.devices.getDevice = async () => {
    throw Object.assign(new Error('Timeout'), { statusCode: 504 });
  };
  await assert.rejects(devices.get('tv'), /Timeout/);
});

test('a device that stopped being a controllable TV counts as gone', async () => {
  const { api } = fakeApi([device({ id: 'tv', capabilities: [] })]);
  assert.equal(await new HomeyDevices(async () => api).get('tv'), null);
});

test('setOn writes the onoff capability of that device', async () => {
  const { api, calls } = fakeApi([device({ id: 'tv' })]);
  const devices = new HomeyDevices(async () => api);
  await devices.setOn('tv', false);
  await devices.setOn('tv', true);
  assert.deepEqual(calls, [
    { deviceId: 'tv', capabilityId: 'onoff', value: false },
    { deviceId: 'tv', capabilityId: 'onoff', value: true },
  ]);
});

test('watchPower reports onoff changes until the returned function is called', async () => {
  const { api, instances } = fakeApi([device({ id: 'tv' })]);
  const seen: boolean[] = [];
  const stop = await new HomeyDevices(async () => api).watchPower('tv', (on) => seen.push(on));
  assert.equal(instances[0].id, 'onoff');
  instances[0].listener(true);
  instances[0].listener(false);
  assert.deepEqual(seen, [true, false]);
  stop();
  assert.equal(instances[0].destroyed, true);
});

test('the Web API client is created once, and again after a failure', async () => {
  const { api } = fakeApi([device({ id: 'tv' })]);
  let created = 0;
  let failNext = true;
  const devices = new HomeyDevices(async () => {
    created++;
    if (failNext) {
      failNext = false;
      throw new Error('permission not granted');
    }
    return api;
  });
  await assert.rejects(devices.list(), /permission/);
  await devices.list();
  await devices.list();
  assert.equal(created, 2);
});
