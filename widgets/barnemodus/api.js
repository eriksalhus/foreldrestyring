'use strict';

module.exports = {
  async getStatus({ homey }) {
    homey.app.log('widget: getStatus');
    return homey.app.getStatus();
  },
  async setChildMode({ homey, body }) {
    return homey.app.setChildMode(Boolean(body.on));
  },
  async resetToday({ homey }) {
    return homey.app.resetToday();
  },
  async addExtraTime({ homey, body }) {
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error('Ugyldig antall minutter');
    return homey.app.addExtraTime(minutes);
  },
};
