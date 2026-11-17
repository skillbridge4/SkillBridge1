import assert from 'node:assert/strict';
import test from 'node:test';
import { getDevConfig } from '../scripts/dev-config.mjs';

test('development ports default consistently across the client, API, and e2e server', () => {
  const config = getDevConfig({});
  assert.equal(config.webPort, 3000);
  assert.equal(config.apiPort, 3001);
  assert.equal(config.testWebPort, 4173);
  assert.equal(config.apiProxyTarget, 'http://127.0.0.1:3001');
  assert.deepEqual(config.webOrigins, ['http://localhost:3000', 'http://127.0.0.1:3000']);
});

test('development URLs and proxy use the configured ports', () => {
  const config = getDevConfig({
    SKILLBRIDGE_WEB_PORT: '3100',
    SKILLBRIDGE_API_PORT: '3101',
    SKILLBRIDGE_TEST_WEB_PORT: '4174'
  });
  assert.equal(config.webUrl, 'http://localhost:3100');
  assert.equal(config.apiUrl, 'http://localhost:3101');
  assert.equal(config.testWebUrl, 'http://127.0.0.1:4174');
  assert.equal(config.apiProxyTarget, 'http://127.0.0.1:3101');
  assert.deepEqual(config.webOrigins, ['http://localhost:3100', 'http://127.0.0.1:3100']);
});

test('development port configuration rejects invalid or duplicate ports', () => {
  assert.throws(() => getDevConfig({ SKILLBRIDGE_WEB_PORT: '0' }), /SKILLBRIDGE_WEB_PORT/);
  assert.throws(() => getDevConfig({
    SKILLBRIDGE_WEB_PORT: '3100',
    SKILLBRIDGE_API_PORT: '3100'
  }), /must be different/);
});
