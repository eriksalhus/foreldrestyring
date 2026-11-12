# TV Parental Control

A [Homey Pro](https://homey.app) app that gives your TV a daily time quota, controlled from your phone. Works with **any TV that is already a device in Homey**, and with **LG webOS** TVs directly by IP address. More brands can be added as TV drivers, and contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

When Child mode is on, the app counts how long the TV is switched on. When the Quota is used up, the TV is turned off and stays locked until a parent gives extra time or turns Child mode off. A dashboard widget shows the time left and lets both parents turn Child mode on or off, give or remove time, and see how much has been used today and this week. The app and its settings page are available in English, Norwegian, Dutch, German, Swedish, Danish, French, Italian and Spanish.

The project's shared vocabulary is defined in [GLOSSARY.md](GLOSSARY.md), and the main design decisions are in [docs/adr](docs/adr).

## Development

```sh
npm install
npm test            # unit tests for the quota logic, the Controller and the TV drivers
npm run typecheck
homey app validate  # builds and validates
homey app run       # runs on the selected Homey (needs Docker), logs in the terminal
homey app install   # installs permanently on the selected Homey
```

`app.json` is generated from `.homeycompose/app.json` by `homey app build`. Edit `.homeycompose/app.json`.

## Adding a TV brand

Messages on the TV for a Homey device work the same way: one file in `lib/messages/` that fulfils the contract in `lib/messages/types.ts`, described in [docs/adding-a-message-provider.md](docs/adding-a-message-provider.md) and explained in [ADR 0004](docs/adr/0004-message-providers-supplement-the-tv-driver.md).

Each brand is one file in `lib/drivers/` that fulfils the contract in `lib/drivers/types.ts`. Quota, Child mode, settings page and widget work unchanged for every brand. The steps are in [docs/adding-a-tv.md](docs/adding-a-tv.md), and the choice is explained in [ADR 0002](docs/adr/0002-tv-drivers.md).

## Setting up the TV

Open the app's settings in Homey and choose the TV in the **Connected TV** list. Changes are saved automatically. Then put the "Child mode" widget on a Homey dashboard.

### A TV that is already in Homey (any brand)

1. Add the TV to Homey with the TV brand's own Homey app, if you have not already.
2. In the app's settings, pick it in the **Connected TV** list. New installations preselect the first TV found.

The app reads the device's on/off state and switches it off (and on) through that device. This works with every TV brand Homey supports, but how quickly and reliably the Lock reacts depends on the app that added the TV to Homey, because this app only sees what that app reports. If the Lock misses, use the direct connection below. A Homey device cannot show messages on the TV by itself ("5 minutes left", "time is up"), but an LG TV added through a supported LG app can show them after a one-time link: see below. Only devices that Homey classes as a TV and that can be switched on and off are listed.

### On-screen messages for an LG TV that is in Homey

When the chosen TV was added through a supported LG app (today the official "LG WebOS TV" app, `com.lg.webos`, the community app "WebOS Plus", `com.maxvandelaar.webos-plus`, and "LG ThinQ", `com.lge.thinq.appliance`), the **Connected TV** section also offers messages on the TV screen. They need a one-time link between this app and the TV:

1. On the TV, turn on "LG Connect Apps" and give the TV a fixed IP address in your router.
2. In the app's settings, check the TV's IP address. It is filled in from the Homey device when that knows it (LG ThinQ does not, so type it).
3. Press **Link to TV**, then press "Allow" on the TV with the remote.
4. The switch **Show messages on the TV** is now active. It is on by default, and you can turn it off at any time.
5. Press **Send test message** to see a message on the TV right away. Real messages appear only while the TV is on: when Child mode is switched on (with the minutes left) or off, by a Parent or automatically, and while Child mode is on, about 8 seconds after the TV is switched on, when 5 and 1 minutes are left, and when the time is up. The test button is there for the direct connection too.

On-screen messages are a toast that fades by itself, so nobody has to press anything. If **Send test message** says the TV is connected but did not show the message, the TV's notification service has most likely hung. The OLED G2 (webOS 22, firmware 33.31.68) this was developed on once kept answering every other request but never answered a toast, from the app or from any other client. Unplugging it from the wall for a minute fixed it, on the same firmware. Turning it off with the remote is not enough when Quick Start+ is on. The app waits two seconds for the TV's answer and then says so instead of failing vaguely. LG also offers an alert dialog, but someone has to press OK on it, so the app does not use it.

Nothing contacts the TV until you press **Link to TV**, so never pressing it is a way to opt out of messages. Messages are a supplement: they never affect counting or the Lock, and a message that cannot be shown right away because the TV is in standby or unreachable is skipped, not shown late. A TV that was added through another app shows a note that messages are not available for it yet, with the name of the app; use the direct connection below, or see [docs/adding-a-message-provider.md](docs/adding-a-message-provider.md) to add support for that app.

### LG webOS directly, by IP address (tested on an LG G2, webOS 22)

1. Turn on "LG Connect Apps" and "Turn on via Wi-Fi" (Wake-on-LAN) in the TV settings.
2. Give the TV a fixed IP address in your router, preferably on a cable.
3. In the app's settings, choose **By IP address (LG webOS)**, enter the IP address and MAC address, and press "Allow" on the TV.

This talks to the TV itself, so the power state is immediate and Wake-on-LAN works, and the app shows messages on the TV without a separate link (the **Show messages on the TV** switch is there too). It does not need the TV to be a device in Homey.

## Why this app asks for full access to Homey

The app has the `homey:manager:api` permission, which Homey describes as full access to Homey. It is needed to see and switch TVs that other apps have added to Homey, and Homey has no narrower permission for that. The app lists your devices only to find TVs and show them in the **Connected TV** list, and it reads and switches only the TV you pick. It changes no other device, flow or setting, and nothing leaves your Homey. The permission applies to every installation, including those that only use the direct LG connection. The code that uses it is [`lib/homey-devices.ts`](lib/homey-devices.ts), and the decision is in [ADR 0003](docs/adr/0003-homey-device-as-power-source.md).

## License

[MIT](LICENSE).
