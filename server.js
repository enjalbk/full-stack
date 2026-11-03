'use strict';

const { createApp } = require('./backend/app');
const { startServer } = require('./backend/bootstrap/httpServer');
const { loadEnvironment } = require('./backend/config/environment');

async function main() {
  try {
    loadEnvironment();
    await startServer();
  } catch (error) {
    // Never log raw connection errors: they can contain service credentials.
    const safePrefixes = [
      'MONGODB_URI is required',
      'MongoDB must be',
      'APP_URL must be',
      'JWT_SECRET must',
      'PORT must be',
    ];

    if (error.code === 'EADDRINUSE') {
      console.error('The configured port is already in use. Stop the other server or change PORT.');
    } else if (safePrefixes.some(prefix => error.message?.startsWith(prefix))) {
      console.error(error.message);
    } else {
      console.error('Unable to start Temazon. Check .env, service credentials, and database connectivity.');
    }

    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = { createApp, startServer };
