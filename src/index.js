const path = require('path');
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const { port, uploadDir } = require('./config');
const { httpLogger, logger } = require('./logger');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./docs/openapi');

// Routes
const uploadRouter = require('./routes/upload');
const chromeRouter = require('./routes/chrome');
const notebookLMRouter = require('./routes/notebooklm');
const geminiRouter = require('./routes/gemini');

// Error middleware
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

async function bootstrap() {
  await fs.ensureDir(uploadDir);

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(httpLogger);

  // Swagger docs
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.get('/docs.json', (req, res) => res.json(openapi));

  app.use('/upload', uploadRouter);
  app.use('/chrome', chromeRouter);
  app.use('/notebooklm', notebookLMRouter);
  app.use('/gemini', geminiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(port, () => {
    logger.info({ port }, 'Server started');
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


