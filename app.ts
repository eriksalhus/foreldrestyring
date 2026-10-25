import Homey from 'homey';
import { Controller, Status, TvSettings } from './lib/controller';

module.exports = class ForeldrestyringApp extends Homey.App {
  private controller!: Controller;

  async onInit() {
    this.controller = new Controller(this.homey);
    await this.controller.start();
    this.log('Foreldrestyring startet');
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

  resetToday(): Status {
    return this.controller.resetToday();
  }

  async configure(settings: TvSettings): Promise<void> {
    await this.controller.configure(settings);
  }

  async wakeTv(): Promise<void> {
    await this.controller.wakeTv();
  }
};
