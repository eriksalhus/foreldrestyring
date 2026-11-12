import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { ControllerEvents, Status } from '../lib/controller.ts';
import { FLOW_CARDS, registerFlowCards } from '../lib/flow-cards.ts';
import type { FlowPort, TriggerCardPort } from '../lib/flow-cards.ts';

/** A stand-in for Homey's Flow manager: it keeps the run listeners and records what was triggered. */
class FakeCard implements TriggerCardPort {
  listener: ((args: any, state?: any) => unknown) | null = null;
  fired: Array<{ tokens?: object; state?: object }> = [];
  fail = false;

  registerRunListener(listener: (args: any, state?: any) => unknown): this {
    this.listener = listener;
    return this;
  }

  async trigger(tokens?: object, state?: object): Promise<unknown> {
    this.fired.push({ tokens, state });
    if (this.fail) throw new Error('Flow failed');
    return undefined;
  }

  run(args: object = {}, state?: object): Promise<unknown> {
    assert.ok(this.listener, 'a run listener is registered');
    return Promise.resolve(this.listener(args, state));
  }
}

class FakeFlow implements FlowPort {
  readonly cards = new Map<string, FakeCard>();
  private card(kind: string, id: string): FakeCard {
    const key = `${kind}/${id}`;
    if (!this.cards.has(key)) this.cards.set(key, new FakeCard());
    return this.cards.get(key)!;
  }
  getActionCard(id: string) {
    return this.card('actions', id);
  }
  getConditionCard(id: string) {
    return this.card('conditions', id);
  }
  getTriggerCard(id: string) {
    return this.card('triggers', id);
  }
}

function setup(status: Partial<Status> = {}, remainingMs = 30 * 60_000) {
  const flow = new FakeFlow();
  const events = new EventEmitter<ControllerEvents>();
  const calls: Array<[string, unknown]> = [];
  const errors: unknown[][] = [];
  registerFlowCards(
    flow,
    {
      getStatus: () => ({ childMode: false, locked: false, ...status }) as Status,
      getRemainingMs: () => remainingMs,
      setChildMode: (on) => (calls.push(['setChildMode', on]), {} as Status),
      addExtraTime: (minutes) => (calls.push(['addExtraTime', minutes]), {} as Status),
      reduceTime: (minutes) => (calls.push(['reduceTime', minutes]), {} as Status),
      events,
    },
    { error: (...args) => void errors.push(args) },
  );
  const card = (kind: 'actions' | 'conditions' | 'triggers', id: string) => flow.cards.get(`${kind}/${id}`)!;
  return { flow, events, calls, errors, card };
}

const { actions, conditions, triggers } = FLOW_CARDS;
const tokens = { minutesLeft: 4, minutesUsed: 26 };

test('every card id in the code has a card file in .homeycompose/flow, and every card file is used', () => {
  for (const [kind, ids] of Object.entries(FLOW_CARDS)) {
    const files = readdirSync(new URL(`../.homeycompose/flow/${kind}/`, import.meta.url)).map((f) => f.replace(/\.json$/, ''));
    assert.deepEqual([...files].sort(), Object.values(ids).sort(), kind);
  }
});

test('the card files declare the arguments and tokens the code reads', () => {
  const read = (kind: string, id: string) =>
    JSON.parse(readFileSync(new URL(`../.homeycompose/flow/${kind}/${id}.json`, import.meta.url), 'utf8'));
  assert.deepEqual(
    read('actions', actions.setChildMode).args[0].values.map((v: { id: string }) => v.id),
    ['on', 'off'],
  );
  for (const [kind, id] of [
    ['actions', actions.addExtraTime],
    ['actions', actions.removeTime],
    ['conditions', conditions.lessThanMinutesLeft],
    ['triggers', triggers.minutesLeft],
  ]) {
    const arg = read(kind, id).args[0];
    assert.deepEqual([arg.name, arg.min, arg.max], ['minutes', 1, 240], id);
  }
  for (const id of Object.values(triggers)) {
    const names = read('triggers', id).tokens.map((t: { name: string }) => t.name);
    assert.deepEqual(names, id === triggers.message ? ['text', 'minutes_left', 'minutes_used'] : ['minutes_left', 'minutes_used'], id);
  }
});

test('the actions go to the app with the values from the Flow', async () => {
  const { calls, card } = setup();
  await card('actions', actions.setChildMode).run({ state: 'on' });
  await card('actions', actions.setChildMode).run({ state: 'off' });
  await card('actions', actions.addExtraTime).run({ minutes: 15 });
  await card('actions', actions.removeTime).run({ minutes: 10 });
  assert.deepEqual(calls, [
    ['setChildMode', true],
    ['setChildMode', false],
    ['addExtraTime', 15],
    ['reduceTime', 10],
  ]);
});

test('an action fails the Flow when the app refuses the minutes', async () => {
  const flow = new FakeFlow();
  registerFlowCards(
    flow,
    {
      getStatus: () => ({}) as Status,
      getRemainingMs: () => 0,
      setChildMode: () => ({}) as Status,
      addExtraTime: () => {
        throw new Error('error.invalidMinutes');
      },
      reduceTime: () => ({}) as Status,
      events: new EventEmitter<ControllerEvents>(),
    },
    { error: () => {} },
  );
  await assert.rejects(flow.getActionCard(actions.addExtraTime).run({ minutes: 999 }), /invalidMinutes/);
});

test('the conditions read Child mode, the Lock and the exact time left', async () => {
  const on = setup({ childMode: true, locked: true }, 4.5 * 60_000);
  assert.equal(await on.card('conditions', conditions.childModeOn).run(), true);
  assert.equal(await on.card('conditions', conditions.timeIsUp).run(), true);
  assert.equal(await on.card('conditions', conditions.lessThanMinutesLeft).run({ minutes: 5 }), true, '4.5 < 5, though it rounds to 5');
  assert.equal(await on.card('conditions', conditions.lessThanMinutesLeft).run({ minutes: 4 }), false);

  const off = setup({ childMode: false, locked: false }, 4.5 * 60_000);
  assert.equal(await off.card('conditions', conditions.childModeOn).run(), false);
  assert.equal(await off.card('conditions', conditions.timeIsUp).run(), false);
  assert.equal(await off.card('conditions', conditions.lessThanMinutesLeft).run({ minutes: 5 }), true, 'ignores Child mode');
});

test('Child mode changes fire the matching trigger with the tokens', () => {
  const { events, card } = setup();
  events.emit('childMode', true, tokens);
  events.emit('childMode', false, tokens);
  const expected = [{ tokens: { minutes_left: 4, minutes_used: 26 }, state: undefined }];
  assert.deepEqual(card('triggers', triggers.childModeOn).fired, expected);
  assert.deepEqual(card('triggers', triggers.childModeOff).fired, expected);
});

test('"N minutes left" runs only the Flows whose N was crossed', async () => {
  const { events, card } = setup();
  const minutesLeft = card('triggers', triggers.minutesLeft);
  events.emit('countdown', { beforeMs: 5 * 60_000 + 2_000, afterMs: 5 * 60_000 - 3_000 }, tokens);
  const [{ state }] = minutesLeft.fired;
  assert.equal(await minutesLeft.run({ minutes: 5 }, state), true);
  assert.equal(await minutesLeft.run({ minutes: 4 }, state), false);
  assert.equal(await minutesLeft.run({ minutes: 10 }, state), false);
  assert.equal(await minutesLeft.run({ minutes: 5 }, undefined), false, 'no state, no run');
});

test('"time is up", "the TV was turned off" and "a message for the TV" fire with their tokens', () => {
  const { events, card } = setup();
  events.emit('timeUp', tokens);
  events.emit('tvTurnedOff', tokens);
  events.emit('message', 'TV time is up', tokens);
  assert.deepEqual(card('triggers', triggers.timeIsUp).fired[0].tokens, { minutes_left: 4, minutes_used: 26 });
  assert.deepEqual(card('triggers', triggers.tvTurnedOff).fired[0].tokens, { minutes_left: 4, minutes_used: 26 });
  assert.deepEqual(card('triggers', triggers.message).fired[0].tokens, {
    text: 'TV time is up',
    minutes_left: 4,
    minutes_used: 26,
  });
});

test('a trigger that Homey rejects is logged and nothing is thrown back', async () => {
  const { events, card, errors } = setup();
  card('triggers', triggers.timeIsUp).fail = true;
  assert.doesNotThrow(() => events.emit('timeUp', tokens));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /time_is_up/);
});
