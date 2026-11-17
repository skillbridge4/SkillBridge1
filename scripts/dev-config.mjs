import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WEB_PORT = 3000;
const DEFAULT_API_PORT = 3001;
const DEFAULT_TEST_WEB_PORT = 4173;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadDevEnvironment() {
  loadDotenv({ path: resolve(projectRoot, '.env') });
  return process.env;
}

export function parsePort(value, name, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

export function getDevConfig(environment = process.env) {
  const webPort = parsePort(environment.SKILLBRIDGE_WEB_PORT, 'SKILLBRIDGE_WEB_PORT', DEFAULT_WEB_PORT);
  const apiPort = parsePort(environment.SKILLBRIDGE_API_PORT, 'SKILLBRIDGE_API_PORT', DEFAULT_API_PORT);
  const testWebPort = parsePort(environment.SKILLBRIDGE_TEST_WEB_PORT, 'SKILLBRIDGE_TEST_WEB_PORT', DEFAULT_TEST_WEB_PORT);

  if (new Set([webPort, apiPort, testWebPort]).size !== 3) {
    throw new Error('SKILLBRIDGE_WEB_PORT, SKILLBRIDGE_API_PORT, and SKILLBRIDGE_TEST_WEB_PORT must be different.');
  }

  return {
    webHost: environment.SKILLBRIDGE_WEB_HOST || '0.0.0.0',
    webPort,
    apiPort,
    testWebPort,
    webUrl: `http://localhost:${webPort}`,
    apiUrl: `http://localhost:${apiPort}`,
    testWebUrl: `http://127.0.0.1:${testWebPort}`,
    apiProxyTarget: `http://127.0.0.1:${apiPort}`,
    webOrigins: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`]
  };
}
