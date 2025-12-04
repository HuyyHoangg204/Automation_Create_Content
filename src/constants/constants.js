// Load environment variables from .env file
// Try multiple paths for .env file (dev and production)
const path = require('path');
const fs = require('fs');
const os = require('os');

function loadEnvFile() {
  const possiblePaths = [
    // 1. Current working directory (dev mode)
    path.join(process.cwd(), '.env'),
    // 2. __dirname (if called from electron/main.js)
    path.join(__dirname, '..', '..', '.env'),
    // 3. Resources path (production - unpacked)
    process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
    // 4. App path (production - in app.asar)
    process.env.APP_ROOT ? path.join(process.env.APP_ROOT, '.env') : null,
    // 5. App.asar.unpacked
    process.resourcesPath ? path.join(path.dirname(process.resourcesPath), 'app.asar.unpacked', '.env') : null,
  ].filter(Boolean);

  for (const envPath of possiblePaths) {
    try {
      if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        console.log(`[Constants] Loaded .env from: ${envPath}`);
        return envPath;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  // Fallback: try default dotenv.config() (will look in process.cwd())
  try {
    require('dotenv').config();
    console.log('[Constants] Loaded .env from default location (process.cwd())');
  } catch (error) {
    console.warn('[Constants] Could not load .env file, using defaults');
  }
  
  return null;
}

loadEnvFile();

module.exports = {
	ACCOUNT_GOOGLE: [
		{
			email: process.env.GOOGLE_ACCOUNT_EMAIL || '',
			password: process.env.GOOGLE_ACCOUNT_PASSWORD || '',
		},
	],
	
	// Backend API Configuration
	BACKEND_API_URL: process.env.BACKEND_API_URL || 'http://158.69.59.214:8080',
	BACKEND_API_KEY: process.env.BACKEND_API_KEY || '',
	
	// RabbitMQ Configuration
	RABBITMQ_HOST: process.env.RABBITMQ_HOST || '158.69.59.214',
	RABBITMQ_PORT: process.env.RABBITMQ_PORT || '5672',
	RABBITMQ_USER: process.env.RABBITMQ_USER || '',
	RABBITMQ_PASS: process.env.RABBITMQ_PASS || '',
	USE_RABBITMQ: process.env.USE_RABBITMQ !== 'false',
	
	// FRP Tunnel Configuration
	FRP_SERVER_ADDR: process.env.FRP_SERVER_ADDR || '158.69.59.214',
	FRP_SERVER_PORT: process.env.FRP_SERVER_PORT || '7000',
	FRP_AUTH_TOKEN: process.env.FRP_AUTH_TOKEN || '',
	FRP_SUBDOMAIN: process.env.FRP_SUBDOMAIN || null,
	FRP_SUBDOMAIN_HOST: process.env.FRP_SUBDOMAIN_HOST || 'autogencontent.xyz',
	
	// Profile Configuration
	PROFILE_IDLE_TIMEOUT: parseInt(process.env.PROFILE_IDLE_TIMEOUT || '60000', 10),
};