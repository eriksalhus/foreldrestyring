import type { EventEmitter } from 'node:events';
import type { Connection, DriverField, LocalizedText, TvDeviceInfo } from '../drivers/types.ts';

/**
 * A message provider shows On-screen messages on one kind of TV when the Connected TV is a Homey device,
 * which cannot show them by itself (see docs/adding-a-message-provider.md and the glossary). A TV connected
 * by a TV driver that has `toast()` does not need one. Showing messages is a supplement: nothing here may
 * affect counting, the Lock or the power connection.
 */

export interface MessageOptions {
  /** The values of `fields` as the user saved them. Trimmed strings, empty when not filled in. */
  config: Readonly<Record<string, string>>;
  /** Whatever the provider last gave to `saveCredentials` (a pairing key, a token), or `undefined`. */
  credentials: unknown;
  /** Persist pairing data across restarts. Anything JSON-serialisable. */
  saveCredentials(credentials: unknown): void;
  log(...args: unknown[]): void;
}

/**
 * A live way to reach one TV with messages. Nothing happens until `start()`. It need not hold a socket: an HTTP
 * provider can report `connected` as soon as it has started. `connection` has the same meaning as for a TV
 * connection, with `prompt` meaning "the user must approve on the TV", which is how the Link step is shown.
 */
export interface MessageChannel {
  readonly connection: Connection;
  /** Begin connecting and keep reconnecting by yourself. Resolves without waiting for the TV to answer. */
  start(): Promise<void>;
  /** Close the link and stop reconnecting. */
  stop(): Promise<void>;
  /** Show a short message on screen. */
  send(text: string): Promise<void>;
  /** Emitted with the new value whenever `connection` changes. */
  on(event: 'connection', listener: (connection: Connection) => void): this;
}

export interface MessageProvider {
  /** Stable, lowercase kebab-case id such as `lg-webos`. Stored in the user's settings, so never change it. Also the key of the pairing data. */
  readonly id: string;
  /** Shown to the user, e.g. "LG webOS". Not translated. */
  readonly name: string;
  /** Setup instructions shown with the fields (what to enable on the TV, what to press). */
  readonly hint?: LocalizedText;
  /** What the user fills in, e.g. the TV's IP address. Text fields only. The provider is set up when every required field is filled in. */
  readonly fields: readonly DriverField[];
  /** Whether this provider can show messages on this Homey TV, judged by the app that owns the device. Never by guessing from the name. */
  matches(device: TvDeviceInfo): boolean;
  /** Field values the device already knows, e.g. its IP address. The user can change them. Only fields it can fill. */
  suggestConfig(device: TvDeviceInfo): Record<string, string>;
  createChannel(options: MessageOptions): MessageChannel & EventEmitter;
}
