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

  emitAutomationStatusChange(profileKey, automationStatus, data = {}) {
    this.emit('automation-status-change', {
      profileKey,
      automationStatus,
      ...data,
      timestamp: Date.now()
    });
  }
}

const profileStatusEvent = new ProfileStatusEventEmitter();
module.exports = profileStatusEvent;

