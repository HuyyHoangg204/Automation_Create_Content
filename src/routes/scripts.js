const express = require('express');
const { scriptSchema } = require('../validation/scriptSchema');
const { validateBody } = require('../middleware/validators');
const { submitScript } = require('../services/executor');

const router = express.Router();

router.post('/', validateBody(scriptSchema), (req, res) => {
  const script = req.validatedBody;
  const jobId = submitScript(script);
  res.status(202).json({ jobId });
});

module.exports = router;


