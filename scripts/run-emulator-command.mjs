import { spawn } from 'node:child_process';

const npmScript = process.argv[2];
if (!['dev', 'test:e2e'].includes(npmScript)) {
  throw new Error('Run this helper with either "dev" or "test:e2e".');
}

if (!process.env.npm_execpath) {
  throw new Error('Could not locate npm. Run this helper through an npm script.');
}

const child = spawn(process.execPath, [process.env.npm_execpath, 'run', npmScript], {
  env: {
    ...process.env,
    VITE_USE_AUTH_EMULATOR: 'true',
    VITE_FIREBASE_PROJECT_ID: 'demo-skillbridge',
    VITE_FIREBASE_AUTH_EMULATOR_HOST: 'http://127.0.0.1:9099',
    VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_PROJECT_ID: 'demo-skillbridge',
    GCLOUD_PROJECT: 'demo-skillbridge',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
  },
  stdio: 'inherit'
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}

child.once('error', error => {
  console.error(`[emulator] Could not start npm ${npmScript}: ${error.message}`);
  process.exitCode = 1;
});

child.once('close', (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
