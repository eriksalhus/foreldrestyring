import Homey from 'homey';
import { Controller, Status, TvDeviceOption, TvSettingsInput } from './lib/controller.ts';
import { HomeyDevices, createHomeyApi } from './lib/homey-devices.ts';

module.exports = class TvParentalControlApp extends Homey.App {
  private controller!: Controller;

  async onInit() {
    // The TVs in Homey are read through the Web API, which needs the homey:manager:api permission.
    this.controller = new Controller(this.homey, undefined, new HomeyDevices(() => createHomeyApi(this.homey)));
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

  addExtraTime(minutes: number): Status {
    return this.controller.addExtraTime(minutes);
  }

  reduceTime(minutes: number): Status {
    return this.controller.reduceTime(minutes);
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
