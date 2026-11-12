'use strict';

const STRING_KEYS = [
  'title', 'stateOn', 'stateLocked', 'stateOff', 'minutesLeft', 'locked', 'extraTime', 'reduceTime', 'perTap', 'minLeft', 'today', 'thisWeek',
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
  // The app checks the minutes (1–240), the same check a Flow gets.
  async addExtraTime({ homey, body }) {
    return homey.app.addExtraTime(body.minutes);
  },
  async reduceTime({ homey, body }) {
    return homey.app.reduceTime(body.minutes);
  },
};
