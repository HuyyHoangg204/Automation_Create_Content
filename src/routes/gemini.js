const express = require('express');
const { z } = require('zod');
const { logger } = require('../logger');
const { resolveUserDataDir } = require('../utils/resolveUserDataDir');
const { createGem } = require('../scripts/gemini');
const { listGems } = require('../scripts/listGems');
const { sendPrompt } = require('../scripts/sendPrompt');
const logService = require('../services/logService');

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

// Trong POST /gemini/gems
router.post('/gems', async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    
    const { name, userDataDir: inputUserDataDir, profileDirName, gemName, description, instructions, knowledgeFiles, debugPort } = parsed.data;
    
    // Extract entity info
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    
    // Auto-resolve userDataDir từ tên folder (hỗ trợ các máy khác nhau với user khác nhau)
    logger.info({
      inputUserDataDir,
      name
    }, '[Gemini] Resolving userDataDir from folder name');
    
    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name
    });
    
    logger.info({
      inputUserDataDir,
      resolvedUserDataDir: userDataDir
    }, '[Gemini] userDataDir resolved successfully');

    // Log: Gem creating
    await logService.logInfo('topic', entityID, userID, 'gem_creating',
      `Creating Gem: ${gemName || name}`, {
        gemName: gemName || name,
        description,
        knowledgeFilesCount: knowledgeFiles?.length || 0
      });

    const out = await createGem({ userDataDir, name: gemName, description, instructions, knowledgeFiles, debugPort });
    
    // Log: Gem created
    await logService.logSuccess('topic', entityID, userID, 'gem_created',
      'Gem created successfully on Gemini', {
        gemId: out.id || out.gem_id || 'unknown',
        gemName: out.name || gemName
      });
    
    return res.json(out);
  } catch (err) {
    // Log error
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    await logService.logError('topic', entityID, userID, 'gem_creating',
      `Failed to create Gem: ${err.message}`, { error: err.message });
    
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
    const { name, userDataDir: inputUserDataDir, debugPort } = parsed.data;

    // Auto-resolve userDataDir từ tên folder
    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name
    });

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
    const { name, userDataDir: inputUserDataDir, debugPort, gem, listFile, prompt } = parsed.data;

    // Auto-resolve userDataDir từ tên folder
    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name
    });

    const out = await sendPrompt({ userDataDir, debugPort, gem, listFile, prompt });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;


