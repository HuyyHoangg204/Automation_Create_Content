const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const rootDir = process.cwd();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  rootDir,
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'uploads'),
};


