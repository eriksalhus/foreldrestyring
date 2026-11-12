import Homey from 'homey';
import { Controller, Status, TvDeviceOption, TvSettingsInput } from './lib/controller.ts';
import { registerFlowCards } from './lib/flow-cards.ts';
import { HomeyDevices, createHomeyApi } from './lib/homey-devices.ts';

/** The most minutes one Extra time or Remove time can move, from the widget or a Flow. */
const MAX_MINUTES = 240;

module.exports = class TvParentalControlApp extends Homey.App {
  private controller!: Controller;

  async onInit() {
    // The TVs in Homey are read through the Web API, which needs the homey:manager:api permission.
    this.controller = new Controller(this.homey, undefined, new HomeyDevices(() => createHomeyApi(this.homey)));
    // Before start, so a trigger from the first seconds (the TV already on while the Lock is engaged) is not lost.
    const controller = this.controller;
    registerFlowCards(
      this.homey.flow,
      {
        getStatus: () => this.getStatus(),
        getRemainingMs: () => controller.getRemainingMs(),
        setChildMode: (on) => this.setChildMode(on),
        addExtraTime: (minutes) => this.addExtraTime(minutes),
        reduceTime: (minutes) => this.reduceTime(minutes),
        events: controller,
      },
      this,
    );
    await this.controller.start();
    this.log('TV Parental Control started');
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

  /** Called by the widget and by Flows, with whatever number they were given. */
  addExtraTime(minutes: unknown): Status {
    return this.controller.addExtraTime(this.checkMinutes(minutes));
  }

  /** Called by the widget and by Flows, with whatever number they were given. */
  reduceTime(minutes: unknown): Status {
    return this.controller.reduceTime(this.checkMinutes(minutes));
  }

  private checkMinutes(value: unknown): number {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) throw new Error(this.homey.__('error.invalidMinutes'));
    return minutes;
  }

  resetToday(): Status {
    return this.controller.resetToday();
  }

  async configure(settings: TvSettingsInput): Promise<void> {
    await this.controller.configure(settings);
  }

  linkMessages(config?: Record<string, string>): Promise<Status> {
    return this.controller.linkMessages(config);
  }

  unlinkMessages(): Promise<Status> {
    return this.controller.unlinkMessages();
  }

  sendTestMessage(): Promise<void> {
    return this.controller.sendTestMessage();
  }

  getDrivers() {
    return this.controller.getDrivers();
  }

  getTvDevices(): Promise<TvDeviceOption[]> {
    return this.controller.getTvDevices();
  }

  async wakeTv(): Promise<void> {
    await this.controller.wakeTv();
  }
};
