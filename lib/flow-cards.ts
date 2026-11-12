import type { EventEmitter } from 'node:events';
import type { ControllerEvents, FlowTokens, Status } from './controller.ts';
import { crossedMinutesLeft } from './quota.ts';

/**
 * The app's Flow cards. They are app cards, with no device argument, because there is one Connected TV.
 * Actions do exactly what the same widget button does. Triggers only report what the Controller emits, best effort:
 * a Flow that fails is logged and changes nothing in the app. The cards are defined in `.homeycompose/flow/`.
 */

/** The part of a Homey Flow card this file uses. */
export interface FlowCardPort {
  registerRunListener(listener: (args: any, state?: any) => unknown): unknown;
}

export interface TriggerCardPort extends FlowCardPort {
  trigger(tokens?: object, state?: object): Promise<unknown>;
}

/** The part of Homey's Flow manager (`homey.flow`) this file uses. */
export interface FlowPort {
  getActionCard(id: string): FlowCardPort;
  getConditionCard(id: string): FlowCardPort;
  getTriggerCard(id: string): TriggerCardPort;
}

/** What the cards act on: the app, which checks the minutes like the widget's API does, and the Controller's events. */
export interface FlowTarget {
  getStatus(): Status;
  getRemainingMs(): number;
  setChildMode(on: boolean): Status;
  addExtraTime(minutes: unknown): Status;
  reduceTime(minutes: unknown): Status;
  /** The Controller, whose events the triggers report. */
  events: EventEmitter<ControllerEvents>;
}

/** Card ids, as the files in `.homeycompose/flow/` are named. */
export const FLOW_CARDS = {
  actions: { setChildMode: 'set_child_mode', addExtraTime: 'add_extra_time', removeTime: 'remove_time' },
  conditions: { childModeOn: 'child_mode_is_on', timeIsUp: 'time_is_up', lessThanMinutesLeft: 'less_than_minutes_left' },
  triggers: {
    childModeOn: 'child_mode_turned_on',
    childModeOff: 'child_mode_turned_off',
    minutesLeft: 'minutes_left',
    timeIsUp: 'time_is_up',
    tvTurnedOff: 'tv_turned_off_time_up',
    message: 'tv_message',
  },
} as const;

/** The tokens as the trigger cards declare them. */
function tokens(t: FlowTokens): { minutes_left: number; minutes_used: number } {
  return { minutes_left: t.minutesLeft, minutes_used: t.minutesUsed };
}

export function registerFlowCards(
  flow: FlowPort,
  target: FlowTarget,
  log: { error(...args: unknown[]): void },
): void {
  const { actions, conditions, triggers } = FLOW_CARDS;

  flow.getActionCard(actions.setChildMode).registerRunListener(async (args) => {
    target.setChildMode(args.state === 'on');
  });
  flow.getActionCard(actions.addExtraTime).registerRunListener(async (args) => {
    target.addExtraTime(args.minutes);
  });
  flow.getActionCard(actions.removeTime).registerRunListener(async (args) => {
    target.reduceTime(args.minutes);
  });

  flow.getConditionCard(conditions.childModeOn).registerRunListener(async () => target.getStatus().childMode);
  flow.getConditionCard(conditions.timeIsUp).registerRunListener(async () => target.getStatus().locked);
  flow
    .getConditionCard(conditions.lessThanMinutesLeft)
    .registerRunListener(async (args) => target.getRemainingMs() < Number(args.minutes) * 60_000);

  const fire = (id: string, card: TriggerCardPort, values: object, state?: object) => {
    card.trigger(values, state).catch((err) => log.error(`Flow trigger "${id}" failed:`, err instanceof Error ? err.message : err));
  };

  const childModeOn = flow.getTriggerCard(triggers.childModeOn);
  const childModeOff = flow.getTriggerCard(triggers.childModeOff);
  target.events.on('childMode', (on, t) => {
    if (on) fire(triggers.childModeOn, childModeOn, tokens(t));
    else fire(triggers.childModeOff, childModeOff, tokens(t));
  });

  const minutesLeft = flow.getTriggerCard(triggers.minutesLeft);
  // Each Flow has its own N: it runs only when counting crossed that N.
  minutesLeft.registerRunListener(async (args, state) =>
    Boolean(state) && crossedMinutesLeft(state.beforeMs, state.afterMs, Number(args.minutes)),
  );
  target.events.on('countdown', (range, t) => fire(triggers.minutesLeft, minutesLeft, tokens(t), range));

  const timeIsUp = flow.getTriggerCard(triggers.timeIsUp);
  target.events.on('timeUp', (t) => fire(triggers.timeIsUp, timeIsUp, tokens(t)));

  const tvTurnedOff = flow.getTriggerCard(triggers.tvTurnedOff);
  target.events.on('tvTurnedOff', (t) => fire(triggers.tvTurnedOff, tvTurnedOff, tokens(t)));

  const message = flow.getTriggerCard(triggers.message);
  target.events.on('message', (text, t) => fire(triggers.message, message, { text, ...tokens(t) }));
}
