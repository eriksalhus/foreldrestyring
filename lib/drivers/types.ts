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
  label: LocalizedText;
  placeholder?: string;
  hint?: LocalizedText;
  /** The TV counts as set up only when every required field is filled in. */
  required?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
}

export interface DriverOptions {
  /** The values of `fields` as the user saved them. Trimmed strings, empty when not filled in. */
  config: Readonly<Record<string, string>>;
  /** Whatever the driver last gave to `saveCredentials` (a pairing key, a token), or `undefined`. */
  credentials: unknown;
  /** Persist pairing data across restarts. Anything JSON-serialisable. */
  saveCredentials(credentials: unknown): void;
  log(...args: unknown[]): void;
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
  /** Show a short message on screen. */
  toast(message: string): Promise<void>;
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
  createConnection(options: DriverOptions): TvConnection & EventEmitter;
}
