const EventEmitter = require('events');

class ProfileStatusEventEmitter extends EventEmitter {
  constructor() {
    super();
  }

  emitStatusChange(profileKey, status, data = {}) {
    this.emit('status-change', {
      profileKey,
      status,
      ...data,
      timestamp: Date.now()
    });
  }

  emitAllStatus() {
    this.emit('get-all-status');
  }
}

const profileStatusEvent = new ProfileStatusEventEmitter();
module.exports = profileStatusEvent;

