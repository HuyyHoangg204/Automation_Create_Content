const { z } = require('zod');

const moveStep = z.object({
  action: z.literal('move'),
  x: z.number(),
  y: z.number(),
  durationMs: z.number().int().positive().optional(),
});

const clickStep = z.object({
  action: z.literal('click'),
  button: z.enum(['left', 'right', 'middle']).optional().default('left'),
  double: z.boolean().optional().default(false),
});

const typeStep = z.object({
  action: z.literal('type'),
  text: z.string(),
});

const keyPressStep = z.object({
  action: z.literal('keyPress'),
  keys: z.array(z.string().min(1)).min(1),
});

const keyTapStep = z.object({
  action: z.literal('keyTap'),
  key: z.string().min(1),
});

const pasteStep = z.object({
  action: z.literal('paste'),
  text: z.string(),
});

const waitStep = z.object({
  action: z.literal('wait'),
  ms: z.number().int().nonnegative(),
});

const stepSchema = z.discriminatedUnion('action', [
  moveStep,
  clickStep,
  typeStep,
  keyPressStep,
  keyTapStep,
  pasteStep,
  waitStep,
]);

const scriptSchema = z.object({
  name: z.string().optional().default('script'),
  steps: z.array(stepSchema).min(1),
});

module.exports = { scriptSchema, stepSchema };


