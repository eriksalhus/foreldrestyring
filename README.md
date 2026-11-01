# TV Parental Control

A [Homey Pro](https://homey.app) app that gives your TV a daily time quota, controlled from your phone. Supported TVs: **LG webOS**. More brands can be added as TV drivers, and contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

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

Each brand is one file in `lib/drivers/` that fulfils the contract in `lib/drivers/types.ts`. Quota, Child mode, settings page and widget work unchanged for every brand. The steps are in [docs/adding-a-tv.md](docs/adding-a-tv.md), and the choice is explained in [ADR 0002](docs/adr/0002-tv-drivers.md).

## Setting up the TV (LG G2, webOS 22)

1. Turn on "LG Connect Apps" and "Turn on via Wi-Fi" (Wake-on-LAN) in the TV settings.
2. Give the TV a fixed IP address in your router, preferably on a cable.
3. Open the app's settings in Homey: enter the IP address and MAC address, press "Save", and press "Allow" on the TV.
4. Put the "Child mode" widget on a Homey dashboard.

## License

[MIT](LICENSE).
