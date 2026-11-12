import type { EventEmitter } from 'node:events';

/**
 * The contract between the app and one TV brand. To support a new TV, implement `TvDriver`
 * (see docs/adding-a-tv.md) and add it to `DRIVERS` in `./index.ts`. Nothing else in the app
 * knows which brand is in use: quota, Child mode and the settings page work through this contract.
 */

/**
 * Where the link to the TV is:
 * - `connecting`: trying to reach the TV
 * - `prompt`: reached, but the user must approve on the TV (e.g. press "Allow" with the remote)
 * - `connected`: ready; `isOn` is trustworthy
 * - `offline`: lost or unreachable, will be retried by the driver
 */
export type Connection = 'connecting' | 'prompt' | 'connected' | 'offline';

/** Text shown to the user. A plain string, or a map from language code to text. `en` is the fallback. */
export type LocalizedText = string | Readonly<Record<string, string>>;

/** One input on the settings page, e.g. an IP address. Values are always strings. */
export interface DriverField {
  /** Key in `DriverOptions.config`. Unique within the driver. */
  key: string;
  /**
   * `text` (default) is a text box. `device` is a choice among the TVs in Homey: the settings page fills it from
   * `TvDevices.list()` and stores the device id. A driver with a `device` field needs `DriverOptions.devices`.
   */
  kind?: 'text' | 'device';
  label: LocalizedText;
  placeholder?: string;
  hint?: LocalizedText;
  /** The TV counts as set up only when every required field is filled in. */
  required?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
}

/**
 * Thrown when a TV accepted the connection but did not show a message: it stayed silent on the request. An LG TV
 * whose notification service has hung does this with toasts. Drivers and message providers throw it so the app can
 * say so plainly.
 */
export class MessageIgnoredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageIgnoredError';
  }
}

/** A TV that exists as a device in Homey. */
export interface TvDeviceInfo {
  /** Homey's id for the device. This is what a `device` field stores. */
  id: string;
  name: string;
  /** Name of the room the device is in, or an empty string. */
  zone: string;
  /** The device's `onoff` value. */
  on: boolean;
  /** False when Homey says the device cannot be reached. */
  available: boolean;
  /** Id of the Homey app that owns the device, e.g. `com.maxvandelaar.webos-plus`, or an empty string. */
  appId: string;
  /** The device's own settings, as the owning app defines them. Values are whatever that app stores. */
  settings: Record<string, unknown>;
}

/**
 * The app's view of the TVs that are devices in Homey. The app implements it with Homey's Web API
 * (`lib/homey-devices.ts`); tests use a fake. Only class `tv` devices with an `onoff` capability are offered.
 */
export interface TvDevices {
  list(): Promise<TvDeviceInfo[]>;
  /** `null` when the device does not exist (any more). Rejects when Homey cannot be asked. */
  get(id: string): Promise<TvDeviceInfo | null>;
  setOn(id: string, on: boolean): Promise<void>;
  /** Calls `listener` whenever the device's `onoff` value changes. Resolves to a function that stops listening. */
  watchPower(id: string, listener: (on: boolean) => void): Promise<() => void>;
}

export interface DriverOptions {
  /** The values of `fields` as the user saved them. Trimmed strings, empty when not filled in. */
  config: Readonly<Record<string, string>>;
  /** Whatever the driver last gave to `saveCredentials` (a pairing key, a token), or `undefined`. */
  credentials: unknown;
  /** Persist pairing data across restarts. Anything JSON-serialisable. */
  saveCredentials(credentials: unknown): void;
  log(...args: unknown[]): void;
  /** The TVs in Homey. Given only to drivers that have a `device` field, and absent if the app has no access to Homey devices. */
  devices?: TvDevices;
}

/** A live link to one TV. Create it with `TvDriver.createConnection`; nothing happens until `start()`. */
export interface TvConnection {
  readonly connection: Connection;
  /**
   * True while the TV is on. Screen off, screensaver and the like still count as on;
   * standby counts as off. Must be false whenever `connection` is not `connected`.
   */
  readonly isOn: boolean;

  /** Begin connecting and keep reconnecting by yourself. Resolves without waiting for the TV to answer. */
  start(): Promise<void>;
  /** Close the link and stop reconnecting. Must leave `isOn` false. */
  stop(): Promise<void>;
  /** Show a short message on screen. Leave it out if the TV cannot do this: the app then shows nothing. */
  toast?(message: string): Promise<void>;
  /** True when the TV the connection points at no longer exists, so the settings page can say so. Leave it out if that cannot happen. */
  readonly missing?: boolean;
  /** Put the TV in standby. */
  turnOff(): Promise<void>;
  /** Turn the TV on (e.g. Wake-on-LAN). Leave it out if the brand cannot do this. */
  wake?(): Promise<void>;

  /** Emitted with the new value whenever `isOn` changes. */
  on(event: 'power', listener: (on: boolean) => void): this;
  /** Emitted with the new value whenever `connection` changes. */
  on(event: 'connection', listener: (connection: Connection) => void): this;
}

export interface TvDriver {
  /** Stable, lowercase kebab-case id such as `lg-webos`. Stored in the user's settings, so never change it. */
  readonly id: string;
  /** Brand and platform as shown in the brand picker, e.g. "LG webOS". Not translated. */
  readonly name: string;
  /** Setup instructions shown under the fields (what to enable on the TV, how to pair). */
  readonly hint?: LocalizedText;
  readonly fields: readonly DriverField[];
  /** True when connections from this driver implement `wake()`. Decides if the settings page shows a button for it. */
  readonly canWake?: boolean;
  /** True when connections from this driver implement `toast()`. The settings page then offers the on-screen messages switch without a message provider. */
  readonly canToast?: boolean;
  createConnection(options: DriverOptions): TvConnection & EventEmitter;
}
