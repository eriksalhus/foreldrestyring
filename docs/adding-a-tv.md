# Adding support for a new TV

The app counts how long the TV has been on, and turns it off when the daily Quota is used up. Everything about *which brand* of TV that is lives in one small file, a **TV driver** (see [GLOSSARY.md](../GLOSSARY.md); the glossary is in Norwegian, so here is the short version: *Child mode* = the quota is active, *Quota* = minutes of TV per day, *the Lock* = the TV is turned off whenever it is on and the Quota is spent).

A driver does four things: connects to the TV, tells the app whether the TV is on, shows a short message on screen, and turns the TV off. Everything else (quota, schedule, settings page, widget, Flows) works for every brand without changes.

## The 15-minute version

1. Copy `lib/drivers/simulated.ts` to `lib/drivers/<brand>.ts` and rename things.
2. Fill in `id`, `name`, `fields` and `hint` (see below).
3. Implement `start`, `stop`, `toast`, `turnOff`, and `wake` if the brand supports it.
4. Add the driver to `DRIVERS` in `lib/drivers/index.ts`.
5. `npm test` and `npm run typecheck`. The tests in `tests/drivers.test.ts` check every driver in `DRIVERS` automatically.
6. Try it on a real TV with `homey app run`. Pick your brand in the app's settings.

The contract itself, with a comment on every member, is in [`lib/drivers/types.ts`](../lib/drivers/types.ts). The working example for LG is [`lib/drivers/lg-webos.ts`](../lib/drivers/lg-webos.ts).

## What you write

```ts
import { BaseTvConnection } from './base.ts';
import type { TvDriver } from './types.ts';

class AcmeConnection extends BaseTvConnection {
  async start() {
    const { ip, pin } = this.options.config;               // what the user typed in settings
    const token = this.options.credentials as string | undefined; // what you saved last time
    // connect to the TV, reconnect by yourself when it drops, then call:
    //   this.setConnection('connected');
    //   this.setOn(true | false);   // whenever the TV is switched on or off
  }
  async stop() { /* close sockets, stop timers */ this.setOn(false); }
  async toast(message: string) { /* show message on screen */ }
  async turnOff() { /* standby */ }
  async wake() { /* optional: Wake-on-LAN or similar */ }
}

export const acme: TvDriver = {
  id: 'acme',                 // lowercase kebab-case, stored in users' settings: never rename it
  name: 'Acme Smart TV',
  canWake: true,              // only if you implemented wake()
  hint: { en: 'Enable "Remote control over IP" on the TV.' },
  fields: [
    { key: 'ip', label: { en: 'TV IP address' }, required: true, inputMode: 'decimal' },
    { key: 'pin', label: { en: 'PIN shown on the TV' }, inputMode: 'numeric' },
  ],
  createConnection: (options) => new AcmeConnection(options),
};
```

### Fields

`fields` is all the settings page knows about your TV. It draws one text input per field, in the user's language, and the values arrive in `options.config` as trimmed strings. The TV counts as set up when every `required` field is filled in. If your TV needs more than text inputs, open an issue and we will extend the contract rather than work around it.

Texts (`label`, `hint`, the driver `hint`) are either a plain string or a map from language code to text. Only `en` is required; the app falls back to it. The app ships in `en`, `no`, `nl`, `de`, `sv`, `da`, `fr`, `it` and `es`, and translations are welcome but not required for a first version.

### Connection state

| `connection` | Meaning |
| --- | --- |
| `connecting` | Trying to reach the TV. |
| `prompt` | Reached, but the user must approve on the TV, for example press "Allow" or enter a PIN. The settings page tells them to look at the TV. |
| `connected` | Ready. `isOn` can be trusted. |
| `offline` | Lost or unreachable. Keep retrying. |

Rules the app relies on:

- **A TV the app cannot reach is not on.** `BaseTvConnection.setOn()` enforces this: it ignores `true` unless the connection is `connected`. Call `setConnection('connected')` before the first `setOn()`.
- **Standby is off; screen-off and screensaver are on.** The point is "is the TV drawing the family's attention", but a TV that is merely dimmed has not been turned off. Map your platform's power states accordingly (LG: `on`, `screen_off`, `screen_saver` count as on).
- **Reconnect by yourself.** The app calls `start()` once. It does not retry for you.
- **Never throw from an event handler.** Log with `this.options.log(...)` and set the state to `offline`.
- **`turnOff()` must work while the TV is showing anything**, including a full-screen app. It is called repeatedly: that is how the Lock works.
- Do not use anything that needs a build step or native code. Homey Pro runs the app as is.

### Pairing data

If the TV hands out a key or token once the user approves, save it with `this.options.saveCredentials(value)`. The app stores it per driver and gives it back as `options.credentials` next time, so the user is asked only once. Anything JSON-serialisable works.

## Testing

`tests/drivers.test.ts` runs a contract check on every driver in `DRIVERS`: valid id, unique field keys, labels in English, and a fresh connection that starts as `connecting` and not on. You get that for free.

The behaviour of your own protocol you test yourself, against a fake of the TV's network API. Keep those tests next to the others, as `tests/<brand>.test.ts`. They run with `npm test` and must not need a real TV or network.

To try the whole app without hardware, the simulated driver in `lib/drivers/simulated.ts` is a TV that exists only in memory. The Controller tests in `tests/controller.test.ts` show how to drive it.

## Before you open a pull request

- `npm test` and `npm run typecheck` pass.
- You have tried it on a real TV, and the pull request says which model and firmware.
- The driver does not log secrets (tokens, PINs).
- If you added an npm dependency, say why. Prefer a small, maintained package, or the platform's own `fetch`/`WebSocket`.
