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

// Kontrakten alle drivere må oppfylle. Nye drivere legges i DRIVERS og testes her uten ekstra arbeid.
const all: TvDriver[] = [...DRIVERS, createSimulatedDriver().driver];

for (const driver of all) {
  test(`${driver.id}: beskrivelsen er gyldig`, () => {
    assert.match(driver.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'id må være kebab-case med små bokstaver');
    assert.ok(driver.name.trim(), 'name må være satt');
    assert.ok(driver.fields.length > 0, 'minst ett felt');
    assert.ok(driver.fields.some((f) => f.required), 'minst ett påkrevd felt, ellers regnes TV-en som satt opp uten data');
    const keys = driver.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, 'feltnøklene må være unike');
    for (const f of driver.fields) {
      assert.ok(resolveText(f.label, 'en'), `feltet ${f.key} trenger en etikett`);
      if (typeof f.label === 'object') assert.ok(f.label.en, `feltet ${f.key} trenger en engelsk etikett`);
    }
    if (driver.hint && typeof driver.hint === 'object') assert.ok(driver.hint.en, 'hint trenger en engelsk tekst');
  });

  test(`${driver.id}: en ny tilkobling er koblet fra og TV-en regnes som av`, () => {
    const config = Object.fromEntries(driver.fields.map((f) => [f.key, 'x']));
    const tv = driver.createConnection(options(config));
    assert.equal(tv.connection, 'connecting');
    assert.equal(tv.isOn, false);
    for (const m of ['start', 'stop', 'toast', 'turnOff'] as const) assert.equal(typeof tv[m], 'function', m);
    if (driver.canWake) assert.equal(typeof tv.wake, 'function', 'canWake krever wake()');
  });
}

test('en simulert TV følger kontrakten: hendelser, av-kommando og stopp', async () => {
  const { driver, connections } = createSimulatedDriver();
  const tv = driver.createConnection(options({ name: 'Stue' }));
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
  assert.equal(tv.isOn, false, 'stop() skal la isOn være false');
  assert.deepEqual(power, [true, false, true, false]);
});

test('en TV uten kontakt regnes aldri som på', async () => {
  const { driver, connections } = createSimulatedDriver();
  const tv = driver.createConnection(options({ name: 'Stue' }));
  connections[0].simulatePower(true); // før start: ikke koblet til
  assert.equal(tv.isOn, false);
  await tv.start();
  connections[0].simulatePower(true);
  connections[0].simulateOffline();
  assert.equal(tv.isOn, false);
});

test('sanitizeConfig beholder bare driverens felt, som trimmet tekst', () => {
  const { driver } = createSimulatedDriver();
  assert.deepEqual(sanitizeConfig(driver, { name: '  Stue ', evil: 'x' }), { name: 'Stue' });
  assert.deepEqual(sanitizeConfig(driver, { name: 42 }), { name: '42' });
  assert.deepEqual(sanitizeConfig(driver, { name: { a: 1 } }), { name: '' });
  assert.deepEqual(sanitizeConfig(driver, null), { name: '' });
});

test('isConfigured krever alle påkrevde felt', () => {
  const lg = DRIVERS[0];
  assert.equal(isConfigured(lg, { host: '', mac: 'AA' }), false);
  assert.equal(isConfigured(lg, { host: '192.168.1.5', mac: '' }), true);
});

test('resolveText faller tilbake til engelsk og deretter til første tekst', () => {
  assert.equal(resolveText({ en: 'Hi', no: 'Hei' }, 'no'), 'Hei');
  assert.equal(resolveText({ en: 'Hi', no: 'Hei' }, 'fr'), 'Hi');
  assert.equal(resolveText({ no: 'Hei' }, 'fr'), 'Hei');
  assert.equal(resolveText('Plain', 'no'), 'Plain');
  assert.equal(resolveText(undefined, 'no'), '');
});

test('describeDrivers gir innstillingssiden tekst på brukerens språk', () => {
  const [lg] = describeDrivers('no');
  assert.equal(lg.id, 'lg-webos');
  assert.equal(lg.fields[0].label, 'TV-ens IP-adresse');
  assert.equal(lg.fields[0].required, true);
  assert.equal(lg.canWake, true);
  assert.match(lg.hint, /Tillat/);
});
