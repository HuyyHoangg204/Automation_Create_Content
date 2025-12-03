// Load environment variables from .env file
require('dotenv').config();

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