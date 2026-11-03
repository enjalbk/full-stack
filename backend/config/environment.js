'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadEnvironment() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');

  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

function getServerConfig(env = process.env) {
  const value = env.PORT ?? '8080';

  if (!/^\d+$/.test(String(value))) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  return { port, host: env.HOST || '0.0.0.0' };
}

module.exports = { loadEnvironment, getServerConfig };
