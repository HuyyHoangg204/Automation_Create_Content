const path = require('path');
const fs = require('fs-extra');
const { connectToBrowserByUserDataDir } = require('../scripts/gmailLogin');
const { readDebugPort, getProfilesBaseDir, stopChromeProfile } = require('../services/chrome');
const { waitForChromeReady } = require('../services/workflowService');
const profileStatusEvent = require('./profileStatusEvent');
const config = require('../config');

class ProfileMonitorService {
  constructor() {
    this.monitoredProfiles = new Map();
    this.idleCheckInterval = null;
    this.checkIntervalMs = 60000;
    this.idleTimeoutMs = config.profileIdleTimeout;
    this.startIdleCheck();
  }

  async getMonitorStateFilePath() {
    const base = await getProfilesBaseDir();
    await fs.ensureDir(base);
    return path.join(base, '.monitored-profiles.json');
  }

  async saveMonitorState() {
    try {
      const filePath = await this.getMonitorStateFilePath();
      const profiles = [];
      
      for (const [key, info] of this.monitoredProfiles.entries()) {
        profiles.push({
          key,
          userDataDir: info.userDataDir,
          profileDirName: info.profileDirName,
          port: info.port,
          entityType: info.entityType,
          entityID: info.entityID,
          userID: info.userID,
          automationStatus: info.automationStatus || 'idle',
          startTime: info.startTime,
          lastIdleTime: info.lastIdleTime || null
        });
      }

      await fs.writeJson(filePath, { profiles, updatedAt: Date.now() }, { spaces: 2 });
    } catch (error) {
      console.error(`[ProfileMonitor] Lỗi khi lưu monitor state:`, error.message);
    }
  }

  async loadMonitorState() {
    try {
      const filePath = await this.getMonitorStateFilePath();
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const data = await fs.readJson(filePath);
      return Array.isArray(data.profiles) ? data.profiles : [];
    } catch (error) {
      console.error(`[ProfileMonitor] Lỗi khi đọc monitor state:`, error.message);
      return [];
    }
  }

  async removeFromMonitorState(key) {
    try {
      const filePath = await this.getMonitorStateFilePath();
      if (!fs.existsSync(filePath)) {
        return;
      }
      const data = await fs.readJson(filePath);
      if (Array.isArray(data.profiles)) {
        data.profiles = data.profiles.filter(p => p.key !== key);
        await fs.writeJson(filePath, { ...data, updatedAt: Date.now() }, { spaces: 2 });
      }
    } catch (error) {
      console.error(`[ProfileMonitor] Lỗi khi xóa từ monitor state:`, error.message);
    }
  }

  async startMonitoring({ userDataDir, profileDirName, preferPort, entityType, entityID, userID }) {
    const key = profileDirName || userDataDir;
    
    if (this.monitoredProfiles.has(key)) {
      return;
    }

    const port = preferPort || await readDebugPort(userDataDir);
    
    const readyResult = await waitForChromeReady(userDataDir, port, 30000);
    
    if (!readyResult.ready) {
      console.error(`[ProfileMonitor] ❌ Chrome không sẵn sàng sau 30 giây: ${readyResult.error}`);
      return;
    }
    
    try {
      const { browser } = await connectToBrowserByUserDataDir(userDataDir, port);

      const monitorInfo = {
        userDataDir,
        profileDirName,
        port,
        browser,
        entityType: entityType || 'topic',
        entityID: entityID || 'unknown',
        userID: userID || 'unknown',
        status: 'running',
        automationStatus: 'idle',
        startTime: Date.now(),
        lastIdleTime: Date.now()
      };

      browser.on('disconnected', async () => {
        monitorInfo.status = 'stopped';
        this.monitoredProfiles.delete(key);
        await this.removeFromMonitorState(key);
        
        profileStatusEvent.emitStatusChange(key, 'stopped', {
          userDataDir: monitorInfo.userDataDir,
          profileDirName: monitorInfo.profileDirName,
          entityType: monitorInfo.entityType,
          entityID: monitorInfo.entityID,
          userID: monitorInfo.userID
        });
      });

      this.monitoredProfiles.set(key, monitorInfo);
      await this.saveMonitorState();
      
      profileStatusEvent.emitStatusChange(key, 'running', {
        userDataDir: monitorInfo.userDataDir,
        profileDirName: monitorInfo.profileDirName,
        entityType: monitorInfo.entityType,
        entityID: monitorInfo.entityID,
        userID: monitorInfo.userID,
        startTime: monitorInfo.startTime
      });

    } catch (error) {
      console.error(`[ProfileMonitor] ❌ Không thể connect để monitor profile ${key}:`, error.message);
      console.error(`[ProfileMonitor] Profile ${key} sẽ không được monitor. Nếu profile đã chạy, có thể thử lại sau.`);
    }
  }

  async stopMonitoring(userDataDir, profileDirName) {
    const key = profileDirName || userDataDir;
    const monitorInfo = this.monitoredProfiles.get(key);
    
    if (!monitorInfo) {
      return;
    }

    if (monitorInfo.browser && monitorInfo.browser.isConnected()) {
      try {
        monitorInfo.browser.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }

    const wasRunning = monitorInfo.status === 'running';
    this.monitoredProfiles.delete(key);
    await this.removeFromMonitorState(key);
    
    if (wasRunning) {
      profileStatusEvent.emitStatusChange(key, 'stopped', {
        userDataDir: monitorInfo.userDataDir,
        profileDirName: monitorInfo.profileDirName,
        entityType: monitorInfo.entityType,
        entityID: monitorInfo.entityID,
        userID: monitorInfo.userID
      });
    }
  }

  getStatus(userDataDir, profileDirName) {
    const key = profileDirName || userDataDir;
    const monitorInfo = this.monitoredProfiles.get(key);
    
    if (!monitorInfo) {
      return { monitored: false };
    }

    const status = {
      monitored: true,
      status: monitorInfo.status,
      automationStatus: monitorInfo.automationStatus || 'idle',
      startTime: monitorInfo.startTime,
      uptime: Date.now() - monitorInfo.startTime,
      userID: monitorInfo.userID || 'unknown',
      entityID: monitorInfo.entityID || 'unknown',
      entityType: monitorInfo.entityType || 'topic'
    };
    
    return status;
  }

  getAllMonitoredProfiles() {
    const profiles = [];
    for (const [key, info] of this.monitoredProfiles.entries()) {
      profiles.push({
        key,
        userDataDir: info.userDataDir,
        profileDirName: info.profileDirName,
        status: info.status,
        automationStatus: info.automationStatus || 'idle',
        port: info.port,
        startTime: info.startTime,
        uptime: Date.now() - info.startTime,
        userID: info.userID || 'unknown',
        entityID: info.entityID || 'unknown',
        entityType: info.entityType || 'topic'
      });
    }
    return profiles;
  }

  async stopAll() {
    this.stopIdleCheck();
    
    for (const [key, info] of this.monitoredProfiles.entries()) {
      if (info.browser && info.browser.isConnected()) {
        try {
          info.browser.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
      }
    }
    this.monitoredProfiles.clear();
    try {
      const filePath = await this.getMonitorStateFilePath();
      if (fs.existsSync(filePath)) {
        await fs.writeJson(filePath, { profiles: [], updatedAt: Date.now() }, { spaces: 2 });
      }
    } catch (error) {
      // Ignore
    }
  }

  async recoverMonitoring() {
    const savedProfiles = await this.loadMonitorState();
    
    if (savedProfiles.length === 0) {
      return;
    }

    for (const savedProfile of savedProfiles) {
      try {
        const key = savedProfile.key || (savedProfile.profileDirName || savedProfile.userDataDir);
        
        const port = savedProfile.port || await readDebugPort(savedProfile.userDataDir);
        
        const readyResult = await waitForChromeReady(savedProfile.userDataDir, port, 5000);
        
        if (!readyResult.ready) {
          await this.removeFromMonitorState(key);
          continue;
        }

        const { browser } = await connectToBrowserByUserDataDir(savedProfile.userDataDir, port);

        const monitorInfo = {
          userDataDir: savedProfile.userDataDir,
          profileDirName: savedProfile.profileDirName,
          port,
          browser,
          entityType: savedProfile.entityType || 'topic',
          entityID: savedProfile.entityID || 'unknown',
          userID: savedProfile.userID || 'unknown',
          status: 'running',
          automationStatus: savedProfile.automationStatus || 'idle',
          startTime: savedProfile.startTime || Date.now(),
          lastIdleTime: savedProfile.lastIdleTime || (savedProfile.automationStatus === 'idle' ? Date.now() : null)
        };

        browser.on('disconnected', async () => {
          monitorInfo.status = 'stopped';
          this.monitoredProfiles.delete(key);
          await this.removeFromMonitorState(key);
          
          profileStatusEvent.emitStatusChange(key, 'stopped', {
            userDataDir: monitorInfo.userDataDir,
            profileDirName: monitorInfo.profileDirName,
            entityType: monitorInfo.entityType,
            entityID: monitorInfo.entityID,
            userID: monitorInfo.userID
          });
        });

        this.monitoredProfiles.set(key, monitorInfo);
        
        profileStatusEvent.emitStatusChange(key, 'running', {
          userDataDir: monitorInfo.userDataDir,
          profileDirName: monitorInfo.profileDirName,
          entityType: monitorInfo.entityType,
          entityID: monitorInfo.entityID,
          userID: monitorInfo.userID,
          startTime: monitorInfo.startTime
        });

      } catch (error) {
        console.error(`[ProfileMonitor] ❌ Không thể recover profile ${savedProfile.key}:`, error.message);
        await this.removeFromMonitorState(savedProfile.key);
      }
    }
  }

  setAutomationStatus(userDataDir, profileDirName, automationStatus) {
    const key = profileDirName || userDataDir;
    const monitorInfo = this.monitoredProfiles.get(key);
    
    if (!monitorInfo) {
      return false;
    }

    const previousStatus = monitorInfo.automationStatus;
    monitorInfo.automationStatus = automationStatus;
    
    if (automationStatus === 'idle' && previousStatus !== 'idle') {
      monitorInfo.lastIdleTime = Date.now();
    } else if (automationStatus === 'running') {
      monitorInfo.lastIdleTime = null;
    }
    
    return true;
  }

  getAutomationStatus(userDataDir, profileDirName) {
    const key = profileDirName || userDataDir;
    const monitorInfo = this.monitoredProfiles.get(key);
    
    if (!monitorInfo) {
      return null;
    }

    return monitorInfo.automationStatus || 'idle';
  }

  startIdleCheck() {
    if (this.idleCheckInterval) {
      return;
    }

    this.idleCheckInterval = setInterval(() => {
      this.checkAndStopIdleProfiles().catch((error) => {
        console.error(`[ProfileMonitor] Lỗi khi check idle profiles:`, error.message);
      });
    }, this.checkIntervalMs);
  }

  stopIdleCheck() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
  }

  async checkAndStopIdleProfiles() {
    const now = Date.now();
    const profilesToStop = [];

    for (const [key, monitorInfo] of this.monitoredProfiles.entries()) {
      if (monitorInfo.status !== 'running') {
        continue;
      }

      if (monitorInfo.automationStatus === 'idle' && monitorInfo.lastIdleTime) {
        const idleDuration = now - monitorInfo.lastIdleTime;
        
        if (idleDuration >= this.idleTimeoutMs) {
          profilesToStop.push({
            key,
            monitorInfo,
            idleDuration: Math.round(idleDuration / 1000 / 60)
          });
        }
      }
    }

    if (profilesToStop.length === 0) {
      return;
    }

    for (const { key, monitorInfo, idleDuration } of profilesToStop) {
      try {
        await this.stopMonitoring(monitorInfo.userDataDir, monitorInfo.profileDirName);
        
        await stopChromeProfile({
          userDataDir: monitorInfo.userDataDir,
          profileDirName: monitorInfo.profileDirName
        });
      } catch (error) {
        console.error(`[ProfileMonitor] ❌ Lỗi khi auto-stop profile ${key}:`, error.message);
      }
    }
  }
}

const profileMonitorService = new ProfileMonitorService();

module.exports = profileMonitorService;

