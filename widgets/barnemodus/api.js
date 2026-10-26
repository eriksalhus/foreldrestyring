'use strict';

const STRING_KEYS = [
  'title', 'stateOn', 'stateLocked', 'stateOff', 'minutesLeft', 'locked', 'extraTime', 'today', 'thisWeek',
  'minUsed', 'ofTotal', 'inclExtra', 'connUnconfigured', 'connNotConnected', 'connPrompt', 'connConnected',
  'tvOn', 'tvOff', 'reset', 'resetTitle', 'tapAgain', 'error',
];

module.exports = {
  async getStrings({ homey }) {
    const strings = {};
    for (const key of STRING_KEYS) strings[key] = homey.__(`widget.${key}`);
    return strings;
  },
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
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error(homey.__('error.invalidMinutes'));
    return homey.app.addExtraTime(minutes);
  },
};
