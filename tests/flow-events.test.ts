import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Controller } from '../lib/controller.ts';
import type { ControllerEvents, Host, TvSettings } from '../lib/controller.ts';
import { createSimulatedDriver } from '../lib/drivers/simulated.ts';

/** The events the Flow triggers report, as the Controller emits them. */

function fakeHost(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const timeouts: Array<() => void> = [];
  const intervals: Array<() => void> = [];
  const errors: unknown[][] = [];
  const host: Host = {
    settings: { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) },
    log: () => {},
    error: (...args) => void errors.push(args),
    setInterval: (fn) => {
      intervals.push(fn);
      return fn;
    },
    clearInterval: () => {},
    setTimeout: (fn) => {
      timeouts.push(fn);
      return fn;
    },
    __: (key) => key,
    clock: { getTimezone: () => 'Europe/Oslo' },
    i18n: { getLanguage: () => 'no' },
  };
  return { store, timeouts, intervals, errors, host };
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
  messages: { enabled: true, provider: '', config: {}, linked: false },
  ...over,
});

type Recorded = { [K in keyof ControllerEvents]: { event: K; args: ControllerEvents[K] } }[keyof ControllerEvents];

function record(controller: Controller) {
  const events: Recorded[] = [];
  const names: Array<keyof ControllerEvents> = ['childMode', 'countdown', 'timeUp', 'tvTurnedOff', 'message'];
  for (const event of names) {
    controller.on(event, (...args: any[]) => events.push({ event, args } as Recorded));
  }
  return {
    events,
    names: () => events.map((e) => e.event),
    of: <K extends keyof ControllerEvents>(event: K) =>
      events.filter((e) => e.event === event).map((e) => e.args as ControllerEvents[K]),
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A Controller on a simulated TV, with the clock mocked to Thursday 2026-11-12 14:00 in Oslo. */
async function setupTimed(over: Partial<TvSettings> = {}, initial: Record<string, unknown> = {}) {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-12T13:00:00Z') });
  const { driver, connections } = createSimulatedDriver();
  const env = fakeHost(initial);
  const controller = new Controller(env.host, [driver]);
  const recorder = record(controller);
  await controller.start();
  await controller.configure(settings(over));
  const onTick = env.intervals[0];
  /** Moves the clock and runs one tick, like Homey's interval would. */
  const advance = (ms: number) => {
    mock.timers.tick(ms);
    onTick();
  };
  return { ...env, ...recorder, controller, tv: () => connections[connections.length - 1], advance };
}

test('Child mode changes are reported once per real change, with the tokens', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, of } = await setupTimed();
  controller.setChildMode(true);
  controller.setChildMode(true);
  controller.setChildMode(false);
  controller.setChildMode(false);
  assert.deepEqual(of('childMode'), [
    [true, { minutesLeft: 30, minutesUsed: 0 }],
    [false, { minutesLeft: 30, minutesUsed: 0 }],
  ]);
});

test('Child mode switched by the set time and by the new Quota day is reported, also with the TV off', async (t) => {
  t.after(() => mock.timers.reset());
  const { advance, of } = await setupTimed({ autoOnEnabled: true, autoOnTime: '15:00' });
  advance(61 * 60_000); // 15:01
  advance(14 * 60 * 60_000); // 05:01 the next day
  assert.deepEqual(
    of('childMode').map(([on]) => on),
    [true, false],
  );
});

test('a Child mode change that happened while the app was down is not reported at startup', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-12T15:00:00Z') }); // 16:00 in Oslo
  const { driver } = createSimulatedDriver();
  const env = fakeHost({ tvSettings: settings({ autoOnEnabled: true, autoOnTime: '15:00' }) });
  const controller = new Controller(env.host, [driver]);
  const { events } = record(controller);
  await controller.start();
  assert.equal(controller.getStatus().childMode, true);
  assert.deepEqual(events, []);
});

test('"time is up" is reported once when Remove time takes the rest, even with the TV off', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, advance, of } = await setupTimed();
  controller.setChildMode(true);
  controller.reduceTime(10);
  assert.equal(of('timeUp').length, 0);
  controller.reduceTime(1000);
  advance(5_000);
  controller.reduceTime(5);
  assert.deepEqual(of('timeUp'), [[{ minutesLeft: 0, minutesUsed: 0 }]]);
});

test('"time is up" is reported when Child mode is turned on with nothing left, after the Child mode change', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, names } = await setupTimed();
  controller.reduceTime(1000);
  assert.deepEqual(names(), [], 'without Child mode there is no Lock');
  controller.setChildMode(true);
  assert.deepEqual(names(), ['childMode', 'timeUp']);
});

test('"time is up" is reported when a lower Quota is saved on the settings page', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, of } = await setupTimed();
  controller.setChildMode(true);
  controller.reduceTime(5); // 25 left of 30
  await controller.configure(settings({ weekdayMinutes: 15, weekendMinutes: 15 })); // 10 left
  assert.equal(of('timeUp').length, 0);
  await controller.configure(settings({ weekdayMinutes: 5, weekendMinutes: 5 })); // nothing left (5 - 5)
  assert.equal(of('timeUp').length, 1);
});

test('"time is up" is reported again after Extra time has run out too', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, of } = await setupTimed();
  controller.setChildMode(true);
  controller.reduceTime(1000);
  controller.addExtraTime(1);
  controller.reduceTime(1);
  assert.equal(of('timeUp').length, 2);
});

test('"time is up" is not reported at startup when the Lock was already engaged', async (t) => {
  t.after(() => mock.timers.reset());
  const first = await setupTimed();
  first.controller.setChildMode(true);
  first.controller.reduceTime(1000);
  await first.controller.stop();

  const { driver } = createSimulatedDriver();
  const env = fakeHost(Object.fromEntries(first.store));
  const controller = new Controller(env.host, [driver]);
  const { of } = record(controller);
  await controller.start();
  env.intervals[0]();
  assert.equal(controller.getStatus().locked, true);
  assert.equal(of('timeUp').length, 0);
});

test('counting reports each whole minute it passes, then "time is up" when nothing is left', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, advance, of } = await setupTimed({ weekdayMinutes: 2, weekendMinutes: 2 });
  controller.setChildMode(true);
  tv().simulatePower(true);
  advance(1_000); // the first observation only starts counting
  for (let i = 0; i < 5; i++) advance(30_000);

  const countdown = of('countdown');
  assert.equal(countdown.length, 1, 'once at 1 minute left; 0 left is "time is up"');
  assert.deepEqual(countdown[0][1], { minutesLeft: 1, minutesUsed: 1 });
  assert.equal(countdown[0][0].beforeMs, 90_000);
  assert.equal(countdown[0][0].afterMs, 60_000);
  assert.equal(of('timeUp').length, 1);
});

test('Parent actions and a TV that is off never report a countdown', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, advance, of } = await setupTimed();
  controller.setChildMode(true);
  controller.reduceTime(25); // jumps past 10 and 5
  advance(30_000);
  advance(30_000); // the TV is off: nothing counts
  controller.setChildMode(false);
  tv().simulatePower(true);
  advance(30_000);
  advance(30_000); // Child mode is off: nothing counts
  assert.deepEqual(of('countdown'), []);
});

test('"the TV was turned off" is reported after the turn-off has succeeded, and not when it fails', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, timeouts, advance, of } = await setupTimed();
  controller.setChildMode(true);
  controller.reduceTime(1000);
  tv().simulatePower(true);
  for (const run of timeouts.splice(0)) run();
  await flush();
  assert.equal(tv().turnOffCalls, 1);
  assert.equal(of('tvTurnedOff').length, 1);

  tv().turnOff = async () => {
    throw new Error('TV did not answer');
  };
  mock.timers.tick(11_000); // past the 10 s between two turn-offs
  tv().simulatePower(true);
  advance(1_000);
  for (const run of timeouts.splice(0)) run();
  await flush();
  assert.equal(of('tvTurnedOff').length, 1);
});

test('every On-screen message is reported, also when messages are switched off', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, of } = await setupTimed({ messages: { enabled: false, provider: '', config: {}, linked: false } });
  tv().simulatePower(true);
  controller.setChildMode(true);
  assert.deepEqual(tv().toasts, [], 'switched off: nothing on the TV');
  assert.deepEqual(of('message'), [['toast.childModeOn', { minutesLeft: 30, minutesUsed: 0 }]]);
});

test('Send test message reports the message even when the TV cannot show it', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, of } = await setupTimed();
  tv().simulateOffline();
  await assert.rejects(controller.sendTestMessage());
  assert.deepEqual(
    of('message').map(([text]) => text),
    ['toast.test'],
  );
});

test('a listener that throws is logged and never stops the Lock', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, timeouts, errors } = await setupTimed();
  controller.on('timeUp', () => {
    throw new Error('broken Flow');
  });
  controller.on('message', () => {
    throw new Error('broken Flow');
  });
  tv().simulatePower(true);
  controller.setChildMode(true);
  assert.doesNotThrow(() => controller.reduceTime(1000));
  for (const run of timeouts.splice(0)) run();
  await flush();
  assert.equal(controller.getStatus().locked, true);
  assert.equal(tv().turnOffCalls, 1);
  assert.deepEqual(tv().toasts, ['toast.childModeOn', 'toast.timeUp']);
  assert.ok(errors.some(([text]) => String(text).includes('"timeUp"')));
});

test('getRemainingMs is exact, not rounded to whole minutes', async (t) => {
  t.after(() => mock.timers.reset());
  const { controller, tv, advance } = await setupTimed({ weekdayMinutes: 5, weekendMinutes: 5 });
  controller.setChildMode(true);
  tv().simulatePower(true);
  advance(1_000);
  advance(20_000);
  assert.equal(controller.getRemainingMs(), 5 * 60_000 - 20_000);
  assert.equal(controller.getStatus().remainingMinutes, 5, 'the status rounds');
});
