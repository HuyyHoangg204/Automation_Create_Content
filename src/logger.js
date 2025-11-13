const pino = require('pino');
const pinoHttp = require('pino-http');
const { env } = require('./config');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: env === 'development' ? { target: 'pino-pretty' } : undefined,
});

const httpLogger = pinoHttp({
  logger,
});

module.exports = { logger, httpLogger };


