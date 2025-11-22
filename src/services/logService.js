const amqp = require('amqplib');

class LogService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.queueName = 'process_logs';
    this.machineId = null; // Sẽ được set từ main.js
    this.backendApiUrl = process.env.BACKEND_API_URL || 'http://localhost:8080';
    this.useRabbitMQ = process.env.USE_RABBITMQ !== 'false'; // Default: true
  }

  // Set machine ID (gọi từ main.js sau khi có machine ID)
  setMachineId(machineId) {
    this.machineId = machineId;
  }

  // Initialize RabbitMQ connection
  async initialize() {
    if (!this.useRabbitMQ) {
      console.log('RabbitMQ disabled, using HTTP fallback');
      return;
    }

    try {
      const rabbitMQHost = process.env.RABBITMQ_HOST || 'localhost';
      const rabbitMQPort = process.env.RABBITMQ_PORT || '5672';
      const rabbitMQUser = process.env.RABBITMQ_USER || 'guest';
      const rabbitMQPass = process.env.RABBITMQ_PASS || 'guest';
      
      const url = `amqp://${rabbitMQUser}:${rabbitMQPass}@${rabbitMQHost}:${rabbitMQPort}/`;
      
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      
      // Declare queue
      await this.channel.assertQueue(this.queueName, {
        durable: true
      });
      
      console.log('LogService: RabbitMQ connected');
    } catch (error) {
      console.error('LogService: Failed to connect to RabbitMQ, using HTTP fallback:', error.message);
      this.useRabbitMQ = false;
    }
  }

  // Close connection
  async close() {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }

  // Emit log (main method)
  async log(entityType, entityID, userID, stage, status, message, metadata = {}) {
    const logData = {
      entity_type: entityType,
      entity_id: entityID,
      user_id: userID,
      machine_id: this.machineId || '',
      stage: stage,
      status: status, // 'info', 'success', 'warning', 'error'
      message: message,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString()
      }
    };

    // Try RabbitMQ first, fallback to HTTP
    if (this.useRabbitMQ && this.channel) {
      try {
        await this.channel.sendToQueue(
          this.queueName,
          Buffer.from(JSON.stringify(logData)),
          { persistent: true }
        );
        return;
      } catch (error) {
        console.error('LogService: Failed to publish to RabbitMQ, trying HTTP:', error.message);
      }
    }

    // HTTP fallback
    try {
      await fetch(`${this.backendApiUrl}/api/v1/process-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(logData)
      });
    } catch (error) {
      console.error('LogService: Failed to send log via HTTP:', error.message);
    }
  }

  // Convenience methods
  async logInfo(entityType, entityID, userID, stage, message, metadata) {
    return this.log(entityType, entityID, userID, stage, 'info', message, metadata);
  }

  async logSuccess(entityType, entityID, userID, stage, message, metadata) {
    return this.log(entityType, entityID, userID, stage, 'success', message, metadata);
  }

  async logWarning(entityType, entityID, userID, stage, message, metadata) {
    return this.log(entityType, entityID, userID, stage, 'warning', message, metadata);
  }

  async logError(entityType, entityID, userID, stage, message, metadata) {
    return this.log(entityType, entityID, userID, stage, 'error', message, metadata);
  }
}

// Singleton instance
const logService = new LogService();

module.exports = logService;