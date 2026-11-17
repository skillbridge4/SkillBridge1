import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { getDevConfig, loadDevEnvironment } from './dev-config.mjs';

loadDevEnvironment();
const config = getDevConfig();

console.log([
  '',
  '[SkillBridge] Starting local development servers.',
  `Web: ${config.webUrl}`,
  `API: ${config.apiUrl}`,
  'Vite strictPort is enabled; it will not silently choose another port.',
  ''
].join('\n'));

function probePort(port) {
  return new Promise((resolveAvailability, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolveAvailability(false);
        return;
      }
      reject(error);
    });
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(error => {
        if (error) reject(error);
        else resolveAvailability(true);
      });
    });
  });
}

function findWindowsOwner(port) {
  try {
    const result = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','`
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...new Set(result.split(/[,\s]+/).filter(Boolean).map(Number))];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[SkillBridge] Could not query the owner of port ${port}: ${error.message}`);
    }
    return null;
  }
}

async function inspectPort(port) {
  const available = await probePort(port);
  if (process.platform === 'win32') {
    const owners = findWindowsOwner(port);
    if (owners !== null) return { available: available && owners.length === 0, owners };
  }
  return { available, owners: [] };
}

const ports = [
  { label: 'web', port: config.webPort },
  { label: 'API', port: config.apiPort }
];
const occupied = [];

for (const entry of ports) {
  const status = await inspectPort(entry.port);
  if (!status.available) occupied.push({ ...entry, owners: status.owners });
}

if (occupied.length) {
  for (const { label, port, owners } of occupied) {
    console.error(`[SkillBridge] The ${label} port ${port} is already in use${owners.length ? ` by PID ${owners.join(', ')}` : ''}.`);
    console.error(`Inspect it with: Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object LocalAddress,OwningProcess`);
    for (const owner of owners) {
      console.error(`If you started PID ${owner} and want to stop it: Stop-Process -Id ${owner}`);
    }
    if (!owners.length) console.error('After verifying the owner, stop that specific process before retrying.');
  }
  console.error('No processes were stopped. Free the required ports and run `npm run dev` again.');
  process.exitCode = 1;
}
