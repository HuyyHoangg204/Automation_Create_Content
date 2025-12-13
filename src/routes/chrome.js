const express = require('express');
const { z } = require('zod');
const { logger } = require('../logger');
const { validateBody } = require('../middleware/validators');
const { createChromeProfile, getChromePathFromEnvOrDefault, launchChromeProfile, listChromeProfiles, getChromeProfileById, stopChromeProfile, ensureGmailLogin, getProfilesBaseDir, setProfilesBaseDir } = require('../services/chrome');
const { resolveUserDataDir, getProfileDirNameFromIndex } = require('../utils/resolveUserDataDir');
const { getGoogleAccount, getAllGoogleAccounts } = require('../utils/googleAccount');

const logService = require('../services/logService');
const entityContextService = require('../services/entityContext');
const profileMonitorService = require('../services/profileMonitor');
const profileStatusEvent = require('../services/profileStatusEvent');

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

router.post('/profiles', validateBody(createSchema), async (req, res, next) => {
  try {
    const { name } = req.validatedBody;
    const profile = await createChromeProfile({ name });
    return res.status(201).json({ profile });
  } catch (err) {
    return next(err);
  }
});

router.get('/profiles', async (req, res, next) => {
  try {
    const profiles = await listChromeProfiles();
    return res.json({ profiles });
  } catch (err) {
    return next(err);
  }
});

router.get('/profiles/status', async (req, res, next) => {
  try {
    const { name, userDataDir: inputUserDataDir, profileDirName } = req.query;
    
    if ((!name || name.trim() === '') && (!inputUserDataDir || inputUserDataDir.trim() === '')) {
      return res.status(400).json({ error: 'Either name or userDataDir must be provided' });
    }

    let resolvedUserDataDir;
    try {
      resolvedUserDataDir = await resolveUserDataDir({
        userDataDir: inputUserDataDir,
        name,
        profileDirName: profileDirName || 'Default'
      });
    } catch (resolveError) {
      console.error('[Status API] Resolve error:', resolveError);
      return res.status(400).json({ 
        error: 'Failed to resolve userDataDir', 
        message: resolveError?.message || 'Invalid profile name or path'
      });
    }

    const statusKey = profileDirName || 'Default';
    
    const monitorStatus = profileMonitorService.getStatus(resolvedUserDataDir, statusKey);
    
    if (monitorStatus.monitored) {
      return res.json({ 
        running: monitorStatus.status === 'running',
        monitored: true,
        status: monitorStatus.status,
        startTime: monitorStatus.startTime,
        uptime: monitorStatus.uptime
      });
    }

    const fs = require('fs');
    const path = require('path');
    
    const pidFile = path.join(resolvedUserDataDir, '.chrome-profile.pid');
    let isRunning = false;
    
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
        if (Number.isInteger(pid) && pid > 0) {
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try {
              const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { 
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true
              });
              isRunning = output.trim().length > 0 && output.includes(String(pid));
            } catch {
              isRunning = false;
            }
          } else {
            try {
              process.kill(pid, 0);
              isRunning = true;
            } catch {
              isRunning = false;
            }
          }
        }
      } catch {
        isRunning = false;
      }
    }

    return res.json({ 
      running: isRunning,
      monitored: false
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/profiles/:id', (req, res, next) => {
  const schema = z.object({ id: z.string().uuid() });
  const result = schema.safeParse(req.params);
  if (!result.success) return res.status(400).json({ error: 'ValidationError', details: result.error.issues });
  const { id } = result.data;
  getChromeProfileById(id)
    .then((profile) => {
      if (!profile) return res.status(404).json({ error: 'Not Found' });
      return res.json({ profile });
    })
    .catch(next);
});

const launchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional(),
  extraArgs: z.array(z.string()).optional(),
  ensureGmail: z.boolean().optional(),
  headless: z.boolean().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/profiles/launch', validateBody(launchSchema), async (req, res, next) => {
  try {
    const { name, userDataDir: inputUserDataDir, profileDirName } = req.validatedBody;
    
    const entityType = req.headers['x-entity-type'] || req.body.entity_type || 'topic';
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    
    const resolvedUserDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name,
      profileDirName
    });
    
    const profileDirNameFromIndex = await getProfileDirNameFromIndex(resolvedUserDataDir, name);
    const finalProfileDirName = profileDirNameFromIndex || profileDirName || 'Default';
    
    const statusKey = finalProfileDirName;
    const monitorStatus = profileMonitorService.getStatus(resolvedUserDataDir, statusKey);
    const allMonitored = profileMonitorService.getAllMonitoredProfiles();
    
    const existingProfileForSameUser = allMonitored.find(p => 
      p.userID === userID && p.userID !== 'unknown' && p.status === 'running'
    );
    
    const existingProfileForSameKey = allMonitored.find(p => 
      p.key === statusKey && p.status === 'running'
    );
    
    const contextKey = finalProfileDirName;
    if (contextKey && entityID !== 'unknown' && userID !== 'unknown') {
      entityContextService.set(contextKey, {
        entityType,
        entityID,
        userID
      });
    }
    
    if (existingProfileForSameKey && existingProfileForSameKey.status === 'running') {
      const fs = require('fs-extra');
      const path = require('path');
      const debugPortFile = path.join(resolvedUserDataDir, '.chrome-profile.debugport');
      let debugPort = 9222;
      try {
        if (await fs.pathExists(debugPortFile)) {
          const portStr = await fs.readFile(debugPortFile, 'utf-8');
          debugPort = parseInt(portStr.trim(), 10) || 9222;
        }
      } catch (err) {
        // Ignore debug port read error
      }
      
      return res.status(200).json({
        launched: false,
        reused: true,
        userDataDir: resolvedUserDataDir,
        profileDirName: finalProfileDirName,
        debugPort: existingProfileForSameKey.port || debugPort,
        message: 'Chrome profile đang chạy, reuse instance hiện có'
      });
    }
    
    if (existingProfileForSameUser && existingProfileForSameUser.status === 'running') {
      if (existingProfileForSameUser.automationStatus === 'running') {
        return res.status(409).json({
          error: 'Chrome profile đang chạy automation, không thể launch instance mới',
          existingProfile: {
            key: existingProfileForSameUser.key,
            userDataDir: existingProfileForSameUser.userDataDir,
            automationStatus: existingProfileForSameUser.automationStatus
          }
        });
      }
      
      if (existingProfileForSameUser.key === statusKey) {
        const fs = require('fs-extra');
        const path = require('path');
        const debugPortFile = path.join(resolvedUserDataDir, '.chrome-profile.debugport');
        let debugPort = 9222;
        try {
          if (await fs.pathExists(debugPortFile)) {
            const portStr = await fs.readFile(debugPortFile, 'utf-8');
            debugPort = parseInt(portStr.trim(), 10) || 9222;
          }
        } catch (err) {
          // Ignore debug port read error
        }
        
        return res.status(200).json({
          launched: false,
          reused: true,
          userDataDir: resolvedUserDataDir,
          profileDirName: finalProfileDirName,
          debugPort: existingProfileForSameUser.port || debugPort,
          message: 'Chrome profile đang chạy, reuse instance hiện có'
        });
      }
    }
    
    const launchParams = {
      ...req.validatedBody,
      userDataDir: resolvedUserDataDir,
      profileDirName: finalProfileDirName
    };
    
    console.log('[DEBUG] Launch Params:', JSON.stringify(launchParams, null, 2));
    
    console.log('[DEBUG] Launch Params:', JSON.stringify(launchParams, null, 2));
    
    let result = await launchChromeProfile(launchParams);
    
    console.log('[DEBUG] Launch Result:', JSON.stringify(result, null, 2));

    let debugPortArg = result.launchArgs?.find(a => a.includes('--remote-debugging-port'));
    let debugPort = debugPortArg ? parseInt(debugPortArg.split('=')[1], 10) : undefined;

    // Check for login failure if ensureGmail was requested
    if (launchParams.ensureGmail) {
      const status = result.gmailCheckStatus;
      
      // Strict check: Success only if 'logged_in', 'already_logged_in', or 'login_success'
      const successStatuses = ['logged_in', 'already_logged_in', 'login_success'];
      
      if (!successStatuses.includes(status)) {
        
        await logService.logError(entityType, entityID, userID, 'chrome_launch_login', 
          `Gmail login failed or incomplete. Status: ${status}`, {
          profile: finalProfileDirName,
          status: status
        });

        return res.status(401).json({
          launched: true, // Browser launched but login failed
          error: 'GmailLoginFailed',
          message: `Gmail login validation failed. Status: ${status}`,
          ...result
        });
      }

      // RESTART LOGIC: If just logged in (login_success), restart the profile
      // This is a specific user request: "tắt profile đi rồi bật lại" upon successful login.
      if (status === 'login_success') {
        console.log('[Chrome] Fresh login detected. Restarting profile as requested...');
        
        await logService.logInfo(entityType, entityID, userID, 'chrome_profile_restart', 
          'Fresh login detected. Restarting profile to finalize session.', {
          profile: finalProfileDirName
        });

        // 1. Stop profile
        await stopChromeProfile({
          userDataDir: resolvedUserDataDir,
          profileDirName: finalProfileDirName
        });

        // 2. Wait for shutdown (2 seconds)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 3. Relaunch (update result)
        console.log('[Chrome] Relaunching profile...');
        result = await launchChromeProfile(launchParams);
        
        // Update debug port for the new instance
        debugPortArg = result.launchArgs?.find(a => a.includes('--remote-debugging-port'));
        debugPort = debugPortArg ? parseInt(debugPortArg.split('=')[1], 10) : undefined;

        console.log('[DEBUG] Relaunch Result:', JSON.stringify(result, null, 2));
      }
    }
    
    
    profileMonitorService.startMonitoring({
      userDataDir: resolvedUserDataDir,
      profileDirName: finalProfileDirName,
      preferPort: debugPort,
      entityType,
      entityID,
      userID
    }).catch((err) => {
      console.error(`[ProfileMonitor] Lỗi khi start monitoring:`, err.message);
    });
    
    return res.status(201).json({ launched: true, ...result });
  } catch (err) {
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    await logService.logError('topic', entityID, userID, 'chrome_launching',
      `Failed to launch Chrome: ${err.message}`, { error: err.message });
    
    return next(err);
  }
});

router.post('/profiles/stop', validateBody(launchSchema), async (req, res, next) => {
  try {
    const { name, userDataDir: inputUserDataDir, profileDirName } = req.validatedBody;
    
    // Auto-resolve userDataDir từ tên folder
    const resolvedUserDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name
    });
    
    // Stop monitoring profile
    await profileMonitorService.stopMonitoring(resolvedUserDataDir, profileDirName);
    
    const result = await stopChromeProfile(req.validatedBody);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

router.get('/chrome-path', (req, res) => {
  const chromePath = getChromePathFromEnvOrDefault();
  res.json({ chromePath });
});

// API get profiles folder
router.get('/profiles-folder', async (req, res, next) => {
  try {
    const profilesBaseDir = await getProfilesBaseDir();
    res.json({ profilesBaseDir });
  } catch (err) {
    return next(err);
  }
});

// API set profiles folder
const setFolderSchema = z.object({
  folder: z.string().min(1)
});

router.put('/profiles-folder', validateBody(setFolderSchema), async (req, res, next) => {
  try {
    const { folder } = req.validatedBody;
    const resolvedPath = await setProfilesBaseDir(folder);
    res.json({ 
      profilesBaseDir: resolvedPath,
      message: 'Profiles folder updated successfully'
    });
  } catch (err) {
    return next(err);
  }
});

const loginSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  userDataDir: z.string().min(1).optional(),
  email: z.string().email().optional(),
  accountIndex: z.number().int().nonnegative().optional(),
  debugPort: z.number().int().positive().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/profiles/login-gmail', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { name, userDataDir, email, accountIndex, debugPort } = req.validatedBody;
    const base = name ? undefined : undefined; // placeholder for type consistency
    let credentials = null;
    
    // Get all available accounts (from saved file + constants)
    const allAccounts = getAllGoogleAccounts();
    
    if (email) {
      // Find by email
      const found = allAccounts.find((a) => a.email === email);
      credentials = found || null;
    }
    if (!credentials) {
      // Get by index (default to 0)
      const idx = Number.isInteger(accountIndex) ? accountIndex : 0;
      credentials = allAccounts[idx] || null;
    }
    if (!credentials) {
      return res.status(400).json({ error: 'NoCredentials', message: 'No Gmail credentials found. Please configure in Settings.' });
    }

    // Resolve path if only name provided
    let resolvedUserDataDir = userDataDir;
    if (!resolvedUserDataDir) {
      const profiles = await listChromeProfiles();
      const p = profiles.find((it) => it.name === name || it.dirName === name);
      if (!p) return res.status(404).json({ error: 'NotFound', message: 'Profile not found' });
      resolvedUserDataDir = p.userDataDir;
    }

    const out = await ensureGmailLogin({ userDataDir: resolvedUserDataDir, email: credentials.email, password: credentials.password, debugPort });
    return res.json({ status: out.status });
  } catch (err) {
    return next(err);
  }
});

router.get('/profiles/status/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('connected', { message: 'Connected to profile status stream' });

  const onStatusChange = (statusData) => {
    sendEvent('status-change', statusData);
  };

  const onAutomationStatusChange = (automationStatusData) => {
    sendEvent('automation-status-change', automationStatusData);
  };

  const onGetAllStatus = async () => {
    try {
      const profiles = await listChromeProfiles();
      const allMonitored = profileMonitorService.getAllMonitoredProfiles();
      const statusMap = {};
      
      for (const profile of profiles) {
        const monitoredProfile = allMonitored.find(m => m.userDataDir === profile.userDataDir);
        const actualProfileDirName = monitoredProfile?.profileDirName || profile.profileDirName || 'Default';
        const key = actualProfileDirName;
        
        const monitorStatus = profileMonitorService.getStatus(profile.userDataDir, actualProfileDirName);
        
        if (monitorStatus.monitored) {
          statusMap[key] = {
            running: monitorStatus.status === 'running',
            monitored: true,
            status: monitorStatus.status,
            automationStatus: monitorStatus.automationStatus || 'idle',
            startTime: monitorStatus.startTime,
            uptime: monitorStatus.uptime,
            userDataDir: profile.userDataDir
          };
        } else {
          statusMap[key] = {
            running: false,
            monitored: false,
            userDataDir: profile.userDataDir
          };
        }
      }
      
      sendEvent('all-status', statusMap);
    } catch (error) {
      console.error('[SSE] Error getting all status:', error);
    }
  };

  profileStatusEvent.on('status-change', onStatusChange);
  profileStatusEvent.on('get-all-status', onGetAllStatus);
  profileStatusEvent.on('automation-status-change', onAutomationStatusChange);
  
  onGetAllStatus();

  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded && res.writable) {
      try {
        res.write(': heartbeat\n\n');
      } catch (error) {
        clearInterval(heartbeatInterval);
      }
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    profileStatusEvent.removeListener('status-change', onStatusChange);
    profileStatusEvent.removeListener('get-all-status', onGetAllStatus);
    profileStatusEvent.removeListener('automation-status-change', onAutomationStatusChange);
    if (!res.writableEnded) {
      res.end();
    }
  });

  await onGetAllStatus();
});

module.exports = router;




