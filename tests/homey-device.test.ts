import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { RECONCILE_MS, homeyDevice } from '../lib/drivers/homey-device.ts';
import type { Connection } from '../lib/drivers/types.ts';
import { FakeDevices } from './fake-devices.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(fake = new FakeDevices(), deviceId = 'tv1') {
  const tv = homeyDevice.createConnection({
    config: { deviceId },
    credentials: undefined,
    saveCredentials: () => {},
    log: () => {},
    devices: fake,
  });
  const power: boolean[] = [];
  const conn: Connection[] = [];
  tv.on('power', (on) => power.push(on));
  tv.on('connection', (c) => conn.push(c));
  return { tv, fake, power, conn };
}

test('homey-device: one required device field and no toast', () => {
  assert.equal(homeyDevice.id, 'homey-device');
  assert.deepEqual(homeyDevice.fields.map((f) => [f.key, f.kind, f.required]), [['deviceId', 'device', true]]);
  const { tv } = setup();
  assert.equal(tv.toast, undefined, 'a Homey device cannot show messages');
});

test('an available TV is connected, and its on/off value is the TV state', async () => {
  const fake = new FakeDevices();
  fake.add({ on: true });
  const { tv, power, conn } = setup(fake);
  assert.equal(tv.connection, 'connecting');
  await tv.start();
  await flush();
  assert.equal(tv.connection, 'connected');
  assert.equal(tv.isOn, true);
  assert.deepEqual(conn, ['connected']);
  assert.deepEqual(power, [true]);
  await tv.stop();
});

test('power events from Homey change isOn at once', async () => {
  const fake = new FakeDevices();
  fake.add();
  const { tv, power } = setup(fake);
  await tv.start();
  await flush();
  assert.equal(tv.isOn, false);
  fake.press('tv1', true);
  assert.equal(tv.isOn, true);
  fake.press('tv1', false);
  assert.equal(tv.isOn, false);
  assert.deepEqual(power, [true, false]);
  await tv.stop();
});

test('an unavailable TV is offline and counts as off', async () => {
  const fake = new FakeDevices();
  fake.add({ on: true, available: false });
  const { tv } = setup(fake);
  await tv.start();
  await flush();
  assert.equal(tv.connection, 'offline');
  assert.equal(tv.isOn, false);
  assert.equal((tv as { missing?: boolean }).missing, false);
  await tv.stop();
});

test('a device that does not exist is offline and marked missing', async () => {
  const { tv } = setup(new FakeDevices(), 'gone');
  await tv.start();
  await flush();
  assert.equal(tv.connection, 'offline');
  assert.equal(tv.isOn, false);
  assert.equal((tv as { missing?: boolean }).missing, true);
  await tv.stop();
});

test('power events while the TV is unavailable are ignored', async () => {
  const fake = new FakeDevices();
  fake.add();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { tv } = setup(fake);
    await tv.start();
    await flush();
    fake.devices.get('tv1')!.available = false;
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.connection, 'offline');
    fake.press('tv1', true);
    assert.equal(tv.isOn, false, 'a TV we cannot reach is never on');
    await tv.stop();
  } finally {
    mock.timers.reset();
  }
});

test('the reconcile repairs a missed power event, and notices unavailable and deleted TVs', async () => {
  const fake = new FakeDevices();
  fake.add();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { tv } = setup(fake);
    await tv.start();
    await flush();
    assert.equal(tv.isOn, false);

    fake.devices.get('tv1')!.on = true; // no event reaches us
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.isOn, true, 'on is picked up without an event');

    fake.devices.get('tv1')!.available = false;
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.connection, 'offline');
    assert.equal(tv.isOn, false);

    fake.devices.get('tv1')!.available = true;
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.connection, 'connected');
    assert.equal(tv.isOn, true);

    fake.devices.delete('tv1');
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.connection, 'offline');
    assert.equal((tv as { missing?: boolean }).missing, true);
    await tv.stop();
  } finally {
    mock.timers.reset();
  }
});

test('when Homey cannot be reached the TV is offline but not missing, and it recovers', async () => {
  const fake = new FakeDevices();
  fake.add({ on: true });
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { tv } = setup(fake);
    await tv.start();
    await flush();
    assert.equal(tv.isOn, true);
    fake.unreachable = true;
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.connection, 'offline');
    assert.equal(tv.isOn, false);
    assert.equal((tv as { missing?: boolean }).missing, false);
    fake.unreachable = false;
    mock.timers.tick(RECONCILE_MS);
    await flush();
    assert.equal(tv.connection, 'connected');
    assert.equal(tv.isOn, true);
    await tv.stop();
  } finally {
    mock.timers.reset();
  }
});

test('turnOff and wake switch the Homey device, and isOn follows what Homey reports', async () => {
  const fake = new FakeDevices();
  fake.add({ on: true });
  const { tv } = setup(fake);
  await tv.start();
  await flush();
  await tv.turnOff();
  assert.deepEqual(fake.setCalls, [{ id: 'tv1', on: false }]);
  assert.equal(tv.isOn, true, 'not assumed off until the TV app says so');
  fake.press('tv1', false);
  assert.equal(tv.isOn, false);
  await tv.wake!();
  assert.deepEqual(fake.setCalls.at(-1), { id: 'tv1', on: true });
  await tv.stop();
});

test('stop leaves isOn false, stops listening and stops polling', async () => {
  const fake = new FakeDevices();
  fake.add({ on: true });
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { tv } = setup(fake);
    await tv.start();
    await flush();
    await tv.stop();
    assert.equal(tv.isOn, false);
    assert.equal(tv.connection, 'offline');
    assert.equal(fake.watchers.get('tv1')!.size, 0);
    const calls = fake.getCalls.length;
    mock.timers.tick(RECONCILE_MS * 3);
    await flush();
    assert.equal(fake.getCalls.length, calls, 'no polling after stop');
    fake.press('tv1', true);
    assert.equal(tv.isOn, false);
  } finally {
    mock.timers.reset();
  }
});

test('without access to Homey devices the connection stays offline', async () => {
  const tv = homeyDevice.createConnection({
    config: { deviceId: 'tv1' },
    credentials: undefined,
    saveCredentials: () => {},
    log: () => {},
  });
  await tv.start();
  await flush();
  assert.equal(tv.connection, 'offline');
  assert.equal(tv.isOn, false);
  await assert.rejects(tv.turnOff());
  await tv.stop();
});
