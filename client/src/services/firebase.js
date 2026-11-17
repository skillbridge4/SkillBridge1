const env = import.meta.env || {};
const useAuthEmulator = env.VITE_USE_AUTH_EMULATOR === 'true';
const CONFIG_FIELDS = [
  ['apiKey', 'VITE_FIREBASE_API_KEY'],
  ['authDomain', 'VITE_FIREBASE_AUTH_DOMAIN'],
  ['projectId', 'VITE_FIREBASE_PROJECT_ID'],
  ['storageBucket', 'VITE_FIREBASE_STORAGE_BUCKET'],
  ['messagingSenderId', 'VITE_FIREBASE_MESSAGING_SENDER_ID'],
  ['appId', 'VITE_FIREBASE_APP_ID']
];
const PLACEHOLDER_VALUE = /^(?:change[-_ ]?me|your(?:[-_ ].*)?|placeholder|replace(?:[-_ ].*)?|<.*>|\$\{.*\})$/i;
const configuredProjectId = typeof env.VITE_FIREBASE_PROJECT_ID === 'string'
  && env.VITE_FIREBASE_PROJECT_ID.trim().startsWith('demo-')
  ? env.VITE_FIREBASE_PROJECT_ID.trim()
  : 'demo-skillbridge';
const config = useAuthEmulator
  ? {
      apiKey: 'demo-api-key',
      authDomain: `${configuredProjectId}.firebaseapp.com`,
      projectId: configuredProjectId,
      storageBucket: `${configuredProjectId}.appspot.com`,
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:demo'
    }
  : Object.fromEntries(CONFIG_FIELDS.map(([field, variable]) => [field, env[variable]]));
const measurementId = typeof env.VITE_FIREBASE_MEASUREMENT_ID === 'string'
  ? env.VITE_FIREBASE_MEASUREMENT_ID.trim()
  : '';
if (!useAuthEmulator && measurementId && !PLACEHOLDER_VALUE.test(measurementId)) {
  config.measurementId = measurementId;
}
let missingConfigLogged = false;
const emulatorConnections = import.meta.hot?.data.firebaseEmulatorConnections
  || { auth: false, firestore: false };
if (import.meta.hot) {
  import.meta.hot.data.firebaseEmulatorConnections = emulatorConnections;
}

export function getMissingFirebaseConfig() {
  return CONFIG_FIELDS
    .filter(([field]) => {
      const value = typeof config[field] === 'string' ? config[field].trim() : '';
      return !value || PLACEHOLDER_VALUE.test(value);
    })
    .map(([, variable]) => variable);
}

export function isFirebaseConfigured() {
  const missing = getMissingFirebaseConfig();
  if (missing.length) {
    if (!missingConfigLogged) {
      console.info(
        `[Firebase] Authentication is disabled. Set ${missing.join(', ')} in the project-root .env file (copy .env.example).`
      );
      missingConfigLogged = true;
    }
    return false;
  }
  return true;
}

let app = null;
let db = null;
let auth = null;
let firestoreApi = null;

if (isFirebaseConfigured()) {
  const [appApi, firestore, authApi] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
    import('firebase/auth')
  ]);
  app = appApi.getApps().find(item => item.name === '[DEFAULT]') || appApi.initializeApp(config);
  firestoreApi = firestore;
  try {
    db = firestore.initializeFirestore(app, {
      localCache: firestore.persistentLocalCache({
        tabManager: firestore.persistentMultipleTabManager()
      })
    });
  } catch (error) {
    if (!['failed-precondition', 'unimplemented'].includes(error?.code)) throw error;
    console.warn('[Firebase] Persistent Firestore cache is unavailable; using the default cache.');
    db = firestore.getFirestore(app);
  }
  try {
    auth = authApi.initializeAuth(app, {
      persistence: authApi.browserLocalPersistence,
      popupRedirectResolver: authApi.browserPopupRedirectResolver
    });
  } catch (error) {
    if (error?.code !== 'auth/already-initialized') throw error;
    auth = authApi.getAuth(app);
  }
  if (useAuthEmulator && !emulatorConnections.firestore) {
    const emulatorHost = (env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080')
      .replace(/^https?:\/\//, '');
    const [host, port = '8080'] = emulatorHost.split(':');
    firestore.connectFirestoreEmulator(db, host, Number(port));
    emulatorConnections.firestore = true;
  }
  if (useAuthEmulator && !emulatorConnections.auth) {
    authApi.connectAuthEmulator(
      auth,
      env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'http://127.0.0.1:9099',
      { disableWarnings: true }
    );
    emulatorConnections.auth = true;
  }
}

export { app, auth, db, firestoreApi };
