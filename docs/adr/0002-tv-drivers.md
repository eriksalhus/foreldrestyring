---
status: accepted
---

# Each TV brand is a driver behind one small interface, and all drivers live in this app

The app was built around LG webOS: the Controller created a `TvClient` for lgtv2 directly, the settings had `host` and `mac`, and the settings page had hard-coded fields for them. So that others can add TVs without touching the quota logic, everything brand-specific has moved behind `TvDriver` (`lib/drivers/types.ts`). A driver describes the fields the settings page should draw, creates a `TvConnection` that says whether the TV is on, and can show a message, turn the TV off and optionally turn it on. Drivers are registered in `lib/drivers/index.ts`.

## Considered Options

- **One Homey app per brand, linked through Homey devices or Flows:** Homey apps cannot import each other, and existing TV apps vary in quality and lack reliable power state (see [0001](0001-own-homey-app-and-lock-as-repeated-turn-off.md)).
- **Drivers as separate npm packages loaded at runtime:** flexible, but Homey Pro has no safe way to install packages into a running app, and unknown code with access to the home network is undesirable.
- **One file per brand in this repository (chosen):** contributions arrive as pull requests, each driver is reviewed and tested together with the rest, and the user gets everything in one app.

## Consequences

- New TVs need a new version of the app. A driver cannot be added without publishing the app again.
- Fields are text fields only (`DriverField`). If a brand needs more (for example a PIN dialog), the contract is extended, rather than the page getting brand-specific code.
- Stored settings have `driver` and `driverConfig` instead of `host` and `mac`. Older settings are translated to `lg-webos` at startup, and the old `clientKey` is still read, so existing users notice nothing.
- Pairing data is stored per driver under `tvCredentials`.
- The contract has `isOn` and `connection` as the common language. `BaseTvConnection` makes sure a TV without contact never counts as on, otherwise the Quota would keep running.
- All drivers go through the same contract test (`tests/drivers.test.ts`), and a simulated TV makes it possible to test the Controller without hardware.
