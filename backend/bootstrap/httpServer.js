'use strict';

const http = require('node:http');
const { createApp } = require('../app');
const { getServerConfig } = require('../config/environment');

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function startServer({
  port,
  host,
  appFactory = createApp,
  logger = console,
} = {}) {
  const config = getServerConfig({
    PORT: port ?? process.env.PORT,
    HOST: host ?? process.env.HOST,
  });
  const app = await appFactory();
  const server = http.createServer(app);
  let shutdownPromise;

  const onSigint = () => void shutdown('SIGINT');
  const onSigterm = () => void shutdown('SIGTERM');
  const onServerError = () => {
    logger.error('HTTP server failed. Shutting down.');
    void shutdown('server error', 1);
  };

  function shutdown(reason = 'requested', exitCode = 0) {
    if (exitCode !== 0) process.exitCode = exitCode;
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.info(`Shutting down Temazon (${reason})...`);

      // Bound shutdown so hanging requests or database connections cannot keep it alive forever.
      const timeout = setTimeout(() => {
        logger.error('Graceful shutdown timed out. Closing the process.');
        server.closeAllConnections();
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      timeout.unref();

      try {
        await new Promise((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
        });
      } catch {
        process.exitCode = 1;
        logger.error('HTTP server could not close cleanly.');
      }

      try {
        await app.locals.close();
      } catch {
        process.exitCode = 1;
        logger.error('Backend connections could not close cleanly.');
      } finally {
        clearTimeout(timeout);
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
        server.removeListener('error', onServerError);
      }
    })();

    return shutdownPromise;
  }

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    try {
      await app.locals.close();
    } catch {
      logger.error('Backend cleanup failed after HTTP startup failed.');
    }
    throw error;
  }

  server.on('error', onServerError);
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  const address = server.address();
  const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
  const urlHost = displayHost.includes(':') ? `[${displayHost}]` : displayHost;
  logger.info(`Temazon is running on http://${urlHost}:${address.port}`);

  return { app, server, shutdown };
}


module.exports = { startServer };
