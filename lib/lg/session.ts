import { EventEmitter } from 'node:events';
import { MessageIgnoredError } from '../drivers/types.ts';
import type { Connection } from '../drivers/types.ts';

/** The part of the lgtv2 client (SSAP over wss) that the app uses. */
export interface LgClientLike {
  on(event: 'connecting' | 'prompt' | 'connect', listener: () => void): unknown;
  /** The TV closed the connection, with the websocket close code and reason when it gave them. */
  on(event: 'close', listener: (info?: { code?: number; reason?: string }) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  /** Every frame the TV sends, as text. */
  on(event: 'message', listener: (text: string) => void): unknown;
  request(uri: string, payload?: object): unknown;
  subscribePowerState(callback: (err: Error | null, result?: { state: string }) => void): string;
  unsubscribe(id: string): void;
  disconnect(): unknown;
  wake(mac?: string): unknown;
  /** On an open connection that is not paired yet, registers again, which makes the TV show a new Allow prompt. */
  connect(host?: string): unknown;
}

export interface LgClientOptions {
  host: string;
  mac: string | undefined;
  clientKey: string | undefined;
  saveKey(key: string, callback: (err?: Error) => void): void;
  learnMac: boolean;
  reconnect: number;
}

/** States in which the TV counts as on: the picture may be off, but the TV is not in standby. */
const ON_STATES = new Set(['on', 'screen_off', 'screen_saver']);

/** How many of the TV's latest frames are kept to explain a request that got no answer, and how long each may be. */
const FRAMES_KEPT = 8;
const FRAME_MAX = 300;

/** A frame for the log: cut short, and without the pairing key, which is a credential. */
function frameForLog(text: string): string {
  return text.replace(/("client-key"\s*:\s*")[^"]*(")/g, '$1***$2').slice(0, FRAME_MAX);
}

export interface LgSessionOptions {
  host: string;
  /** Needed only for `wake()`. */
  mac?: string;
  /** The pairing key saved earlier (a string), or anything else for none. */
  credentials: unknown;
  /** Called with the pairing key when the user has pressed "Allow" on the TV. */
  saveCredentials(credentials: unknown): void;
  log(...args: unknown[]): void;
  /** Follow the TV's power state and emit `power`. Default true; both the direct driver and the message link do. */
  followPower?: boolean;
  /** Makes the lgtv2 client. Tests pass a fake; the default connects for real. */
  createClient?: (options: LgClientOptions) => Promise<LgClientLike>;
  /** How long to wait for the TV to answer a toast before concluding that it ignores it. A working TV answers within milliseconds. */
  toastWaitMs?: number;
  /** How long an Allow prompt may sit unanswered before the app asks the TV for a new one. */
  promptWaitMs?: number;
  /** The pause between the TV dropping a prompt and the app asking for a new one. */
  promptRetryDelayMs?: number;
}

/** The TV removes its Allow prompt after a while, and lgtv2 then leaves the app waiting for nothing. Ask again after this long. */
const PROMPT_WAIT_MS = 45_000;
const PROMPT_RETRY_DELAY_MS = 1_500;
/** The user gets this many prompts in all before the app gives up and asks them to press Link again. */
const MAX_PROMPTS = 3;

/** The TV answers a toast within milliseconds when it accepts it, so two seconds of silence means it is ignoring it. */
const TOAST_WAIT_MS = 2000;

async function createLgtv2Client(options: LgClientOptions): Promise<LgClientLike> {
  const { default: LG } = await import('lgtv2');
  return new LG(options) as unknown as LgClientLike;
}

/**
 * One SSAP link to one LG webOS TV, shared by everything that talks to LG: the direct TV driver (power state,
 * turn off, wake, messages) and the LG message provider (messages only). It connects and keeps reconnecting by
 * itself. Events: `connection` (a `Connection`) and `power` (true while the TV is on).
 */
export class LgSession extends EventEmitter {
  connection: Connection = 'connecting';

  private lg: LgClientLike | null = null;
  private powerSubscription: string | undefined;
  private readonly recentFrames: string[] = [];
  private loggedIgnoredToast = false;
  private promptsShown = 0;
  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: LgSessionOptions;

  constructor(options: LgSessionOptions) {
    super();
    this.options = options;
  }

  async start(): Promise<void> {
    const { host, mac, credentials, saveCredentials, log, createClient = createLgtv2Client } = this.options;
    const lg = await createClient({
      host,
      mac: mac || undefined,
      clientKey: typeof credentials === 'string' && credentials ? credentials : undefined,
      saveKey: (key, callback) => {
        saveCredentials(key);
        callback();
      },
      learnMac: false,
      reconnect: 5000,
    });
    this.lg = lg;

    lg.on('connecting', () => {
      // "connecting" must not hide the Allow prompt while the TV waits for the user.
      if (this.connection !== 'prompt') this.setConnection('connecting');
    });
    lg.on('prompt', () => {
      this.promptsShown++;
      this.setConnection('prompt');
      this.waitForAnswer();
    });
    lg.on('connect', () => {
      this.clearPromptTimer();
      this.promptsShown = 0;
      this.setConnection('connected');
      if (this.options.followPower === false) return;
      if (this.powerSubscription) lg.unsubscribe(this.powerSubscription);
      this.powerSubscription = lg.subscribePowerState((err, result) => {
        if (err || !result) return;
        this.emit('power', ON_STATES.has(result.state));
      });
    });
    lg.on('close', (info) => {
      this.clearPromptTimer();
      if (this.lg) log('TV connection closed' + (info?.code ? ` (code ${info.code}${info.reason ? `, ${info.reason}` : ''})` : ''));
      this.setConnection('offline');
    });
    lg.on('error', (err) => {
      log('TV error:', err.message);
      // An error while the TV waits for the user means the prompt was refused or has timed out.
      if (this.connection === 'prompt') this.promptEnded(/cancel/i.test(err.message), err.message);
    });
    lg.on('message', (text) => {
      this.recentFrames.push(frameForLog(text));
      if (this.recentFrames.length > FRAMES_KEPT) this.recentFrames.shift();
    });
  }

  async stop(): Promise<void> {
    const lg = this.lg;
    this.lg = null;
    this.clearPromptTimer();
    this.setConnection('offline');
    await lg?.disconnect();
  }

  /**
   * Shows a short message on the TV as a toast, which fades by itself and needs nobody to press anything. Some TVs
   * (LG keeps toasts for system apps on newer webOS) register, answer every other request and silently ignore the
   * toast. That is reported as `MessageIgnoredError` after two seconds, and nothing else is shown instead: an alert
   * dialog was tried and rejected because someone has to press OK on it.
   */
  async toast(message: string): Promise<void> {
    const lg = this.lg;
    if (!lg) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const silence = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MessageIgnoredError('The TV did not answer the toast')), this.options.toastWaitMs ?? TOAST_WAIT_MS);
      });
      await Promise.race([Promise.resolve(lg.request('ssap://system.notifications/createToast', { message })), silence]);
    } catch (err) {
      if (err instanceof MessageIgnoredError) {
        if (!this.loggedIgnoredToast) {
          this.loggedIgnoredToast = true;
          this.options.log('The TV did not answer createToast, so it is not showing on-screen messages (LG keeps toasts for system apps on some webOS versions)');
        }
        throw err;
      }
      // The TV's latest frames show what it does answer when it refuses.
      this.options.log(
        'SSAP createToast failed:',
        err instanceof Error ? err.message : err,
        '| last frames from the TV:',
        this.recentFrames.join(' | ') || 'none',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async turnOff(): Promise<void> {
    await this.lg?.request('ssap://system/turnOff');
  }

  async wake(): Promise<void> {
    await this.lg?.wake(this.options.mac || undefined);
  }

  private clearPromptTimer(): void {
    if (this.promptTimer) clearTimeout(this.promptTimer);
    this.promptTimer = null;
  }

  /** If nobody answers the Allow prompt, ask again after a while: the TV drops it silently. */
  private waitForAnswer(): void {
    this.clearPromptTimer();
    this.promptTimer = setTimeout(() => this.promptEnded(false, 'no answer'), this.options.promptWaitMs ?? PROMPT_WAIT_MS);
    this.promptTimer.unref?.();
  }

  /**
   * The Allow prompt is gone without the user approving it. A refusal ends the link; anything else gets a new prompt,
   * up to `MAX_PROMPTS` in all, so the user does not have to press Link again just because the first one timed out.
   */
  private promptEnded(declined: boolean, reason: string): void {
    this.clearPromptTimer();
    const { log } = this.options;
    if (declined) {
      log('The TV link was declined on the TV, so the app stops asking');
      this.giveUpLinking();
      return;
    }
    if (this.promptsShown >= MAX_PROMPTS) {
      log(`The TV never approved the link after ${MAX_PROMPTS} prompts (${reason}), so the app stops asking`);
      this.giveUpLinking();
      return;
    }
    log(`The Allow prompt is gone (${reason}), asking the TV for a new one (${this.promptsShown + 1} of ${MAX_PROMPTS})`);
    this.promptTimer = setTimeout(() => {
      this.promptTimer = null;
      void this.lg?.connect();
    }, this.options.promptRetryDelayMs ?? PROMPT_RETRY_DELAY_MS);
    this.promptTimer.unref?.();
  }

  /** Stops asking, but keeps the connection open: an Allow that still arrives late is accepted and links as usual. */
  private giveUpLinking(): void {
    this.setConnection('offline');
  }

  private setConnection(connection: Connection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    this.emit('connection', connection);
  }
}
