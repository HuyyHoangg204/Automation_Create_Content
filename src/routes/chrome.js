const express = require('express');
const { z } = require('zod');
const { logger } = require('../logger');
const { validateBody } = require('../middleware/validators');
const { createChromeProfile, getChromePathFromEnvOrDefault, launchChromeProfile, listChromeProfiles, getChromeProfileById, stopChromeProfile, ensureGmailLogin, getProfilesBaseDir, setProfilesBaseDir } = require('../services/chrome');
const { resolveUserDataDir } = require('../utils/resolveUserDataDir');
const { ACCOUNT_GOOGLE } = require('../constants/constants');

const logService = require('../services/logService');
const entityContextService = require('../services/entityContext');

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
    
    // Auto-resolve userDataDir từ tên folder (hỗ trợ các máy khác nhau với user khác nhau)
    const resolvedUserDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name
    });
    
    // Extract entity info từ request (có thể từ headers hoặc body)
    const entityType = req.headers['x-entity-type'] || req.body.entity_type || 'topic';
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    
    // Lưu context vào entityContextService để dùng sau này khi create Gem
    // Key: profileDirName (ưu tiên) hoặc resolvedUserDataDir
    const contextKey = profileDirName || resolvedUserDataDir;
    if (contextKey && entityID !== 'unknown' && userID !== 'unknown') {
      entityContextService.set(contextKey, {
        entityType,
        entityID,
        userID
      });
    }
    
    // Log: Chrome launching
    await logService.logInfo('topic', entityID, userID, 'chrome_launching', 
      `Launching Chrome for profile: ${name || resolvedUserDataDir}`, {
        name,
        inputUserDataDir,
        resolvedUserDataDir,
        profileDirName
      });
    
    // Update validatedBody với resolved path
    const launchParams = {
      ...req.validatedBody,
      userDataDir: resolvedUserDataDir
    };
    
    const result = await launchChromeProfile(launchParams);
    
    // Log: Chrome launched
    await logService.logSuccess('topic', entityID, userID, 'chrome_launched',
      'Chrome launched successfully', {
        pid: result.pid,
        debugPort: result.launchArgs?.find(a => a.includes('--remote-debugging-port'))?.split('=')[1],
        gmailStatus: result.gmailCheckStatus
      });
    
    return res.status(201).json({ launched: true, ...result });
  } catch (err) {
    // Log error
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    await logService.logError('topic', entityID, userID, 'chrome_launching',
      `Failed to launch Chrome: ${err.message}`, { error: err.message });
    
    return next(err);
  }
});

router.post('/profiles/stop', validateBody(launchSchema), async (req, res, next) => {
  try {
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
    if (email) {
      const found = (ACCOUNT_GOOGLE || []).find((a) => a.email === email);
      credentials = found || null;
    }
    if (!credentials) {
      const idx = Number.isInteger(accountIndex) ? accountIndex : 0;
      credentials = (ACCOUNT_GOOGLE || [])[idx] || null;
    }
    if (!credentials) {
      return res.status(400).json({ error: 'NoCredentials', message: 'No Gmail credentials found in constants.' });
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

module.exports = router;




