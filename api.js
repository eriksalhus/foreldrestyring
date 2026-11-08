'use strict';

module.exports = {
  async getStatus({ homey }) {
    return homey.app.getStatus();
  },
  async getDrivers({ homey }) {
    return homey.app.getDrivers();
  },
  async getTvDevices({ homey }) {
    return homey.app.getTvDevices();
  },
  async setChildMode({ homey, body }) {
    return homey.app.setChildMode(Boolean(body.on));
  },
  async resetToday({ homey }) {
    return homey.app.resetToday();
  },
  async addExtraTime({ homey, body }) {
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error(homey.__('error.invalidMinutes'));
    return homey.app.addExtraTime(minutes);
  },
  async reduceTime({ homey, body }) {
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error(homey.__('error.invalidMinutes'));
    return homey.app.reduceTime(minutes);
  },
  async configure({ homey, body }) {
    const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);
    await homey.app.configure({
      driver: String(body.driver || ''),
      driverConfig: body.driverConfig,
      weekdayMinutes: num(body.weekdayMinutes, 30),
      weekendMinutes: num(body.weekendMinutes, 60),
      weekStartDay: Math.min(6, Math.floor(num(body.weekStartDay, 1))),
      dayStartTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(body.dayStartTime) ? body.dayStartTime : '05:00',
      autoOffAtRollover: body.autoOffAtRollover !== false,
      autoOnEnabled: body.autoOnEnabled === true,
      autoOnTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(body.autoOnTime) ? body.autoOnTime : '15:00',
      // Only the on/off switch and the provider's fields come from the page; the link is decided by the app.
      messages: {
        enabled: body.messages && typeof body.messages.enabled === 'boolean' ? body.messages.enabled : undefined,
        config: body.messages && body.messages.config && typeof body.messages.config === 'object' ? body.messages.config : undefined,
      },
    });
    return homey.app.getStatus();
  },
  async linkMessages({ homey, body }) {
    return homey.app.linkMessages(body && body.config && typeof body.config === 'object' ? body.config : undefined);
  },
  async unlinkMessages({ homey }) {
    return homey.app.unlinkMessages();
  },
  async wakeTv({ homey }) {
    await homey.app.wakeTv();
    return { ok: true };
  },
};
