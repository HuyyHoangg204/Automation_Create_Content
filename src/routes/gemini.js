const express = require('express');
const { z } = require('zod');
const { listChromeProfiles } = require('../services/chrome');
const { createGem } = require('../scripts/gemini');
const { listGems } = require('../scripts/listGems');
const { sendPrompt } = require('../scripts/sendPrompt');

const router = express.Router();

const bodySchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  gemName: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  knowledgeFiles: z.array(z.string()).optional(),
  debugPort: z.number().int().positive().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/gems', async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    const { name, userDataDir: dir, profileDirName, gemName, description, instructions, knowledgeFiles, debugPort } = parsed.data;

    let userDataDir = dir;
    if (!userDataDir) {
      const profiles = await listChromeProfiles();
      const p = profiles.find((it) => it.name === name || it.dirName === name);
      if (!p) return res.status(404).json({ error: 'NotFound', message: 'Profile not found' });
      userDataDir = p.userDataDir;
    }

    const out = await createGem({ userDataDir, name: gemName, description, instructions, knowledgeFiles, debugPort });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

const syncSchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().int().positive().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/gems/sync', async (req, res, next) => {
  try {
    const parsed = syncSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    const { name, userDataDir: dir, debugPort } = parsed.data;

    let userDataDir = dir;
    if (!userDataDir) {
      const profiles = await listChromeProfiles();
      const p = profiles.find((it) => it.name === name || it.dirName === name);
      if (!p) return res.status(404).json({ error: 'NotFound', message: 'Profile not found' });
      userDataDir = p.userDataDir;
    }

    const out = await listGems({ userDataDir, debugPort });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

const sendPromptSchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().int().positive().optional(),
  gem: z.string().min(1), // Gem name to select
  listFile: z.array(z.string()).optional(), // Array of file paths to upload
  prompt: z.string().min(1), // Prompt text to send
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/gems/send-prompt', async (req, res, next) => {
  try {
    const parsed = sendPromptSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    const { name, userDataDir: dir, debugPort, gem, listFile, prompt } = parsed.data;

    let userDataDir = dir;
    if (!userDataDir) {
      const profiles = await listChromeProfiles();
      const p = profiles.find((it) => it.name === name || it.dirName === name);
      if (!p) return res.status(404).json({ error: 'NotFound', message: 'Profile not found' });
      userDataDir = p.userDataDir;
    }

    const out = await sendPrompt({ userDataDir, debugPort, gem, listFile, prompt });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;


