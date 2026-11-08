---
status: accepted
---

# On-screen messages for a Homey TV come from a separate message provider that the user links once

A TV that is a Homey device (see [0003](0003-homey-device-as-power-source.md)) cannot show the app's messages ("N minutes left", "time is up"): a Homey device has no way to show text. The direct LG connection can, through SSAP. So that a Homey TV can show messages too, a **message provider** shows them through the TV's own network interface, next to the power connection. LG webOS is the first provider; the interface is platform-neutral.

## Considered Options

- **Messages from the TV driver only (status quo):** simple, but a Homey TV never shows messages, so an LG owner who adds the TV to Homey loses a feature the direct connection had.
- **Replace `toast` in the TV driver with messages from a provider for every TV:** one path for all messages, but the direct LG connection would need a shared-connection mechanism (a reference-counted pool of SSAP sessions) and every existing installation would need a settings migration, all for a path that already works.
- **A provider that supplements the TV driver (chosen):** `toast?` stays on the TV connection and the direct connection is untouched. A provider is used only for a Homey TV. The LG SSAP code is shared (`lib/lg/session.ts`), but each use opens its own connection; the settings page never offers a provider when the TV driver can show messages, so one TV never has two.
- **Prefill and connect automatically from the Homey device:** least typing, but connecting makes the TV show an "Allow" dialog on the family screen, and the settings autosave could trigger it unasked.

## Consequences

- **The user links once, on purpose.** Nothing contacts the TV until the user presses "Link to TV", and the first successful connection marks the TV as linked. Until then the on/off switch is greyed out with an explanation. Never pressing Link is the opt-out, and a switch turns messages off later. A new IP address or a different TV clears the link, because the pairing key belongs to one TV.
- **Recognition is by owning app.** A Homey TV is offered a provider only when `device.appId` is in the provider's table (for LG, `LG_APP_IDS`), never by guessing from the name. The device's own setting (`ipAddress` for the LG app we know) prefills the field when it holds a usable value. Homey device settings have no standard key, so other apps are added one by one, and a TV from an unknown app gets no message section (the direct connection is still available).
- **One pairing key.** The key is stored by provider id, and the provider and the direct driver have the same id (`lg-webos`), so switching between them does not ask for "Allow" again. "Unlink" forgets the shared key.
- **Best effort.** A message is dropped and logged, never queued, when the TV is not reachable, because a late "5 minutes left" is wrong. A failed send never affects counting, the Lock or the power connection.
- **A toast is tried first, an alert is the fallback.** On the LG OLED G2 (webOS 22, firmware 33.31.68) this was developed on, the TV registers, answers every other request and silently ignores `createToast`, with a signed or unsigned pairing, fresh or old key, direct or through a Homey device (checked with a standalone lgtv2 client that bypasses the app). LG's developer guide says third-party apps may not send notifications. `createAlert` is answered and shows a dialog with an OK button, but `closeAlert` is not, so an alert stays until someone presses OK. The shared LG session therefore waits two seconds for the toast, falls back to an alert, remembers that for the session and tries the toast again after an hour. The alternative of not showing anything on such a TV was rejected because a time warning that needs one press of OK is still a warning, and the user decided it was acceptable.
- **The on/off switch exists for both connection kinds**, on by default, so existing installations behave as before.
- The app asks Homey again every 30 seconds which provider fits the chosen TV, and rebuilds the channel only when that changes. If Homey cannot be asked at start-up, a TV that was linked before still connects, from the stored settings.
- Other platforms are not promised: only LG has a confirmed built-in way to show a message. What is known per platform is in [adding-a-message-provider.md](../adding-a-message-provider.md).
