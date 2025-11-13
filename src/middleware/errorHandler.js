const { ZodError } = require('zod');
const { logger } = require('../logger');

function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'ValidationError', details: err.issues });
  }
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.name || 'Error',
    message: err.message || 'Unexpected error',
  };
  if (status >= 500) {
    logger.error({ err }, 'Unhandled error');
  }
  return res.status(status).json(payload);
}

module.exports = { notFoundHandler, errorHandler };


