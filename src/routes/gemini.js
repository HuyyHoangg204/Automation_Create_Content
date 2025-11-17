const express = require('express');
const { z } = require('zod');
const { listChromeProfiles } = require('../services/chrome');
const { createGem } = require('../scripts/gemini');
const { listGems } = require('../scripts/listGems');
const { sendPrompt } = require('../scripts/sendPrompt');
const { launchNotebookLM } = require('../scripts/notebooklm');
const fs = require('fs');
const path = require('path');
const { uploadDir } = require('../config');

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

const executeSchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().int().positive().optional(),
  // Step 1: NotebookLM
  notebookWebsite: z.array(z.string().url()).optional(),
  notebookYoutube: z.array(z.string().url()).optional(),
  notebookTextContent: z.string().optional(),
  notebookPrompt: z.string().min(1), // Prompt để generate dàn ý
  // Step 2: Send prompt to Gemini
  gem: z.string().min(1), // Name of existing Gem to send prompt to
  geminiPrompt: z.string().min(1), // Prompt để gửi vào gemini với file dàn ý
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/execute', async (req, res, next) => {
  try {
    const parsed = executeSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    
    const {
      name,
      userDataDir: dir,
      debugPort,
      notebookWebsite,
      notebookYoutube,
      notebookTextContent,
      notebookPrompt,
      gem,
      geminiPrompt,
    } = parsed.data;

    let userDataDir = dir;
    if (!userDataDir) {
      const profiles = await listChromeProfiles();
      const p = profiles.find((it) => it.name === name || it.dirName === name);
      if (!p) return res.status(404).json({ error: 'NotFound', message: 'Profile not found' });
      userDataDir = p.userDataDir;
    }

    const results = {
      step1_notebooklm: null,
      step2_sendPrompt: null,
      outputFile: null,
      error: null,
    };

    try {
      // Step 1: Launch NotebookLM and generate outline
      // Generate output file path - lưu vào uploadDir (folder đã setup)
      await fs.promises.mkdir(uploadDir, { recursive: true });
      const timestamp = Date.now();
      const outputFileName = `outline_${gem.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.txt`;
      const outputFilePath = path.join(uploadDir, outputFileName);

      const notebookResult = await launchNotebookLM({
        userDataDir,
        debugPort,
        website: notebookWebsite,
        youtube: notebookYoutube,
        textContent: notebookTextContent && notebookTextContent.trim() ? notebookTextContent : undefined,
        prompt: notebookPrompt,
        outputFile: outputFilePath,
      });
      results.step1_notebooklm = notebookResult;
      results.outputFile = outputFilePath;

      if (notebookResult.status === 'failed' || notebookResult.status === 'not_logged_in') {
        return res.json({
          success: false,
          results,
          error: `Failed to generate outline: ${notebookResult.error || notebookResult.status}`,
        });
      }

      // Check if output file exists
      if (!fs.existsSync(outputFilePath)) {
        return res.json({
          success: false,
          results,
          error: `Output file not found: ${outputFilePath}`,
        });
      }

      // Step 2: Send prompt to Gemini with the outline file
      const sendPromptResult = await sendPrompt({
        userDataDir,
        debugPort,
        gem,
        listFile: [outputFilePath],
        prompt: geminiPrompt,
      });
      results.step2_sendPrompt = sendPromptResult;

      if (sendPromptResult.status === 'failed' || sendPromptResult.status === 'not_logged_in' || sendPromptResult.status === 'gem_not_found') {
        return res.json({
          success: false,
          results,
          error: `Failed to send prompt: ${sendPromptResult.error || sendPromptResult.status}`,
        });
      }

      return res.json({
        success: true,
        results,
        message: 'All steps completed successfully',
      });
    } catch (err) {
      results.error = err?.message || String(err);
      return res.json({
        success: false,
        results,
        error: err?.message || String(err),
      });
    }
  } catch (err) {
    return next(err);
  }
});

module.exports = router;


