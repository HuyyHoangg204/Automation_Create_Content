const express = require('express');
const { z } = require('zod');
const { listChromeProfiles } = require('../services/chrome');
const { launchNotebookLM } = require('../scripts/notebooklm');

const router = express.Router();

const openSchema = z.object({
  name: z.string().min(1).max(100).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional(),
  debugPort: z.number().int().positive().optional(),
  website: z.array(z.string().url()).optional(), // Array of website URLs to add as source (one per line)
  youtube: z.array(z.string().url()).optional(), // Array of YouTube URLs to add as source (insert one by one)
  textContent: z.string().optional(), // Text content to paste as source
  prompt: z.string().optional(), // Prompt to enter after adding sources
  outputFile: z.string().optional(), // Path to save generated text to file (if prompt is provided)
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/launch', async (req, res, next) => {
  try {
    const parsed = openSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    const { name, userDataDir: dir, profileDirName, debugPort, website, youtube, textContent, prompt, outputFile } = parsed.data;

    let userDataDir = dir;
    if (!userDataDir) {
      const profiles = await listChromeProfiles();
      const p = profiles.find((it) => it.name === name || it.dirName === name);
      if (!p) return res.status(404).json({ error: 'NotFound', message: 'Profile not found' });
      userDataDir = p.userDataDir;
    }

    const out = await launchNotebookLM({ userDataDir, debugPort, website, youtube, textContent, prompt, outputFile });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;


