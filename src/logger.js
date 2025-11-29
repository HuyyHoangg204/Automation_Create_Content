const pino = require('pino');
const pinoHttp = require('pino-http');
const { env } = require('./config');

const isElectron = typeof process !== 'undefined' && process.versions && process.versions.electron;

const loggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
};

if (env === 'development' && !isElectron) {
  loggerOptions.transport = { target: 'pino-pretty' };
} else {
  loggerOptions.transport = undefined;
}

const logger = pino(loggerOptions);

const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => {
      return req.url && req.url.includes('/profiles/status/stream');
    }
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      }
    }),
    res: (res) => ({
      statusCode: res.statusCode
    })
  },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  }
});

if (typeof process !== 'undefined') {
  process.on('uncaughtException', (error) => {
    if (error.message && error.message.includes('worker has exited')) {
      return;
    }
    logger.error({ err: error }, 'Uncaught exception');
  });

  process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.message && reason.message.includes('worker has exited')) {
      return;
    }
    logger.error({ err: reason }, 'Unhandled rejection');
  });
}

module.exports = { logger, httpLogger };


