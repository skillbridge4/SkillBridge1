import { auth, db, firestoreApi, isFirebaseConfigured } from './firebase.js';

const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const LOCAL_KEYS = {
  roadmap: 'skillbridge_ai_roadmap',
  resumeReport: 'skillbridge_ai_resume_report'
};

export async function getAiStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/ai/status`);
    if (!response.ok) return { enabled: false };
    const status = await response.json();
    return { enabled: status.enabled === true };
  } catch {
    return { enabled: false, offline: true };
  }
}

export async function requestAi(path, { body, file, signal } = {}) {
  const headers = {};
  if (isFirebaseConfigured() && auth?.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  let payload;
  if (file) {
    payload = new FormData();
    Object.entries(body || {}).forEach(([key, value]) => payload.append(key, String(value)));
    payload.append('resume', file, file.name);
  } else {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body || {});
  }
  const response = await fetch(`${API_BASE}/api/ai/${path}`, {
    method: 'POST',
    headers,
    body: payload,
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data.result) {
    const error = new Error(data.error || `Analysis request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return {
    ...data,
    source: data.source || (data.result ? 'rules' : 'ai'),
    status: response.status
  };
}

export async function loadAiDocument(user, slot) {
  const key = LOCAL_KEYS[slot];
  if (!key) throw new TypeError('Unknown AI data slot.');
  if (user && isFirebaseConfigured() && db && firestoreApi) {
    const snapshot = await firestoreApi.getDoc(firestoreApi.doc(db, 'users', user.uid, 'aiGuidance', slot));
    return snapshot.exists() ? snapshot.data() : null;
  }
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
}

export async function saveAiDocument(user, slot, value) {
  const key = LOCAL_KEYS[slot];
  if (!key) throw new TypeError('Unknown AI data slot.');
  if (user && isFirebaseConfigured() && db && firestoreApi) {
    await firestoreApi.setDoc(
      firestoreApi.doc(db, 'users', user.uid, 'aiGuidance', slot),
      { ...value, updatedAt: firestoreApi.serverTimestamp() }
    );
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export async function deleteAiDocuments(user) {
  if (user && isFirebaseConfigured() && db && firestoreApi) {
    await Promise.all(Object.values(LOCAL_KEYS).map(slot =>
      firestoreApi.deleteDoc(firestoreApi.doc(db, 'users', user.uid, 'aiGuidance', slot))));
    return;
  }
  Object.values(LOCAL_KEYS).forEach(key => localStorage.removeItem(key));
}

export function escapeAiHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}
