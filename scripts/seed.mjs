import { readFileSync, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(root, 'server/.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const selectedCollection = args.find(arg => arg.startsWith('--collection='))?.split('=')[1] || null;
const adminUid = args.find(arg => arg.startsWith('--make-admin='))?.split('=')[1] || null;
const collections = ['companies', 'internships', 'courses', 'videos'];
if (selectedCollection && !collections.includes(selectedCollection)) {
  throw new Error(`Unknown collection: ${selectedCollection}`);
}

async function loadCollection(collectionName) {
  const file = resolve(root, 'data/seed', `${collectionName}.json`);
  try {
    const records = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(records)) throw new TypeError(`${file} must contain a JSON array.`);
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function ensureFirebaseApp() {
  if (!getApps().length) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-skillbridge' });
      return;
    }
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
      const keyPath = resolve(root, 'server', serviceAccountPath);
      const account = JSON.parse(readFileSync(keyPath, 'utf8'));
      initializeApp({
        credential: cert(account),
        projectId: process.env.FIREBASE_PROJECT_ID || account.project_id
      });
    } else {
      initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    }
  }
}

const dataByCollection = new Map();
for (const collectionName of selectedCollection ? [selectedCollection] : collections) {
  dataByCollection.set(collectionName, await loadCollection(collectionName));
}

const counts = Object.fromEntries([...dataByCollection].map(([name, records]) => [name, records.length]));
if (adminUid) counts.admins = 1;
if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, counts }, null, 2));
  process.exit(0);
}

ensureFirebaseApp();
const db = getFirestore();
let batch = db.batch();
let writes = 0;
const results = {};
for (const [collectionName, records] of dataByCollection) {
  let count = 0;
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !record.id.trim()) {
      throw new Error(`${collectionName} contains a record without a stable string id.`);
    }
    batch.set(db.collection(collectionName).doc(record.id), record, { merge: true });
    count += 1;
    writes += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  results[collectionName] = count;
}
if (adminUid) {
  await getAuth().getUser(adminUid);
  batch.set(db.collection('admins').doc(adminUid), { uid: adminUid, createdAt: new Date().toISOString() }, { merge: true });
  writes += 1;
  results.admins = 1;
}
if (writes) await batch.commit();
console.log(JSON.stringify({ dryRun: false, counts: results }, null, 2));
