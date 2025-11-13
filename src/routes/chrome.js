const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validators');
const { createChromeProfile, getChromePathFromEnvOrDefault, launchChromeProfile, listChromeProfiles, getChromeProfileById, stopChromeProfile, ensureGmailLogin } = require('../services/chrome');
const { ACCOUNT_GOOGLE } = require('../constants/constants');

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
    const result = await launchChromeProfile(req.validatedBody);
    return res.status(201).json({ launched: true, ...result });
  } catch (err) {
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




