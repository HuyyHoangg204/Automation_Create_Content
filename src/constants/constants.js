module.exports = {
	ACCOUNT_GOOGLE: [
		{
			email: '',
			password: '',
		},
	],
	
	// Backend API Configuration
	BACKEND_API_URL: 'http://158.69.59.214:8080',
	BACKEND_API_KEY: '', // Optional API key for authentication
	
	// RabbitMQ Configuration
	RABBITMQ_HOST: '158.69.59.214',
	RABBITMQ_PORT: '5672',
	RABBITMQ_USER: '',
	RABBITMQ_PASS: '',
	USE_RABBITMQ: true, // Set false to use HTTP fallback
	
	// FRP Tunnel Configuration
	FRP_SERVER_ADDR: '158.69.59.214',
	FRP_SERVER_PORT: '7000',
	FRP_AUTH_TOKEN: '',
	FRP_SUBDOMAIN: null, // Optional: custom subdomain, if null will use machineId
	FRP_SUBDOMAIN_HOST: 'autogencontent.xyz', // Domain for subdomain routing
	
	// Profile Configuration
	PROFILE_IDLE_TIMEOUT: 60000, // Timeout in milliseconds (60 seconds = 60000ms)
};