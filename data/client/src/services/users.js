import { db, firestoreApi, isFirebaseConfigured } from './firebase.js';

function requireFirestore() {
  if (!isFirebaseConfigured() || !db) {
    throw new Error('Firebase is not configured.');
  }
  return firestoreApi;
}

export async function getUserById(uid) {
  const api = requireFirestore();
  const snapshot = await api.getDoc(api.doc(db, 'users', uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveUserProfile(uid, profile) {
  const api = requireFirestore();
  if (!uid || !profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new TypeError('A user ID and profile object are required.');
  }
  await api.setDoc(api.doc(db, 'users', uid), {
    uid,
    profile,
    updatedAt: api.serverTimestamp()
  }, { merge: true });
}

export async function ensureUserProfile(uid, profile) {
  const api = requireFirestore();
  if (!uid || !profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new TypeError('A user ID and profile object are required.');
  }
  const reference = api.doc(db, 'users', uid);
  return api.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) return snapshot.data();
    const initialData = {
      uid,
      profile,
      updatedAt: api.serverTimestamp()
    };
    transaction.set(reference, initialData, { merge: true });
    return initialData;
  });
}

export async function mergeUserData(uid, guestData) {
  const api = requireFirestore();
  if (!uid || !guestData || typeof guestData !== 'object') {
    throw new TypeError('A user ID and guest data are required.');
  }
  const reference = api.doc(db, 'users', uid);
  const snapshot = await api.getDoc(reference);
  const existing = snapshot.exists() ? snapshot.data() : {};
  const merged = { ...existing };
  for (const key of ['bookmarks', 'applications', 'watchedVideos', 'completedCourses', 'selectedSkills']) {
    merged[key] = mergeUnique(existing[key], guestData[key]);
  }
  if (guestData.profile && Object.keys(guestData.profile).length) {
    const existingProfile = existing.profile && typeof existing.profile === 'object'
      && !Array.isArray(existing.profile) ? existing.profile : {};
    const guestProfile = Object.fromEntries(Object.entries(guestData.profile)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined));
    merged.profile = { ...existingProfile, ...guestProfile };
  }
  merged.uid = uid;
  merged.updatedAt = api.serverTimestamp();
  await api.setDoc(reference, merged, { merge: true });
  return merged;
}

export async function syncWatchedVideos(uid, legacyVideoIds = []) {
  const api = requireFirestore();
  if (!uid || !Array.isArray(legacyVideoIds) || !legacyVideoIds.every(id => typeof id === 'string')) {
    throw new TypeError('A user ID and watched video ID list are required.');
  }

  const watchedCollection = api.collection(db, 'users', uid, 'watchedVideos');
  const snapshot = await api.getDocs(watchedCollection);
  const watched = new Set(legacyVideoIds);
  snapshot.docs.forEach(item => {
    if (item.data().watched === true) watched.add(item.id);
  });
  const watchedVideoIds = [...watched];
  const batch = api.writeBatch(db);
  watchedVideoIds.forEach(videoId => {
    if (!snapshot.docs.some(item => item.id === videoId && item.data().watched === true)) {
      batch.set(api.doc(watchedCollection, videoId), {
        id: videoId,
        watched: true,
        updatedAt: api.serverTimestamp()
      });
    }
  });
  batch.set(api.doc(db, 'users', uid), {
    uid,
    watchedVideos: watchedVideoIds,
    updatedAt: api.serverTimestamp()
  }, { merge: true });
  await batch.commit();
  return watchedVideoIds;
}

export async function updateWatchedVideo(uid, videoId, watched, watchedVideoIds) {
  const api = requireFirestore();
  if (!uid || !videoId || typeof videoId !== 'string'
    || typeof watched !== 'boolean'
    || !Array.isArray(watchedVideoIds)
    || !watchedVideoIds.every(id => typeof id === 'string')) {
    throw new TypeError('A user ID, video ID, watched state, and watched video ID list are required.');
  }

  const batch = api.writeBatch(db);
  const watchedRef = api.doc(db, 'users', uid, 'watchedVideos', videoId);
  batch.set(api.doc(db, 'users', uid), {
    uid,
    watchedVideos: watchedVideoIds,
    updatedAt: api.serverTimestamp()
  }, { merge: true });
  if (watched) {
    batch.set(watchedRef, { id: videoId, watched: true, updatedAt: api.serverTimestamp() });
  } else {
    batch.delete(watchedRef);
  }
  await batch.commit();
}

function mergeUnique(existing = [], incoming = []) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) {
    throw new TypeError('User collection fields must be arrays.');
  }
  const combined = [...existing];
  const keys = new Set(combined.map(itemKey));
  for (const item of incoming) {
    const key = itemKey(item);
    if (!keys.has(key)) {
      keys.add(key);
      combined.push(item);
    }
  }
  return combined;
}

function itemKey(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    return item.id || item.internshipId || JSON.stringify(item);
  }
  throw new TypeError('User collection entries must be strings or objects.');
}
