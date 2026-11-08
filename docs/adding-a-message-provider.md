# Adding On-screen messages for a new kind of TV

The app can show short **On-screen messages** on the TV: the minutes left, a welcome when the TV is switched on, and "time is up" (see [GLOSSARY.md](../GLOSSARY.md)). A TV that is connected by a TV driver with `toast()` shows them by itself. A TV that is a **Homey device** cannot, because a Homey device has no way to show text. For those, a **message provider** shows the messages through the TV's own network interface.

A message provider does one thing: it opens a link to one kind of TV and sends it a short text. Everything else (when a message is due, the switch, the Link button, the settings page) is the same for every provider.

Messages are a supplement. They never affect counting, the Lock or the power connection, and they are dropped, never queued, when the TV cannot be reached.

## What is known per platform

Only LG webOS has a built-in way to show a message over the network that we have confirmed. The others are research notes, not promises. Please verify on a real TV before building on them.

| Platform | What we found | Status |
| --- | --- | --- |
| **LG webOS** | SSAP `ssap://system.notifications/createToast` over a secure websocket. Needs the TV's IP address and a one-time "Allow" on the TV; "LG Connect Apps" must be on. Some TVs ignore the toast without any answer (an OLED G2 on webOS 22, firmware 33.31.68, does); `createAlert` is answered and shows a dialog with an OK button that cannot be closed from software, and the shared session falls back to it. | Implemented in `lib/messages/lg-webos.ts` and `lib/lg/session.ts`. Toast or alert depends on the TV. |
| **Android TV / Fire TV** | No built-in way. The "Notifications for Android TV" app, installed on the TV with overlay permission, shows a message over any running app and takes an HTTP request ([Home Assistant integration](https://www.home-assistant.io/integrations/nfandroidtv/)). | Possible, but the user must install an app on the TV. The most promising next provider, and it needs no persistent socket. |
| **Samsung Tizen** | The WebSocket remote control (port 8002, with a pairing prompt) is well documented. No message API turned up. | Unverified. |
| **Sony Bravia** | A JSON-RPC REST API exists ([Sony docs](https://pro-bravia.sony.net/remote-display-control/rest-api/guide/)). No way to show custom text turned up. | Unverified. |
| **Hisense (VIDAA), Philips** | Nothing found. | Unknown. |

## The 15-minute version

1. Copy `lib/messages/simulated.ts` to `lib/messages/<platform>.ts` and rename things.
2. Fill in `id`, `name`, `hint` and `fields` (usually just the TV's IP address).
3. Implement `matches` and `suggestConfig` (see below).
4. Implement a channel with `start`, `stop` and `send`.
5. Add the provider to `MESSAGE_PROVIDERS` in `lib/messages/index.ts`.
6. `npm test` and `npm run typecheck`. `tests/messages.test.ts` checks every provider in `MESSAGE_PROVIDERS` automatically.
7. Try it on a real TV with `homey app run`: add the TV to Homey, pick it in the app's settings, enter the IP address, press "Link to TV".

The contract, with a comment on every member, is in [`lib/messages/types.ts`](../lib/messages/types.ts). The working example is [`lib/messages/lg-webos.ts`](../lib/messages/lg-webos.ts).

## Recognising a TV: `matches` and `suggestConfig`

The settings page offers messages only for a Homey TV that a provider recognises, and it recognises it by **the app that owns the device**, never by guessing from the device's name.

- `matches(device)` returns true when `device.appId` is an app your provider can show messages on. `device.appId` is the Homey app id, for example `com.maxvandelaar.webos-plus`. Find it in that app's `app.json`. For LG, add the app id to `LG_APP_IDS`.
- `suggestConfig(device)` returns field values the device already knows, so the user does not retype them. Homey device settings are defined by each app, so there is no standard key: read the key your platform's app uses, and return nothing you cannot trust (an empty value, `0.0.0.0`). The user can always change the value.

An unrecognised TV simply gets no message section. The user can still connect an LG TV directly by IP address, where messages work without a provider.

## The channel

```ts
class AcmeChannel extends EventEmitter implements MessageChannel {
  connection: Connection = 'connecting';
  async start() {
    const { host } = this.options.config;                          // what the user entered
    const key = this.options.credentials as string | undefined;     // what you saved last time
    // Connect and keep reconnecting by yourself. Report what the user sees:
    //   'prompt'    the TV waits for the user to approve (shown as "Press Allow on the TV")
    //   'connected' ready; the first time this is reached the TV counts as linked
    //   'offline'   unreachable, for example a TV in standby
    //   'connecting' trying
  }
  async stop() { /* close sockets, stop timers */ }
  async send(text: string) { /* show the text on screen */ }
}
```

- **Nothing may contact the TV before `start()`.** The app calls `start()` only after the user has pressed Link, or for a TV that was linked before. Connecting often makes the TV show an approval dialog on the family screen, so never connect on your own.
- **A channel need not hold a socket.** An HTTP provider can set `connected` as soon as it has started and send one request per message.
- **Reconnect by yourself.** The app calls `start()` once.
- **Pairing data** goes through `this.options.saveCredentials(value)`. It is stored under the provider's id, and the app gives it back as `options.credentials`. If a TV driver has the same id (as `lg-webos` does), they share the key, so the user presses "Allow" only once. "Unlink" forgets it.
- **Never throw from an event handler.** Log with `this.options.log(...)` and report `offline`.
- Do not log secrets (tokens, PINs).

## What the app does with it

- The switch "Show messages on the TV" (on by default) turns the channel off completely when off.
- A new IP address, or a different TV, clears the link: the key belongs to one TV, and the user presses Link again.
- When a message is due and the channel is not `connected`, the message is dropped and logged. A "5 minutes left" that arrives late would be wrong.
- A failed `send` is logged. It never affects counting, the Lock or the power connection.

## Testing

`tests/messages.test.ts` runs a contract check on every provider in `MESSAGE_PROVIDERS`: valid id, text fields with English labels, a fresh channel that starts as `connecting`, and no match for a device without an app. The behaviour of your own protocol you test against a fake of the TV's network API, as `tests/lg-session.test.ts` does for LG. They must not need a real TV or network.

`lib/messages/simulated.ts` is a provider that exists only in memory. `tests/messages-controller.test.ts` shows how to drive the whole flow (Link, the Allow prompt, standby, unlink) without hardware.

## Before you open a pull request

- `npm test` and `npm run typecheck` pass.
- You have tried it on a real TV, and the pull request says which model and firmware.
- The table above is updated with what you found.
- If you added an npm dependency, say why.
