import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from './firebase.js';
import { mergeUserData, saveUserProfile } from './users.js';

function requireAuth() {
  if (!isFirebaseConfigured() || !auth) {
    throw new Error('Firebase Authentication is not configured.');
  }
  return auth;
}

const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request'
]);
const AUTH_ERROR_MESSAGES = {
  'invalid-credential': 'That email or password is incorrect.',
  'user-not-found': 'That email or password is incorrect.',
  'wrong-password': 'That email or password is incorrect.',
  'email-already-in-use': 'An account already exists for this email. Sign in instead.',
  'weak-password': 'Choose a password with at least 8 characters.',
  'too-many-requests': 'Too many attempts. Wait a little while, then try again.',
  'network-request-failed': 'A network error interrupted sign-in. Check your connection and try again.',
  'popup-blocked': 'The Google sign-in pop-up was blocked. Continuing with full-page sign-in.',
  'popup-closed-by-user': 'The Google sign-in window closed before completing. Continuing with full-page sign-in.',
  'cancelled-popup-request': 'A Google sign-in request was cancelled. Continuing with full-page sign-in.',
  'operation-not-allowed': 'This sign-in method is disabled. Enable Google or Email/Password in Firebase Console under Authentication > Sign-in method.',
  'unauthorized-domain': 'This domain is not authorized. Add localhost or this domain in Firebase Console under Authentication > Settings > Authorized domains.',
  'invalid-email': 'Enter a valid email address.',
  'requires-recent-login': 'Please sign in again before trying that action.'
};

function getErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'auth/unknown';
}

export function getAuthErrorMessage(error) {
  const code = getErrorCode(error);
  const normalizedCode = code.replace(/^auth\//, '');
  return AUTH_ERROR_MESSAGES[normalizedCode]
    || `Authentication failed (${code}): ${error?.message || 'Please try again.'}`;
}

export function logAuthError(error) {
  console.error('[Auth] Firebase operation failed:', getErrorCode(error));
}

export function subscribeToAuth(callback) {
  return onAuthStateChanged(requireAuth(), callback);
}

export function getGoogleRedirectResult() {
  return getRedirectResult(requireAuth());
}

export function consumeGoogleRedirectReturnTo() {
  try {
    const returnTo = sessionStorage.getItem('skillbridge-auth-return-to');
    sessionStorage.removeItem('skillbridge-auth-return-to');
    return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : null;
  } catch (error) {
    console.warn('[Auth] Could not restore the post-redirect page.', error);
    return null;
  }
}

export async function signInWithGoogle(onPopupFallback) {
  const firebaseAuth = requireAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(firebaseAuth, provider);
  } catch (error) {
    if (!POPUP_FALLBACK_CODES.has(getErrorCode(error))) throw error;
    onPopupFallback?.(getAuthErrorMessage(error));
    try {
      sessionStorage.setItem('skillbridge-auth-return-to', `${location.pathname}${location.search}${location.hash}`);
    } catch (storageError) {
      console.warn('[Auth] Could not store the post-redirect page.', storageError);
    }
    await signInWithRedirect(firebaseAuth, provider);
    return { redirecting: true };
  }
}

export async function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export async function registerWithEmail(name, email, password) {
  const credential = await createUserWithEmailAndPassword(requireAuth(), email, password);
  try {
    await updateProfile(credential.user, { displayName: name });
    await saveUserProfile(credential.user.uid, {
      name,
      email: credential.user.email || email
    });
  } catch (error) {
    const profileError = new Error(
      `Your account was created, but its profile could not be saved: ${error.message || 'Please try again.'}`
    );
    profileError.code = error.code || 'auth/profile-save-failed';
    throw profileError;
  }
  return credential;
}

export async function sendPasswordReset(email) {
  try {
    await sendPasswordResetEmail(requireAuth(), email);
  } catch (error) {
    if (getErrorCode(error) !== 'auth/user-not-found') throw error;
  }
}

export async function signOutUser() {
  return signOut(requireAuth());
}

export async function mergeGuestData(uid, storage = localStorage) {
  const guestData = {
    profile: readStorageObject(storage, 'skillbridge_profile'),
    applications: readStorageArray(storage, 'skillbridge_applications'),
    bookmarks: readStorageArray(storage, 'skillbridge_bookmarks'),
    watchedVideos: readStorageArray(storage, 'skillbridge_watched_videos'),
    completedCourses: readStorageArray(storage, 'skillbridge_completed_courses'),
    selectedSkills: readStorageArray(storage, 'skillbridge_selected_skills')
  };
  const migrationKey = `skillbridge_migrated_${uid}`;
  if (storage.getItem(migrationKey)) return getMigratedData(uid);
  await mergeUserData(uid, guestData);
  storage.setItem(migrationKey, 'true');
  return guestData;
}

async function getMigratedData(uid) {
  const { getUserById } = await import('./users.js');
  return getUserById(uid);
}

function readStorageArray(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new TypeError(`Guest data for ${key} must be an array.`);
  return value;
}

function readStorageObject(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Guest data for ${key} must be an object.`);
  }
  return value;
}
