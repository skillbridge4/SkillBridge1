import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { getDevConfig, loadDevEnvironment, parsePort } from '../scripts/dev-config.mjs';

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(serverDirectory, '..', 'package.json'));
const express = require('express');
const { applicationDefault, cert, initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const dotenv = require('dotenv');
loadDevEnvironment();
dotenv.config({ path: resolve(serverDirectory, '.env') });
const devConfig = getDevConfig();
const isProduction = Boolean(process.env.K_SERVICE || process.env.NODE_ENV === 'production');
const {
  createCertificateId,
  createCertificateSignature,
  gradeQuiz,
  isPathComplete,
  isValidCertificateId,
  quizAttemptsAllowed,
  shuffle,
  validatePaths,
  verifyCertificateSignature
} = await import('./certificate-utils.js');
const { createAiRouter } = await import('./ai/routes.js');

const app = express();
const port = isProduction
  ? parsePort(process.env.PORT, 'PORT', devConfig.apiPort)
  : devConfig.apiPort;
const pathsFile = resolve(serverDirectory, '..', 'data', 'seed', 'paths.json');
const paths = JSON.parse(readFileSync(pathsFile, 'utf8'));
const videos = JSON.parse(readFileSync(resolve(serverDirectory, '..', 'data', 'seed', 'videos.json'), 'utf8'));
const courses = JSON.parse(readFileSync(resolve(serverDirectory, '..', 'data', 'seed', 'courses.json'), 'utf8'));
const pathErrors = validatePaths(paths, videos, courses);
if (pathErrors.length) throw new Error(`Invalid learning path data:\n${pathErrors.join('\n')}`);
let adminReady = false;
const rateLimitBuckets = new Map();
const CERTIFICATE_ISSUER = 'SkillBridge';
const verifyMinimumResponseMs = 120;
const certificateSecret = process.env.CERTIFICATE_HMAC_SECRET || '';

function initializeAdmin() {
  if (getApps().length) {
    adminReady = true;
    return;
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-skillbridge' });
    adminReady = true;
    return;
  }
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath) {
    const accountPath = resolve(serverDirectory, serviceAccountPath);
    if (!existsSync(accountPath)) {
      if (process.env.K_SERVICE) {
        initializeApp({
          credential: applicationDefault(),
          projectId: process.env.FIREBASE_PROJECT_ID
        });
        adminReady = true;
        return;
      }
      console.error(`[server] Firebase service account file not found: ${accountPath}`);
      return;
    }
    const account = JSON.parse(readFileSync(accountPath, 'utf8'));
    initializeApp({ credential: cert(account), projectId: process.env.FIREBASE_PROJECT_ID });
    adminReady = true;
    return;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  adminReady = true;
}

function optionalAuthenticate(request, _response, next) {
  const authorization = request.get('authorization');
  if (!authorization) {
    next();
    return;
  }
  authenticate(request, _response, next);
}

app.disable('x-powered-by');
if (process.env.K_SERVICE) app.set('trust proxy', 1);
app.use('/api/ai/resume', express.json({ limit: '100kb' }));
app.use(express.json({ limit: '24kb' }));
app.use((request, response, next) => {
  const origin = request.get('origin');
  const configuredOrigins = [...new Set([
    ...(isProduction ? [] : devConfig.webOrigins),
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ])];
  if (origin && configuredOrigins.includes(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  } else if (origin && configuredOrigins.length) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  next();
});

app.use('/api/ai', createAiRouter(express, {
  optionalAuthenticate,
  rateLimit,
  requireFirestore
}));

app.get('/api/paths', (_request, response) => {
  response.json(paths.map(({ quiz, ...path }) => ({
    ...path,
    questionCount: quiz.questions.length
  })));
});

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/paths/progress', authenticate, async (request, response) => {
  const db = requireFirestore();
  const [declarations, results] = await Promise.all([
    db.collection('pathCourseDeclarations').where('uid', '==', request.user.uid).get(),
    db.collection('pathQuizResults').where('uid', '==', request.user.uid).get()
  ]);
  response.json({
    courseDeclarations: declarations.docs.map(doc => ({
      pathId: doc.get('pathId'),
      courseId: doc.get('courseId'),
      note: doc.get('note') || ''
    })),
    quizResults: results.docs.map(doc => ({
      pathId: doc.get('pathId'),
      passed: doc.get('passed') === true,
      score: doc.get('score') || 0,
      submittedAt: doc.get('submittedAt') || null
    }))
  });
});

app.post('/api/paths/migrate-guest-progress', authenticate, rateLimit('guest-progress-migration', 10, 60_000), firestoreRateLimit('guest-progress-migration', 10, 60_000), async (request, response) => {
  const guestSessionHash = hashGuestSession(request.body?.guestSessionId);
  const db = requireFirestore();
  const guestResultRefs = paths.map(path => db.collection('guestPathQuizResults')
    .doc(progressDocumentId(guestSessionHash, path.id)));
  await db.runTransaction(async transaction => {
    const guestResults = await Promise.all(guestResultRefs.map(ref => transaction.get(ref)));
    guestResults.forEach((snapshot, index) => {
      if (!snapshot.exists || snapshot.get('passed') !== true || snapshot.get('claimedBy')) return;
      const pathId = paths[index].id;
      transaction.set(db.collection('pathQuizResults')
        .doc(progressDocumentId(request.user.uid, pathId)), {
        uid: request.user.uid,
        pathId,
        passed: true,
        score: snapshot.get('score'),
        submittedAt: snapshot.get('submittedAt'),
        migratedFromGuest: true
      }, { merge: true });
      transaction.update(guestResultRefs[index], { claimedBy: request.user.uid });
    });
  });
  response.json({ migrated: true });
});

app.post('/api/paths/:pathId/course-declaration', optionalAuthenticate, rateLimit('course-declaration', 30, 60_000), firestoreRateLimit('course-declaration', 30, 60_000), async (request, response) => {
  const path = getPath(request.params.pathId);
  const courseId = request.body?.courseId;
  const note = request.body?.note ?? '';
  if (typeof courseId !== 'string' || typeof note !== 'string' || note.length > 240) {
    throw httpError(400, 'A valid course ID and a note of at most 240 characters are required.');
  }
  if (!path.items.some(item => item.type === 'course' && item.required && item.id === courseId)) {
    throw httpError(400, 'That course is not a required step in this learning path.');
  }
  const db = requireFirestore();
  const ownerId = request.user?.uid || hashGuestSession(request.body?.guestSessionId);
  const collectionName = request.user ? 'pathCourseDeclarations' : 'guestPathCourseDeclarations';
  const ref = db.collection(collectionName).doc(progressDocumentId(ownerId, path.id, courseId));
  await ref.set({
    uid: request.user?.uid || null,
    guestSessionHash: request.user ? null : ownerId,
    pathId: path.id,
    courseId,
    note: note.trim(),
    declaredAt: new Date().toISOString()
  }, { merge: true });
  response.json({ pathId: path.id, courseId, declared: true });
});

app.post('/api/paths/:pathId/quiz/start', optionalAuthenticate, rateLimit('quiz-start', 12, 60_000), firestoreRateLimit('quiz-start', 12, 60_000), async (request, response) => {
  const path = getPath(request.params.pathId);
  const db = requireFirestore();
  const guestSessionHash = request.user ? null : hashGuestSession(request.body?.guestSessionId);
  const stepsComplete = request.user
    ? await isPathStepsComplete(db, request.user.uid, path)
    : isGuestPathComplete(path, request.body?.watchedVideoIds, request.body?.declaredCourseIds);
  if (!stepsComplete) {
    throw httpError(409, 'Complete every required watched-video and course-declaration step before starting the quiz.');
  }
  const attemptId = randomUUID();
  const now = Date.now();
  const ownerId = request.user?.uid || `guest--${guestSessionHash}`;
  const ledgerRef = db.collection('pathQuizLedgers').doc(progressDocumentId(ownerId, path.id));
  const attemptRef = db.collection('pathQuizAttempts').doc(attemptId);
  const prepared = buildQuizAttempt(path);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ledgerRef);
    const attempts = snapshot.exists ? snapshot.get('attemptTimestamps') : [];
    if (!quizAttemptsAllowed(attempts, now)) {
      throw httpError(429, 'You have used all 3 quiz attempts for this path in the last 24 hours.');
    }
    transaction.set(ledgerRef, {
      uid: request.user?.uid || null,
      guestSessionHash,
      pathId: path.id,
      attemptTimestamps: [...(Array.isArray(attempts) ? attempts.filter(value => value > now - 86_400_000) : []), now]
    });
    transaction.create(attemptRef, {
      uid: request.user?.uid || null,
      guestSessionHash,
      pathId: path.id,
      questions: prepared.privateQuestions,
      createdAt: now,
      expiresAt: now + 30 * 60_000,
      used: false
    });
  });
  response.json({
    attemptId,
    expiresAt: now + 30 * 60_000,
    questions: prepared.publicQuestions,
    passMark: path.passMark
  });
});

app.post('/api/paths/:pathId/quiz/submit', optionalAuthenticate, rateLimit('quiz-submit', 12, 60_000), firestoreRateLimit('quiz-submit', 12, 60_000), async (request, response) => {
  const path = getPath(request.params.pathId);
  const attemptId = request.body?.attemptId;
  const answers = request.body?.answers;
  if (typeof attemptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(attemptId)) {
    throw httpError(400, 'A valid quiz attempt is required.');
  }
  const db = requireFirestore();
  const attemptRef = db.collection('pathQuizAttempts').doc(attemptId);
  const attemptSnapshot = await attemptRef.get();
  const guestSessionHash = request.user ? null : hashGuestSession(request.body?.guestSessionId);
  const ownsAttempt = request.user
    ? attemptSnapshot.exists && attemptSnapshot.get('uid') === request.user.uid
    : attemptSnapshot.exists && attemptSnapshot.get('guestSessionHash') === guestSessionHash;
  if (!ownsAttempt
    || attemptSnapshot.get('pathId') !== path.id
    || attemptSnapshot.get('used') === true
    || attemptSnapshot.get('expiresAt') < Date.now()) {
    throw httpError(400, 'This quiz attempt is invalid, expired, or already submitted.');
  }
  const quizQuestions = attemptSnapshot.get('questions');
  let graded;
  try {
    graded = gradeQuiz(quizQuestions, answers);
  } catch (error) {
    throw httpError(400, error.message);
  }
  const passed = graded.score >= path.passMark;
  const resultCollection = request.user ? 'pathQuizResults' : 'guestPathQuizResults';
  const ownerId = request.user?.uid || guestSessionHash;
  const resultRef = db.collection(resultCollection).doc(progressDocumentId(ownerId, path.id));
  await db.runTransaction(async transaction => {
    const freshAttempt = await transaction.get(attemptRef);
    if (!freshAttempt.exists || freshAttempt.get('used') === true
      || (request.user
        ? freshAttempt.get('uid') !== request.user.uid
        : freshAttempt.get('guestSessionHash') !== guestSessionHash)
      || freshAttempt.get('expiresAt') < Date.now()) {
      throw httpError(409, 'This quiz attempt has already been submitted.');
    }
    transaction.update(attemptRef, { used: true, submittedAt: new Date().toISOString() });
    transaction.set(resultRef, {
      uid: request.user?.uid || null,
      guestSessionHash,
      pathId: path.id,
      passed,
      score: graded.score,
      submittedAt: new Date().toISOString(),
      attemptId
    }, { merge: true });
  });
  response.json({ ...graded, passed, passMark: path.passMark });
});

app.post('/api/certificates/recipient-name', authenticate, rateLimit('recipient-name', 10, 60_000), firestoreRateLimit('recipient-name', 10, 60_000), async (request, response) => {
  const name = normalizeRecipientName(request.body?.name);
  const db = requireFirestore();
  const profile = await db.collection('users').doc(request.user.uid).get();
  if (!profile.exists) throw httpError(400, 'Save your profile before setting a certificate name.');
  const savedProfileName = profile.get('profile.name') || profile.get('name');
  if (typeof savedProfileName === 'string' && savedProfileName.trim() && name !== savedProfileName.trim()) {
    throw httpError(400, 'The certificate name must match the name saved in your profile.');
  }
  const settingsRef = db.collection('certificateSettings').doc(request.user.uid);
  const certQuery = db.collection('certificates').where('uid', '==', request.user.uid).where('status', '==', 'valid').limit(1);
  await db.runTransaction(async transaction => {
    const [settings, activeCertificates] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(certQuery)
    ]);
    if (settings.exists) {
      const currentName = settings.get('recipientName');
      if (currentName === name) return;
      if (!activeCertificates.empty) throw httpError(409, 'Certificate name cannot be changed after a certificate is issued.');
      if ((settings.get('nameEdits') || 0) >= 1) {
        throw httpError(409, 'The one allowed certificate-name edit has already been used.');
      }
      transaction.update(settingsRef, { recipientName: name, nameEdits: (settings.get('nameEdits') || 0) + 1 });
    } else {
      if (!activeCertificates.empty) throw httpError(409, 'Certificate name cannot be changed after a certificate is issued.');
      transaction.create(settingsRef, { uid: request.user.uid, recipientName: name, nameEdits: 0 });
    }
  });
  response.json({ recipientName: name });
});

app.post('/api/certificates/issue', authenticate, rateLimit('certificate-issue', 5, 60_000), firestoreRateLimit('certificate-issue', 5, 60_000), async (request, response) => {
  if (request.body?.consent !== true) throw httpError(400, 'Consent to public display of your name and learning path is required.');
  if (certificateSecret.length < 32) throw httpError(503, 'Certificate signing is not configured on the server.');
  const path = getPath(request.body?.pathId);
  const db = requireFirestore();
  const [settings, completed, quizResult] = await Promise.all([
    db.collection('certificateSettings').doc(request.user.uid).get(),
    isPathStepsComplete(db, request.user.uid, path),
    db.collection('pathQuizResults').doc(progressDocumentId(request.user.uid, path.id)).get()
  ]);
  if (!completed) throw httpError(409, 'Complete every required learning-path step before requesting a certificate.');
  if (!quizResult.exists || quizResult.get('passed') !== true) throw httpError(409, 'Pass the final quiz before requesting a certificate.');
  if (!settings.exists) throw httpError(409, 'Set your certificate recipient name before issuing.');
  const recipientName = normalizeRecipientName(settings.get('recipientName'));
  const certRef = await getOrCreateCertificate(db, request.user.uid, path, recipientName, quizResult.get('score'));
  response.status(201).json(publicOwnerCertificate(certRef));
});

app.get('/api/certificates/mine', authenticate, async (request, response) => {
  requireCertificateSecret();
  const db = requireFirestore();
  const snapshot = await db.collection('certificates').where('uid', '==', request.user.uid).limit(100).get();
  const records = snapshot.docs
    .map(item => item.data())
    .filter(item => verifyCertificateSignature(item, certificateSecret))
    .map(publicOwnerCertificate);
  response.json(records);
});

app.get('/api/certificates/verify/:certId', rateLimit('certificate-verify', 60, 60_000), firestoreRateLimit('certificate-verify', 60, 60_000), async (request, response) => {
  const startedAt = Date.now();
  let result = { status: 'not_found' };
  if (!adminReady || certificateSecret.length < 32) {
    await delay(Math.max(0, verifyMinimumResponseMs - (Date.now() - startedAt)));
    throw httpError(503, 'Certificate verification is not configured.');
  }
  if (isValidCertificateId(request.params.certId)) {
    const snapshot = await getFirestore().collection('certificates').doc(request.params.certId).get();
    if (snapshot.exists) {
      const record = snapshot.data();
      if (verifyCertificateSignature(record, certificateSecret)) {
        result = {
          status: record.status === 'valid' ? 'valid' : 'revoked',
          recipientName: record.recipientName || null,
          pathTitle: record.pathTitle,
          issuedAt: record.issuedAt,
          issuer: CERTIFICATE_ISSUER,
          ...(record.showScorePublicly === true ? { score: record.score } : {})
        };
      }
    }
  }
  await delay(Math.max(0, verifyMinimumResponseMs - (Date.now() - startedAt)));
  response.json(result);
});

app.patch('/api/certificates/:certId/score-visibility', authenticate, rateLimit('certificate-visibility', 20, 60_000), firestoreRateLimit('certificate-visibility', 20, 60_000), async (request, response) => {
  if (!isValidCertificateId(request.params.certId)) throw httpError(404, 'Certificate not found.');
  if (typeof request.body?.showScorePublicly !== 'boolean') throw httpError(400, 'A boolean score visibility choice is required.');
  const db = requireFirestore();
  const ref = db.collection('certificates').doc(request.params.certId);
  const updated = await updateOwnedCertificate(db, ref, request.user.uid, record => ({
    ...record,
    showScorePublicly: request.body.showScorePublicly
  }));
  response.json(publicOwnerCertificate(updated));
});

app.delete('/api/certificates/:certId', authenticate, rateLimit('certificate-delete', 5, 60_000), firestoreRateLimit('certificate-delete', 5, 60_000), async (request, response) => {
  if (!isValidCertificateId(request.params.certId)) throw httpError(404, 'Certificate not found.');
  const db = requireFirestore();
  const ref = db.collection('certificates').doc(request.params.certId);
  const updated = await updateOwnedCertificate(db, ref, request.user.uid, record => ({
    ...record,
    uid: null,
    recipientName: null,
    score: null,
    hours: null,
    showScorePublicly: false,
    publicDisplayConsent: false,
    status: 'revoked',
    revocationReason: 'Deleted by certificate owner'
  }));
  const activeCertificates = await db.collection('certificates')
    .where('uid', '==', request.user.uid).where('status', '==', 'valid').limit(1).get();
  if (activeCertificates.empty) await db.collection('certificateSettings').doc(request.user.uid).delete();
  response.json({ certId: updated.certId, status: updated.status });
});

app.get('/api/admin/certificates', authenticate, async (request, response) => {
  const db = requireFirestore();
  if (!await isAdmin(request.user.uid)) throw httpError(403, 'Administrator access is required.');
  requireCertificateSecret();
  const snapshot = await db.collection('certificates').orderBy('issuedAt', 'desc').limit(100).get();
  response.json(snapshot.docs.map(item => {
    const record = item.data();
    if (!verifyCertificateSignature(record, certificateSecret)) return null;
    return {
      certId: record.certId,
      recipientName: record.recipientName,
      pathTitle: record.pathTitle,
      issuedAt: record.issuedAt,
      status: record.status
    };
  }).filter(Boolean));
});

app.post('/api/admin/certificates/:certId/revoke', authenticate, rateLimit('certificate-revoke', 20, 60_000), firestoreRateLimit('certificate-revoke', 20, 60_000), async (request, response) => {
  const db = requireFirestore();
  if (!await isAdmin(request.user.uid)) throw httpError(403, 'Administrator access is required.');
  if (!isValidCertificateId(request.params.certId)) throw httpError(404, 'Certificate not found.');
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (!reason || reason.length > 240) throw httpError(400, 'A revocation reason of 1-240 characters is required.');
  const ref = db.collection('certificates').doc(request.params.certId);
  const updated = await updateOwnedCertificate(db, ref, null, record => ({
    ...record,
    status: 'revoked',
    revocationReason: reason
  }));
  response.json({ certId: updated.certId, status: updated.status });
});

app.use((error, _request, response, _next) => {
  if (response.headersSent) return;
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('[API] Request failed.', error);
  response.status(status).json({ error: status >= 500 ? 'The request could not be completed.' : error.message });
});

app.listen(port, () => {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? resolve(serverDirectory, process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : null;
  if (process.env.FIRESTORE_EMULATOR_HOST
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || process.env.K_SERVICE
    || (serviceAccountPath && existsSync(serviceAccountPath))) {
    initializeAdmin();
  }
  console.log(`[server] Listening on http://localhost:${port}`);
});

function authenticate(request, _response, next) {
  const token = request.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token || !adminReady) {
    next(httpError(401, 'Sign in is required.'));
    return;
  }
  getAuth().verifyIdToken(token, true).then(decoded => {
    request.user = decoded;
    next();
  }).catch(() => next(httpError(401, 'The sign-in token is invalid or expired.')));
}

function rateLimit(bucket, limit, windowMs) {
  return (request, _response, next) => {
    const key = `${bucket}:${request.ip || request.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    const timestamps = (rateLimitBuckets.get(key) || []).filter(timestamp => timestamp > now - windowMs);
    if (timestamps.length >= limit) {
      next(httpError(429, 'Too many requests. Please wait before trying again.'));
      return;
    }
    timestamps.push(now);
    rateLimitBuckets.set(key, timestamps);
    if (rateLimitBuckets.size > 5000) {
      for (const [bucketKey, entries] of rateLimitBuckets) {
        if (!entries.some(timestamp => timestamp > now - windowMs)) rateLimitBuckets.delete(bucketKey);
      }
    }
    next();
  };
}

function firestoreRateLimit(bucket, limit, windowMs) {
  return (request, _response, next) => {
    let db;
    try {
      db = requireFirestore();
    } catch (error) {
      next(error);
      return;
    }
    const ipAddress = request.ip || request.socket.remoteAddress || 'unknown';
    const key = createHash('sha256').update(`${bucket}:${ipAddress}`).digest('hex');
    const reference = db.collection('apiRateLimits').doc(key);
    const now = Date.now();
    db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const storedTimestamps = snapshot.exists ? snapshot.get('timestamps') : [];
      const timestamps = (Array.isArray(storedTimestamps) ? storedTimestamps : [])
        .filter(timestamp => Number.isFinite(timestamp) && timestamp > now - windowMs);
      if (timestamps.length >= limit) return false;
      transaction.set(reference, {
        timestamps: [...timestamps, now],
        expiresAt: Timestamp.fromMillis(now + windowMs)
      });
      return true;
    }).then(allowed => {
      if (!allowed) {
        next(httpError(429, 'Too many requests. Please wait before trying again.'));
        return;
      }
      next();
    }).catch(next);
  };
}

function requireFirestore() {
  if (!adminReady) throw httpError(503, 'Firebase Admin is not configured on the server.');
  return getFirestore();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getPath(pathId) {
  const path = paths.find(item => item.id === pathId);
  if (!path) throw httpError(404, 'Learning path not found.');
  return path;
}

function progressDocumentId(uid, pathId, itemId = '') {
  return [uid, pathId, itemId].filter(Boolean).join('--');
}

async function isPathStepsComplete(db, uid, path) {
  const requiredVideos = path.items.filter(item => item.required && item.type === 'video');
  const requiredCourses = path.items.filter(item => item.required && item.type === 'course');
  const userRef = db.collection('users').doc(uid);
  const [user, ...videoSnapshots] = await Promise.all([
    userRef.get(),
    ...requiredVideos.map(item => userRef.collection('watchedVideos').doc(item.id).get()),
    ...requiredCourses.map(item => db.collection('pathCourseDeclarations')
      .doc(progressDocumentId(uid, path.id, item.id)).get())
  ]);
  const legacyWatched = new Set(user.exists && Array.isArray(user.get('watchedVideos')) ? user.get('watchedVideos') : []);
  const videoCount = requiredVideos.length;
  return videoSnapshots.slice(0, videoCount).every((snapshot, index) => (
    (snapshot.exists && snapshot.get('watched') === true) || legacyWatched.has(requiredVideos[index].id)
  )) && videoSnapshots.slice(videoCount).every(snapshot => snapshot.exists);
}

function buildQuizAttempt(path) {
  const privateQuestions = shuffle(path.quiz.questions).map(question => {
    const optionOrder = shuffle(question.options.map((text, originalIndex) => ({ text, originalIndex })));
    const orderedOptions = optionOrder.map(option => ({ id: randomUUID(), text: option.text }));
    return {
      id: question.id,
      prompt: question.prompt,
      options: orderedOptions,
      correctOptionId: orderedOptions[optionOrder.findIndex(option => option.originalIndex === question.correctIndex)].id,
      explanation: question.explanation,
      topicTags: question.topicTags
    };
  });
  return {
    privateQuestions,
    publicQuestions: privateQuestions.map(({ correctOptionId, explanation, ...question }) => question)
  };
}

async function isAdmin(uid) {
  return (await getFirestore().collection('admins').doc(uid).get()).exists;
}

function normalizeRecipientName(value) {
  if (typeof value !== 'string') throw httpError(400, 'Enter your certificate recipient name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw httpError(400, 'Certificate name must be 2-100 characters without control characters.');
  }
  return name;
}

async function getOrCreateCertificate(db, uid, path, recipientName, score) {
  const certCollection = db.collection('certificates');
  const activeQuery = certCollection.where('uid', '==', uid)
    .where('pathId', '==', path.id).where('status', '==', 'valid').limit(1);
  return db.runTransaction(async transaction => {
    const existing = await transaction.get(activeQuery);
    if (!existing.empty) {
      const record = existing.docs[0].data();
      if (!verifyCertificateSignature(record, certificateSecret)) throw httpError(409, 'The existing certificate failed its integrity check.');
      return record;
    }
    const certId = createCertificateId();
    const record = {
      certId,
      uid,
      recipientName,
      pathId: path.id,
      pathTitle: path.title,
      issuedAt: new Date().toISOString(),
      score,
      hours: path.estimatedHours,
      issuer: CERTIFICATE_ISSUER,
      status: 'valid',
      showScorePublicly: false,
      revocationReason: null,
      publicDisplayConsent: true
    };
    record.signature = createCertificateSignature(record, certificateSecret);
    transaction.create(certCollection.doc(certId), record);
    return record;
  });
}

async function updateOwnedCertificate(db, ref, ownerUid, update) {
  if (certificateSecret.length < 32) throw httpError(503, 'Certificate signing is not configured on the server.');
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw httpError(404, 'Certificate not found.');
    const current = snapshot.data();
    if (ownerUid && current.uid !== ownerUid) throw httpError(404, 'Certificate not found.');
    if (!verifyCertificateSignature(current, certificateSecret)) throw httpError(409, 'Certificate integrity check failed.');
    const updated = update(current);
    updated.signature = createCertificateSignature(updated, certificateSecret);
    transaction.set(ref, updated);
    return updated;
  });
}

function publicOwnerCertificate(record) {
  const { uid, signature, revocationReason, ...publicRecord } = record;
  return publicRecord;
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function hashGuestSession(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw httpError(400, 'A valid guest learning session is required.');
  }
  return createHash('sha256').update(value).digest('hex');
}

function isGuestPathComplete(path, watchedVideoIds, declaredCourseIds) {
  if (!Array.isArray(watchedVideoIds) || watchedVideoIds.length > 200
    || !watchedVideoIds.every(id => typeof id === 'string')
    || !Array.isArray(declaredCourseIds) || declaredCourseIds.length > 200
    || !declaredCourseIds.every(id => typeof id === 'string')) return false;
  const knownVideos = new Set(videos.map(item => item.id));
  if (watchedVideoIds.some(id => !knownVideos.has(id))) return false;
  return isPathComplete(path, watchedVideoIds, declaredCourseIds);
}

function requireCertificateSecret() {
  if (certificateSecret.length < 32) throw httpError(503, 'Certificate signing is not configured on the server.');
}
