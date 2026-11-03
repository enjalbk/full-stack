'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../server');
const { getServerConfig } = require('../backend/config/environment');

const logger = { info() {}, error() {} };

function testApp(onClose = async () => {}) {
  const app = (req, res) => res.end('Temazon test server');
  app.locals = { close: onClose };
  return app;
}

test('server configuration validates ports before connecting to services', async () => {
  assert.deepEqual(getServerConfig({}), { port: 8080, host: '0.0.0.0' });
  assert.equal(getServerConfig({ PORT: '9000' }).port, 9000);
  assert.equal(getServerConfig({ PORT: '0' }).port, 0);

  for (const PORT of ['abc', '', '-1', '8080.5', '65536']) {
    assert.throws(() => getServerConfig({ PORT }), /PORT must be/);
  }

  let called = false;
  await assert.rejects(
    startServer({ port: 'invalid', appFactory: async () => { called = true; }, logger }),
    /PORT must be/,
  );
  assert.equal(called, false);
});

test('server starts, serves requests, and shuts down exactly once', async t => {
  let closes = 0;
  const originalListeners = process.listenerCount('SIGTERM');
  const running = await startServer({
    port: 0,
    host: '127.0.0.1',
    appFactory: async () => testApp(async () => { closes++; }),
    logger,
  });
  t.after(() => running.shutdown());

  const response = await fetch(`http://127.0.0.1:${running.server.address().port}`);
  assert.equal(await response.text(), 'Temazon test server');
  assert.equal(process.listenerCount('SIGTERM'), originalListeners + 1);

  const first = running.shutdown();
  assert.equal(running.shutdown(), first);
  await first;

  assert.equal(closes, 1);
  assert.equal(running.server.listening, false);
  assert.equal(process.listenerCount('SIGTERM'), originalListeners);
});

test('occupied ports close backend connections and do not install signal listeners', async t => {
  const running = await startServer({ port: 0, host: '127.0.0.1', appFactory: async () => testApp(), logger });
  t.after(() => running.shutdown());
  const listeners = process.listenerCount('SIGINT');
  let closes = 0;

  await assert.rejects(startServer({
    port: running.server.address().port,
    host: '127.0.0.1',
    appFactory: async () => testApp(async () => { closes++; }),
    logger,
  }), { code: 'EADDRINUSE' });

  assert.equal(closes, 1);
  assert.equal(process.listenerCount('SIGINT'), listeners);
});
