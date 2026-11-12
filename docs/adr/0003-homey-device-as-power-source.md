---
status: accepted
---

# A TV that is already a Homey device is a second way to reach the Connected TV, next to the direct drivers

[0001](0001-own-homey-app-and-lock-as-repeated-turn-off.md) rejected existing TV apps because their power state is unreliable, and [0002](0002-tv-drivers.md) put each brand behind a TV driver in this app. That serves LG webOS well, but every other brand needs someone to write and maintain a driver. The Homey App Store reviewers asked for the obvious alternative: let the user pick a TV that is already a device in Homey, of any brand, and use that device's on/off state. This adds a `homey-device` TV driver that does exactly that. The direct LG webOS driver stays.

## Considered Options

- **Direct drivers only (status quo):** deterministic power state and Wake-on-LAN, but one driver per brand, and the reviewers do not want another separate LG connection.
- **Homey device only:** one code path for every brand and no pairing in this app, but the Lock becomes only as good as a third-party app's `onoff`, which is exactly what 0001 distrusted, and messages on screen are lost.
- **Both (chosen):** the user picks a TV in Homey, or an LG TV by IP address, from one "Connected TV" list. New installations start on the Homey device; existing installations keep their LG settings untouched.

## Consequences

- The app now has the `homey:manager:api` permission (full access to Homey) and depends on `homey-api`. It is needed to read and switch devices that belong to other apps; the app lists devices only to find TVs and acts only on the TV the user chose. The permission applies to every installation, including those that only use the direct LG connection, and the README explains it. The Homey reviewers themselves suggested the permission and said it can be justified here; `homey app validate` warns that it means a more thorough review.
- The Lock with a Homey device is only as quick and accurate as the app that added the TV to Homey. The README says so and points to the direct connection when the Lock misses.
- The power state is kept fresh by `onoff` events plus a read of the device every 30 seconds, so one missed event cannot leave the TV counted as on or off for long. A device that is unavailable, deleted or unreachable is `offline`, which never counts as TV time. A deleted device is shown as missing in the settings; the app never switches to another TV by itself.
- The driver contract grows by three things and nothing else: `toast` is optional (a Homey device cannot show messages), a field can be of kind `device`, and drivers get a narrow `TvDevices` port instead of the whole Homey object, so tests need no Homey.
- On-screen messages ("N minutes left", "time is up") exist only with the direct LG connection for now. Making messages a separate, platform-neutral capability, and adding Flow cards, are planned as later steps.
