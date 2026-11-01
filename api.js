'use strict';

module.exports = {
  async getStatus({ homey }) {
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
      host: String(body.host || '').trim(),
      mac: String(body.mac || '').trim(),
      weekdayMinutes: num(body.weekdayMinutes, 30),
      weekendMinutes: num(body.weekendMinutes, 60),
      weekStartDay: Math.min(6, Math.floor(num(body.weekStartDay, 1))),
    });
    return homey.app.getStatus();
  },
  async wakeTv({ homey }) {
    await homey.app.wakeTv();
    return { ok: true };
  },
};
