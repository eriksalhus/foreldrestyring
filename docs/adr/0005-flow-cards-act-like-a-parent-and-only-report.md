---
status: accepted
---

# Flow cards act like a Parent, and triggers only report

The Homey App Store reviewers suggested Flow cards next to the Homey device as power source ([0003](0003-homey-device-as-power-source.md)). Flow cards serve two jobs. Flows **control the app**: whatever a Parent can do in the widget, a Flow can do, for example turning Child mode on when everyone leaves home. Flows also **react to the app**: a push message when time is up, or a speaker saying "5 minutes left". The second job also gives On-screen messages a brand-neutral fallback, because only LG can show them today ([0004](0004-message-providers-supplement-the-tv-driver.md)).

## Considered Options

- **A minimal set to satisfy the review:** quick, but it leaves out what makes Flows useful here, and gives a Samsung or Sony household no way to hear that time is up.
- **Flows instead of the Homey device as power source:** Flows report TV on/off and do the turn-off, and the `homey:manager:api` permission goes away. Rejected: the Lock and the Quota would be only as good as Flows each household builds by hand, and [0001](0001-own-homey-app-and-lock-as-repeated-turn-off.md) already found Flow-driven timing unreliable.
- **Cards that control the app and report what happens in it (chosen),** with the actions going through the same code as the widget and the triggers never feeding back into counting or the Lock.

## Decision

All cards are **app cards** with no device argument, because the app has one Connected TV and no Homey devices of its own.

| Kind | Card | Behaviour |
| --- | --- | --- |
| Action | Turn Child mode [on/off] | As the widget switch, including the On-screen message and the Lock when nothing is left |
| Action | Give [N] minutes of Extra time | As the widget's +, 1–240 |
| Action | Remove [N] minutes | As the widget's −, 1–240 |
| Condition | Child mode is on | Invertible |
| Condition | TV time is up | Exactly the Lock, so always false while Child mode is off |
| Condition | Less than [N] minutes left | Today's exact time left, whether or not Child mode is on |
| Trigger | Child mode was turned on / off | Only on a real change, by a Parent, a Flow, the set time or the new Quota day |
| Trigger | [N] minutes of TV time left | Only when counting crosses N, never when a Parent's action jumps past it |
| Trigger | TV time is up | Once each time the Lock engages, whatever the cause, TV on or off |
| Trigger | The TV was turned off because time is up | After each turn-off the TV driver reports as done |
| Trigger | A message for the TV | Every On-screen message the app wants to show, with its text |

Every trigger carries the tokens *minutes left* and *minutes used today*. Reset today and the settings have no cards: Reset today is a correction, and a Flow that ran it every day would quietly remove the Quota.

## Consequences

- **An action is a Parent.** The Flow actions call the same app methods as the widget's API, so the 1–240 check, the On-screen messages and the Lock are identical. The check moved from the two API files into `app.ts` so that it is written once. There is no quiet variant.
- **Triggers only report.** The Controller emits events (`ControllerEvents` in `lib/controller.ts`) after the change. A listener that throws is logged, a Flow that Homey rejects is logged, and neither can affect counting or the Lock. Nothing is queued or replayed: a Child mode change the app catches up on at startup, or a Lock that was already engaged, is not reported, because a late "5 minutes left" or "time is up" is wrong.
- **"Time is up" is a moment, not the state.** The Lock is a state, and the app turns the TV off every time it sees it on. The trigger fires when the Lock goes from off to on, checked after every change that can affect it (counting, Parent actions, a lower Quota on the settings page). "The TV was turned off" is the repeated event.
- **Each Flow has its own N.** The Controller reports a countdown only when counting passes a whole minute, at most once a minute while the TV is on in Child mode. Each "[N] minutes left" Flow then checks whether its own N was crossed. "0 minutes left" is not a countdown: that is "time is up".
- **The message trigger is the fallback for every brand.** It fires for every On-screen message, also when the TV cannot show it or messages are switched off, and for **Send test message**. The text is in Homey's language, as the TV would have shown it. The settings page does not change: a household without a message provider tests its Flow with the test button in Homey's Flow editor.
- The cards live in `.homeycompose/flow/` in nine languages, and `lib/flow-cards.ts` connects them to the Controller through a narrow port, so tests need no Homey.
