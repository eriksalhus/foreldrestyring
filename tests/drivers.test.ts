import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRIVERS, describeDrivers, isConfigured, resolveText, sanitizeConfig } from '../lib/drivers/index.ts';
import { createSimulatedDriver } from '../lib/drivers/simulated.ts';
import type { Connection, TvDriver } from '../lib/drivers/types.ts';

const options = (config: Record<string, string> = {}) => ({
  config,
  credentials: undefined,
  saveCredentials: () => {},
  log: () => {},
});

// The contract every driver must meet. New drivers are added to DRIVERS and tested here at no extra cost.
const all: TvDriver[] = [...DRIVERS, createSimulatedDriver().driver];

for (const driver of all) {
  test(`${driver.id}: the description is valid`, () => {
    assert.match(driver.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'id must be lowercase kebab-case');
    assert.ok(driver.name.trim(), 'name must be set');
    assert.ok(driver.fields.length > 0, 'at least one field');
    assert.ok(driver.fields.some((f) => f.required), 'at least one required field, otherwise the TV counts as set up without any data');
    const keys = driver.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, 'field keys must be unique');
    for (const f of driver.fields) {
      assert.ok(resolveText(f.label, 'en'), `field ${f.key} needs a label`);
      if (typeof f.label === 'object') assert.ok(f.label.en, `field ${f.key} needs an English label`);
    }
    if (driver.hint && typeof driver.hint === 'object') assert.ok(driver.hint.en, 'hint needs an English text');
  });

  test(`${driver.id}: a new connection is not connected and the TV counts as off`, () => {
    const config = Object.fromEntries(driver.fields.map((f) => [f.key, 'x']));
    const tv = driver.createConnection(options(config));
    assert.equal(tv.connection, 'connecting');
    assert.equal(tv.isOn, false);
    for (const m of ['start', 'stop', 'toast', 'turnOff'] as const) assert.equal(typeof tv[m], 'function', m);
    if (driver.canWake) assert.equal(typeof tv.wake, 'function', 'canWake requires wake()');
  });
}

test('a simulated TV follows the contract: events, turn-off and stop', async () => {
  const { driver, connections } = createSimulatedDriver();
  const tv = driver.createConnection(options({ name: 'Living room' }));
  const power: boolean[] = [];
  const conn: Connection[] = [];
  tv.on('power', (on) => power.push(on));
  tv.on('connection', (c) => conn.push(c));

  await tv.start();
  assert.deepEqual(conn, ['connected']);
  connections[0].simulatePower(true);
  assert.equal(tv.isOn, true);
  await tv.turnOff();
  assert.equal(tv.isOn, false);
  connections[0].simulatePower(true);
  await tv.stop();
  assert.equal(tv.isOn, false, 'stop() must leave isOn false');
  assert.deepEqual(power, [true, false, true, false]);
});

test('a TV without contact never counts as on', async () => {
  const { driver, connections } = createSimulatedDriver();
  const tv = driver.createConnection(options({ name: 'Living room' }));
  connections[0].simulatePower(true); // before start: not connected
  assert.equal(tv.isOn, false);
  await tv.start();
  connections[0].simulatePower(true);
  connections[0].simulateOffline();
  assert.equal(tv.isOn, false);
});

test('sanitizeConfig keeps only the driver\'s fields, as trimmed text', () => {
  const { driver } = createSimulatedDriver();
  assert.deepEqual(sanitizeConfig(driver, { name: '  Living room ', evil: 'x' }), { name: 'Living room' });
  assert.deepEqual(sanitizeConfig(driver, { name: 42 }), { name: '42' });
  assert.deepEqual(sanitizeConfig(driver, { name: { a: 1 } }), { name: '' });
  assert.deepEqual(sanitizeConfig(driver, null), { name: '' });
});

test('isConfigured requires all required fields', () => {
  const lg = DRIVERS[0];
  assert.equal(isConfigured(lg, { host: '', mac: 'AA' }), false);
  assert.equal(isConfigured(lg, { host: '192.168.1.5', mac: '' }), true);
});

test('resolveText falls back to English and then to the first text', () => {
  assert.equal(resolveText({ en: 'Hi', no: 'Hei' }, 'no'), 'Hei');
  assert.equal(resolveText({ en: 'Hi', no: 'Hei' }, 'fr'), 'Hi');
  assert.equal(resolveText({ no: 'Hei' }, 'fr'), 'Hei');
  assert.equal(resolveText('Plain', 'no'), 'Plain');
  assert.equal(resolveText(undefined, 'no'), '');
});

test('describeDrivers gives the settings page text in the user\'s language', () => {
  const [lg] = describeDrivers('no');
  assert.equal(lg.id, 'lg-webos');
  assert.equal(lg.fields[0].label, 'TV-ens IP-adresse');
  assert.equal(lg.fields[0].required, true);
  assert.equal(lg.canWake, true);
  assert.match(lg.hint, /Tillat/);
});
