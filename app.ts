import Homey from 'homey';
import { Log } from 'homey-log';
import { Controller, Status, TvSettings } from './lib/controller.ts';

module.exports = class TvParentalControlApp extends Homey.App {
  private controller!: Controller;
  private homeyLog!: Log;

  async onInit() {
    // Sends uncaught errors to Sentry when env.json has HOMEY_LOG_URL. Off under `homey app run`.
    // homey-log's types ask for the Homey module, but it wants this.homey (see its README).
    // Raven gives up on a send after 1 s by default, which a cold connect from a Homey can exceed.
    this.homeyLog = new Log({ homey: this.homey as any, options: { sendTimeout: 5 } });
    this.controller = new Controller(this.homey, undefined, (err) => this.reportError(err));
    try {
      await this.controller.start();
    } catch (err) {
      this.reportError(err as Error);
      throw err;
    }
    this.log('TV Parental Control started');
  }

  private reportError(err: Error): void {
    this.homeyLog.captureException(err)?.catch((sendErr) => this.error('Could not send error report:', sendErr));
  }

  async onUninit() {
    await this.controller?.stop();
  }

  getStatus(): Status {
    return this.controller.getStatus();
  }

  setChildMode(on: boolean): Status {
    return this.controller.setChildMode(on);
  }

  addExtraTime(minutes: number): Status {
    return this.controller.addExtraTime(minutes);
  }

  reduceTime(minutes: number): Status {
    return this.controller.reduceTime(minutes);
  }

  resetToday(): Status {
    return this.controller.resetToday();
  }

  async configure(settings: TvSettings): Promise<void> {
    await this.controller.configure(settings);
  }

  getDrivers() {
    return this.controller.getDrivers();
  }

  async wakeTv(): Promise<void> {
    await this.controller.wakeTv();
  }
};
