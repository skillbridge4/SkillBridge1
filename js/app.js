/**
 * SkillBridge - Main Application Logic (app.js)
 * Architecture:
 * 1. Imports & Fallbacks
 * 2. Storage Helpers (safe try/catch wrapper)
 * 3. Security (HTML sanitization)
 * 4. State Management
 * 5. Toast Notifications
 * 6. Theme Controller
 * 7. Modals & Accessibility
 * 8. Renderers (Home, Internships, Courses, Skill-Gap, Tracker, Profile)
 * 9. Event Listeners & Router
 * 10. Initialization & PWA Service Worker
 */

import { INTERNSHIPS, COURSES, ALL_SKILLS, DEFAULT_PROFILE } from './data.js';
import {
  VIDEO_TOPICS,
  VIDEO_LEARNING_PATH,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  filterVideos,
  getLearningPathProgress,
  getVideosForInternship
} from './video-utils.js';
import companiesSeed from '../data/seed/companies.json';
import {
  CITIES_BY_STATE,
  COMPANY_TYPES,
  COURSE_CATEGORIES,
  COURSE_LEVELS,
  COURSE_PRICING,
  DURATIONS,
  ELIGIBILITY,
  FIELDS,
  INTERNSHIP_SORTS,
  INDIAN_STATES,
  MODES,
  PAID_STATUS,
  STIPEND_RANGES,
  VIDEO_CATEGORIES,
  VIDEO_DURATION_FILTERS,
  LEARNING_PATH_IDS,
  DEFAULT_PATH_PASS_MARK
} from '../client/src/constants.js';
import { getMissingFirebaseConfig, isFirebaseConfigured } from '../client/src/services/firebase.js';
import {
  companiesService,
  coursesService,
  internshipsService,
  videosService
} from '../client/src/services/catalog.js';
import { filterCompanies, filterInternships, sortInternships } from '../client/src/services/search.js';
import {
  deleteCompany,
  deleteInternship,
  hasAdminAccess,
  saveCompany,
  saveInternship
} from '../client/src/services/admin.js';
import {
  ensureUserProfile,
  saveUserProfile,
  syncWatchedVideos,
  updateWatchedVideo
} from '../client/src/services/users.js';
import {
  certificateRequest,
  certificatePreviewDataUrl,
  certificateVerificationUrl,
  downloadCertificateImage,
  downloadCertificatePdf,
  getGuestLearningSessionId,
  shareCertificateOnLinkedIn
} from '../client/src/services/certificates.js';
import {
  mergeGuestData,
  consumeGoogleRedirectReturnTo,
  getAuthErrorMessage,
  getGoogleRedirectResult,
  logAuthError,
  registerWithEmail,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth
} from '../client/src/services/auth.js';
import { initAiGuidance, renderAiGuidance, setGuidanceSkills } from './ai-guidance.js';
import { initResumeAnalyser, renderResumeAnalyser } from './resume-analyser.js';

let internshipPrepVideos = [];
let allVideos = [];

// Safe fallbacks if running in environment where window holds data
let rawInternships = INTERNSHIPS.map(adaptInternship);
let rawCourses = COURSES;
let rawCompanies = companiesSeed;
const rawSkills = (typeof ALL_SKILLS !== 'undefined' ? ALL_SKILLS : window.ALL_SKILLS) || [];
const rawCategories = ['All Fields', ...FIELDS];
const rawDefaultProfile = (typeof DEFAULT_PROFILE !== 'undefined' ? DEFAULT_PROFILE : window.DEFAULT_PROFILE) || {};

/* ==========================================================================
   2. STORAGE HELPERS
   ========================================================================== */
const STORAGE_KEYS = {
  THEME: 'skillbridge_theme',
  APPLICATIONS: 'skillbridge_applications',
  PROFILE: 'skillbridge_profile',
  COMPLETED_COURSES: 'skillbridge_completed_courses',
  SELECTED_SKILLS: 'skillbridge_selected_skills',
  SAVED_VIDEOS: 'skillbridge_saved_videos',
  WATCHED_VIDEOS: 'skillbridge_watched_videos',
  GUEST_MODE: 'skillbridge_guest_mode',
  SHOW_DEMO_DATA: 'skillbridge_show_demo_data',
  PATH_COURSE_DECLARATIONS: 'skillbridge_path_course_declarations',
  PATH_QUIZ_RESULTS: 'skillbridge_path_quiz_results'
};

function safeStorageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    const matchesFallbackShape = Array.isArray(fallback)
      ? Array.isArray(value)
      : fallback !== null && typeof fallback === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : typeof value === typeof fallback;

    if (!matchesFallbackShape) {
      console.warn(`[Storage] Unexpected format for ${key}, using fallback.`);
      return fallback;
    }

    if (key === STORAGE_KEYS.PROFILE) {
      const profile = {
        ...fallback,
        ...value,
        skills: Array.isArray(value.skills) && value.skills.every(skill => typeof skill === 'string')
          ? value.skills
          : fallback.skills
      };
      Object.entries(fallback).forEach(([field, defaultValue]) => {
        if (field !== 'skills' && typeof profile[field] !== typeof defaultValue) {
          profile[field] = defaultValue;
        }
      });
      return profile;
    }

    if (key === STORAGE_KEYS.APPLICATIONS
      && !value.every(app => app && typeof app === 'object'
        && typeof app.id === 'string'
        && typeof app.internshipId === 'string'
        && ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'].includes(app.status)
        && typeof app.notes === 'string')) {
      console.warn(`[Storage] Unexpected entries for ${key}, using fallback.`);
      return fallback;
    }

    if ([STORAGE_KEYS.SAVED_VIDEOS, STORAGE_KEYS.WATCHED_VIDEOS].includes(key)
      && !value.every(item => typeof item === 'string')) {
      console.warn(`[Storage] Unexpected entries for ${key}, using fallback.`);
      return fallback;
    }

    if (Array.isArray(fallback) && fallback.length && typeof fallback[0] === 'string'
      && !value.every(item => typeof item === 'string')) {
      console.warn(`[Storage] Unexpected entries for ${key}, using fallback.`);
      return fallback;
    }

    return value;
  } catch (err) {
    console.warn(`[Storage] Failed to read ${key}, using fallback:`, err);
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[Storage] Failed to write ${key}:`, err);
    showToast('Storage limit reached or private browsing prevented saving', 'warning');
    return false;
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`[Storage] Failed to remove ${key}:`, error);
  }
}

/* ==========================================================================
   3. SECURITY & STRING SANITIZATION (XSS Prevention)
   ========================================================================== */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeExternalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function highlightText(value, query) {
  const text = String(value || '');
  const token = String(query || '').trim();
  if (!token) return escapeHtml(text);
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(escapedToken, 'ig');
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    html += escapeHtml(text.slice(cursor, match.index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function debounce(fn, delay = 250) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function adaptInternship(record) {
  const stipend = record.stipendMin == null && record.stipendMax == null
    ? 'Check official site'
    : `₹${record.stipendMin ?? record.stipendMax}–${record.stipendMax ?? record.stipendMin}`;
  const location = [record.city, record.state].filter(Boolean).join(', ') || 'Check official site';
  return {
    ...record,
    company: record.companyName,
    location,
    mode: record.mode || 'Check official site',
    duration: record.durationMonths == null ? 'Check official site' : `${record.durationMonths} Months`,
    stipend,
    stipendAmount: record.stipendMax ?? record.stipendMin ?? null,
    applyLink: record.applyUrl || null,
    description: record.description || 'Check official site for current program information.'
  };
}

function hasVerificationEvidence(record) {
  return record?.verified === true
    && Boolean(record.sourceUrl || record.source)
    && Boolean(record.lastVerified);
}

async function fetchAll(service) {
  const records = [];
  let cursor = null;
  do {
    const page = await service.list({ pageSize: 100, cursor });
    records.push(...page.items);
    cursor = page.cursor;
  } while (cursor && records.length < 5000);
  return records;
}

function showCatalogError() {
  if (!import.meta.env.DEV) return;
  const banner = document.getElementById('catalog-error-banner');
  if (!banner) return;
  banner.hidden = false;
  banner.querySelector('[data-error-dismiss]')?.addEventListener('click', () => {
    banner.hidden = true;
  }, { once: true });
  if (banner.dataset.retryBound !== 'true') {
    banner.dataset.retryBound = 'true';
    banner.querySelector('[data-error-retry]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await loadCatalogs();
        renderHome();
        renderInternships();
        renderCompanies();
        renderVideos();
      } finally {
        button.disabled = false;
      }
    });
  }
}

async function loadCatalogs() {
  if (!isFirebaseConfigured()) return;

  const requests = [
    ['companies', companiesService, records => { rawCompanies = records; }],
    ['internships', internshipsService, records => { rawInternships = records.map(adaptInternship); }],
    ['courses', coursesService, records => { rawCourses = records; }],
    ['videos', videosService, records => { allVideos = records; internshipPrepVideos = records; }]
  ];
  const failures = [];
  await Promise.all(requests.map(async ([name, service, apply]) => {
    try {
      const records = await fetchAll(service);
      if (!records.length) {
        console.info(`[Catalog] Firestore ${name} is empty; using bundled seed data.`);
        return;
      }
      apply(records);
    } catch (error) {
      console.error(`[Catalog] Failed to load ${name} from Firestore; keeping bundled seed data.`, error);
      failures.push(name);
    }
  }));
  if (failures.length) showCatalogError();
  else {
    const banner = document.getElementById('catalog-error-banner');
    if (banner) banner.hidden = true;
  }
}

async function loadLearningPaths() {
  const response = await fetch('/learning-paths.json');
  if (!response.ok) {
    console.error('[Learning] Could not load the learning path catalog.', response.status);
    showToast('Learning paths could not be loaded. Please reload while online.', 'danger');
    return;
  }
  const records = await response.json();
  if (!Array.isArray(records) || records.some(path => !path || typeof path.id !== 'string')) {
    throw new TypeError('The public learning path catalog has an invalid format.');
  }
  const ids = records.map(path => path.id);
  if (LEARNING_PATH_IDS.some(id => !ids.includes(id)) || ids.length !== LEARNING_PATH_IDS.length) {
    throw new Error('Learning path IDs do not match the shared constants.');
  }
  state.learningPaths = records;
}

function clearGuestMode() {
  state.guestMode = false;
  safeStorageRemove(STORAGE_KEYS.GUEST_MODE);
}

function updateAuthPresentation() {
  const action = document.getElementById('auth-action-btn');
  if (action) {
    action.disabled = state.authStatus === 'loading';
    action.textContent = state.authStatus === 'loading'
      ? 'Checking session…'
      : state.user ? 'Sign out' : 'Sign in';
    action.setAttribute('aria-busy', String(state.authStatus === 'loading'));
  }
  const profileButton = document.querySelector('.header-profile-btn');
  if (profileButton) {
    profileButton.setAttribute(
      'aria-label',
      state.authStatus === 'loading'
        ? 'Loading your account'
        : state.user ? 'View your account profile' : 'View guest profile'
    );
    profileButton.dataset.authState = state.authStatus;
  }
  document.body.dataset.authState = state.authStatus;
}

async function syncAuthenticatedUser(user) {
  try {
    await ensureUserProfile(user.uid, {
      name: user.displayName || state.profile.name || 'SkillBridge student',
      email: user.email || state.profile.email || '',
      ...(user.photoURL ? { photoURL: user.photoURL } : {})
    });
  } catch (error) {
    console.error('[Auth] Could not initialize the user profile.', error);
    showToast('Your account profile could not be initialized. Some synced features may be unavailable.', 'warning');
    return;
  }
  try {
    state.isAdmin = await hasAdminAccess(user.uid);
  } catch (error) {
    state.isAdmin = false;
    console.error('[Auth] Could not verify admin access.', error);
    showCatalogError();
  }
  const adminLink = document.getElementById('admin-nav-link');
  if (adminLink) adminLink.hidden = !state.isAdmin;
  const mobileAdminLink = document.getElementById('mobile-admin-nav-link');
  if (mobileAdminLink) mobileAdminLink.hidden = !state.isAdmin;
  if (window.location.hash === '#admin') {
    if (state.isAdmin) {
      navigateTo('admin');
    } else {
      navigateTo('home');
      showLoginModal({ initialError: 'Your signed-in account does not have administrator access.' });
    }
  }
  if (state.currentRoute === 'ai-guidance') renderAiGuidance(state.profile, user);
  if (state.currentRoute === 'resume-analyser') renderResumeAnalyser(user);

  try {
    const migratedData = await mergeGuestData(user.uid);
    if (migratedData?.profile && typeof migratedData.profile === 'object') {
      state.profile = { ...state.profile, ...migratedData.profile };
    }
    if (user.displayName && !state.profile.name) state.profile.name = user.displayName;
    if (user.email && !state.profile.email) state.profile.email = user.email;
    safeStorageSet(STORAGE_KEYS.PROFILE, state.profile);
    renderProfile();
    state.watchedVideos = await syncWatchedVideos(user.uid, migratedData.watchedVideos || []);
    safeStorageSet(STORAGE_KEYS.WATCHED_VIDEOS, state.watchedVideos);
    renderVideos();
    try {
      await syncGuestCourseDeclarations();
      await certificateRequest('/paths/migrate-guest-progress', {
        method: 'POST',
        body: { guestSessionId: getGuestLearningSessionId() }
      });
      state.pathCourseDeclarations = [];
      state.pathQuizResults = {};
      safeStorageSet(STORAGE_KEYS.PATH_COURSE_DECLARATIONS, []);
      safeStorageSet(STORAGE_KEYS.PATH_QUIZ_RESULTS, {});
      await loadServerLearningProgress();
      renderPathCards('course-learning-paths');
      renderPathCards('video-learning-paths');
      renderPathCards('my-learning-paths');
      await loadCertificates();
    } catch (error) {
      console.error('[Learning] Signed-in learning progress could not be synced.', error);
      showToast('Some learning progress could not be synced. It remains saved in this browser.', 'warning');
    }
  } catch (error) {
    console.error('[Auth] Guest data migration failed.', error);
    showToast('Your saved guest data could not be synced. It remains in this browser.', 'warning');
  }
}

async function initializeAuth() {
  state.authStatus = 'loading';
  updateAuthPresentation();
  if (!isFirebaseConfigured()) {
    state.authStatus = 'guest';
    state.guestMode = Boolean(safeStorageGet(STORAGE_KEYS.GUEST_MODE, false));
    updateAuthPresentation();
    renderProfile();
    return;
  }

  let redirectError = null;
  try {
    const redirectResult = await getGoogleRedirectResult();
    const returnTo = consumeGoogleRedirectReturnTo();
    if (redirectResult?.user && returnTo) {
      const currentLocation = `${location.pathname}${location.search}${location.hash}`;
      if (returnTo !== currentLocation) {
        const target = new URL(returnTo, location.origin);
        if (target.origin === location.origin) {
          location.replace(target.href);
          return;
        }
      }
    }
  } catch (error) {
    logAuthError(error);
    redirectError = error;
    consumeGoogleRedirectReturnTo();
  }

  let resolveInitialState;
  let initialStateReceived = false;
  const initialState = new Promise(resolve => {
    resolveInitialState = resolve;
  });
  try {
    await subscribeToAuth(user => {
      state.user = user;
      state.authStatus = user ? 'authenticated' : 'guest';
      if (user) clearGuestMode();
      else state.guestMode = Boolean(safeStorageGet(STORAGE_KEYS.GUEST_MODE, false));
      updateAuthPresentation();
      if (state.currentRoute === 'ai-guidance') renderAiGuidance(state.profile, user);
      if (state.currentRoute === 'resume-analyser') renderResumeAnalyser(user);
      if (user) {
        void syncAuthenticatedUser(user);
      } else {
        state.isAdmin = false;
        state.certificates = [];
        state.pathQuizResults = safeStorageGet(STORAGE_KEYS.PATH_QUIZ_RESULTS, {});
        document.getElementById('admin-nav-link')?.setAttribute('hidden', '');
        document.getElementById('mobile-admin-nav-link')?.setAttribute('hidden', '');
        renderProfile();
        renderTracker();
        renderCertificateList('learning-certificates-list');
        renderCertificateList('profile-certificates-list');
        refreshLearningViews();
        if (window.location.hash === '#admin') {
          navigateTo('home');
          showLoginModal({ initialError: 'Sign in to use the admin area.' });
        }
      }
      if (!initialStateReceived) {
        initialStateReceived = true;
        resolveInitialState();
      }
    });
    await initialState;
    if (redirectError) showLoginModal({ initialError: getAuthErrorMessage(redirectError) });
  } catch (error) {
    state.authStatus = 'error';
    updateAuthPresentation();
    logAuthError(error);
    showToast(getAuthErrorMessage(error), 'danger');
  }
}

function setAuthFeedback(message, kind = 'error') {
  const feedback = document.getElementById('auth-error');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.kind = kind;
}

function setAuthRequestInProgress(loading, activeButtonId = '') {
  state.authRequestInProgress = loading;
  const dialog = document.getElementById('global-modal-dialog');
  if (!dialog) return;
  const configured = isFirebaseConfigured();
  dialog.querySelectorAll('#auth-google, #auth-submit, #auth-forgot-password').forEach(button => {
    const active = loading && button.id === activeButtonId;
    button.disabled = loading || !configured || state.authStatus === 'loading';
    button.setAttribute('aria-busy', String(active));
    const spinner = button.querySelector('[data-auth-spinner]');
    if (spinner) spinner.hidden = !active;
    const label = button.querySelector('[data-auth-label]');
    if (label) {
      label.textContent = active
        ? button.id === 'auth-google'
          ? 'Connecting…'
          : button.id === 'auth-forgot-password' ? 'Sending…' : 'Please wait…'
        : button.id === 'auth-google'
          ? 'Continue with Google'
          : button.id === 'auth-forgot-password'
            ? 'Forgot password?'
            : dialog.querySelector('#auth-email-form')?.dataset.mode === 'register'
              ? 'Create account'
              : 'Sign in';
    }
  });
  dialog.querySelectorAll('#auth-forgot-password, #auth-mode-toggle, .auth-password-toggle')
    .forEach(button => { button.disabled = loading; });
}

function setAuthFieldError(form, fieldId, message = '') {
  const input = form.querySelector(`#${fieldId}`);
  const feedback = form.querySelector(`[data-field-error="${fieldId}"]`);
  if (input) input.setAttribute('aria-invalid', String(Boolean(message)));
  if (feedback) feedback.textContent = message;
}

function validateAuthForm(form) {
  const mode = form.dataset.mode;
  const name = form.querySelector('#auth-name')?.value.trim() || '';
  const email = form.querySelector('#auth-email')?.value.trim() || '';
  const password = form.querySelector('#auth-password')?.value || '';
  const confirmation = form.querySelector('#auth-password-confirm')?.value || '';
  const errors = [];
  form.querySelectorAll('[data-field-error]').forEach(feedback => {
    setAuthFieldError(form, feedback.dataset.fieldError);
  });
  if (mode === 'register' && !name) {
    setAuthFieldError(form, 'auth-name', 'Enter your name.');
    errors.push('#auth-name');
  }
  if (!email) {
    setAuthFieldError(form, 'auth-email', 'Enter your email address.');
    errors.push('#auth-email');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    setAuthFieldError(form, 'auth-email', 'Enter a valid email address.');
    errors.push('#auth-email');
  }
  if (!password) {
    setAuthFieldError(form, 'auth-password', 'Enter your password.');
    errors.push('#auth-password');
  } else if (password.length < 8) {
    setAuthFieldError(form, 'auth-password', 'Use at least 8 characters.');
    errors.push('#auth-password');
  }
  if (mode === 'register' && confirmation !== password) {
    setAuthFieldError(form, 'auth-password-confirm', 'Passwords do not match.');
    errors.push('#auth-password-confirm');
  }
  if (errors.length) form.querySelector(errors[0])?.focus();
  return errors.length === 0;
}

function showLoginModal({ initialError = '', triggerElement = null } = {}) {
  const configured = isFirebaseConfigured();
  const message = configured
    ? 'Sign in to sync your profile and saved activity.'
    : 'Email and Google sign-in are unavailable right now. You can continue browsing as a guest.';
  const authControlsDisabled = !configured
    || state.authStatus === 'loading'
    || state.authRequestInProgress;
  openModal(`
    <div class="auth-layout">
      <aside class="auth-brand-panel" aria-label="SkillBridge benefits">
        <div class="brand-logo auth-brand-logo" role="img" aria-label="SkillBridge">
          <span class="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3 2 8l10 5 8-4v6h2V8L12 3Zm-6 8.2V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.8l-6 3-6-3Z"/></svg>
          </span>
          <span class="brand-text">SkillBridge</span>
        </div>
        <div class="auth-brand-copy">
          <p class="auth-brand-kicker">Your next step starts here</p>
          <h3>Make your ambition actionable.</h3>
          <p>Find opportunities, grow your skills, and keep your progress moving.</p>
        </div>
        <ul class="auth-benefits">
          <li>
            <span class="auth-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 3a7 7 0 1 0 4.9 12l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-1 1v3H7v2h4V6H9Z"/></svg></span>
            <span>Find internships that fit</span>
          </li>
          <li>
            <span class="auth-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 1 8.5 12 14l9-4.5V17h2V8.5L12 3Zm-7.5 9.8V17c0 2.2 3.4 4 7.5 4s7.5-1.8 7.5-4v-4.2L12 16l-7.5-3.2Z"/></svg></span>
            <span>Build career-ready skills</span>
          </li>
          <li>
            <span class="auth-benefit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14ZM7 13h2v4H7v-4Zm4-6h2v10h-2V7Zm4 3h2v7h-2v-7Z"/></svg></span>
            <span>Track every application</span>
          </li>
        </ul>
      </aside>
      <section class="auth-form-panel" aria-label="Sign in to SkillBridge">
        <div class="modal-header auth-header">
          <div class="auth-heading-group">
            <h2 id="modal-title">Welcome back</h2>
            <p id="auth-subtitle" class="text-muted">Sign in to track internships and build your skills.</p>
            <p class="text-muted auth-config-note" role="status">${escapeHtml(message)}</p>
          </div>
          <button class="btn btn-ghost btn-sm auth-close" data-close-modal aria-label="Close modal">&times;</button>
        </div>
        <div class="modal-body auth-body">
          <button id="auth-google" class="btn btn-outline auth-google" type="button" data-auth-action aria-busy="false" ${authControlsDisabled ? 'disabled' : ''}>
            <svg class="auth-google-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.8 6.1C12.2 13.7 17.6 9.5 24 9.5Z"/><path fill="#4285F4" d="M47.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h13.2c-.6 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4.1 7.4-10.1 7.4-17.2Z"/><path fill="#FBBC05" d="M10.3 28.6A14.4 14.4 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.6 2.5 10.7l7.8-6.1Z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-6.3L32 35.9c-2.1 1.4-4.8 2.2-8 2.2-6.4 0-11.8-4.2-13.7-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48Z"/></svg>
            <span data-auth-label>Continue with Google</span><span class="auth-spinner" data-auth-spinner aria-hidden="true" hidden></span>
          </button>
          <div class="auth-divider" aria-hidden="true"><span>or continue with email</span></div>
          <form id="auth-email-form" class="form-stack auth-form" data-mode="signin" novalidate>
            <div class="form-group auth-field" data-auth-register-field hidden>
              <label class="form-label" for="auth-name">Full name</label>
              <input id="auth-name" name="name" class="form-input" type="text" autocomplete="name" maxlength="120">
              <span class="auth-field-error" data-field-error="auth-name"></span>
            </div>
            <div class="form-group auth-field">
              <label class="form-label" for="auth-email">Email</label>
              <input id="auth-email" name="email" class="form-input" type="email" autocomplete="email" required aria-describedby="auth-email-error">
              <span id="auth-email-error" class="auth-field-error" data-field-error="auth-email"></span>
            </div>
            <div class="form-group auth-field">
              <label class="form-label" for="auth-password">Password</label>
              <div class="auth-password-control">
                <input id="auth-password" name="password" class="form-input" type="password" autocomplete="current-password" minlength="8" required aria-describedby="auth-password-hint auth-password-error">
                <button class="auth-password-toggle" type="button" data-toggle-password="auth-password" aria-label="Show password" aria-pressed="false">Show</button>
              </div>
              <span id="auth-password-hint" class="auth-field-hint">Use at least 8 characters.</span>
              <span id="auth-password-error" class="auth-field-error" data-field-error="auth-password"></span>
            </div>
            <div class="form-group auth-field" data-auth-register-field hidden>
              <label class="form-label" for="auth-password-confirm">Confirm password</label>
              <div class="auth-password-control">
                <input id="auth-password-confirm" name="passwordConfirm" class="form-input" type="password" autocomplete="new-password" minlength="8" aria-describedby="auth-password-confirm-error">
                <button class="auth-password-toggle" type="button" data-toggle-password="auth-password-confirm" aria-label="Show confirm password" aria-pressed="false">Show</button>
              </div>
              <span id="auth-password-confirm-error" class="auth-field-error" data-field-error="auth-password-confirm"></span>
            </div>
            <div class="auth-utility-row">
              <button id="auth-forgot-password" class="btn btn-ghost btn-sm" type="button" aria-busy="false" ${authControlsDisabled ? 'disabled' : ''}>
                <span data-auth-label>Forgot password?</span><span class="auth-spinner" data-auth-spinner aria-hidden="true" hidden></span>
              </button>
              <button id="auth-mode-toggle" class="btn btn-ghost btn-sm" type="button" aria-controls="auth-email-form">Create account</button>
            </div>
            <div class="card-actions">
              <button id="auth-submit" class="btn btn-primary" type="submit" data-auth-action aria-busy="false" ${authControlsDisabled ? 'disabled' : ''}>
                <span data-auth-label>Sign in</span><span class="auth-spinner" data-auth-spinner aria-hidden="true" hidden></span>
              </button>
            </div>
          </form>
          <p id="auth-error" class="text-muted" role="alert" aria-live="assertive" tabindex="-1"></p>
        </div>
        <div class="modal-footer auth-footer">
          <button id="auth-guest" class="btn btn-ghost" type="button">Continue as guest</button>
        </div>
      </section>
    </div>
  `, triggerElement);
  setAuthFeedback(initialError, initialError ? 'error' : 'info');
  document.getElementById('auth-guest')?.addEventListener('click', () => {
    state.authStatus = 'guest';
    state.guestMode = true;
    safeStorageSet(STORAGE_KEYS.GUEST_MODE, true);
    updateAuthPresentation();
    closeModal();
  });
  const form = document.getElementById('auth-email-form');
  const setMode = mode => {
    form.dataset.mode = mode;
    form.querySelectorAll('[data-auth-register-field]').forEach(field => {
      field.hidden = mode !== 'register';
      field.querySelectorAll('input').forEach(input => {
        input.required = mode === 'register';
        input.setAttribute('aria-required', String(mode === 'register'));
      });
    });
    const isRegister = mode === 'register';
    const password = form.querySelector('#auth-password');
    password.autocomplete = isRegister ? 'new-password' : 'current-password';
    form.querySelector('#auth-password-confirm').required = isRegister;
    const modalTitle = document.getElementById('active-modal-title');
    if (modalTitle) modalTitle.textContent = isRegister ? 'Create your account' : 'Welcome back';
    document.getElementById('auth-subtitle').textContent = isRegister
      ? 'Create an account to sync your profile and progress.'
      : 'Sign in to track internships and build your skills.';
    document.getElementById('auth-forgot-password').hidden = isRegister;
    document.getElementById('auth-mode-toggle').textContent = isRegister ? 'Back to sign in' : 'Create account';
    const submit = document.getElementById('auth-submit');
    submit.classList.toggle('btn-primary', !isRegister);
    submit.classList.toggle('btn-secondary', isRegister);
    setAuthFeedback('', 'info');
    form.querySelectorAll('[data-field-error]').forEach(feedback => {
      setAuthFieldError(form, feedback.dataset.fieldError);
    });
  };
  document.getElementById('auth-mode-toggle')?.addEventListener('click', () => {
    setMode(form.dataset.mode === 'signin' ? 'register' : 'signin');
  });
  document.querySelectorAll('.auth-password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${input.id === 'auth-password' ? 'password' : 'confirm password'}`);
      button.setAttribute('aria-pressed', String(show));
    });
  });
  form?.addEventListener('input', event => {
    if (event.target.id) setAuthFieldError(form, event.target.id);
    if (event.target.id === 'auth-password') setAuthFieldError(form, 'auth-password-confirm');
    setAuthFeedback('', 'info');
  });
  document.getElementById('auth-google')?.addEventListener('click', async () => {
    setAuthRequestInProgress(true, 'auth-google');
    try {
      const result = await signInWithGoogle(message => setAuthFeedback(message, 'info'));
      if (result?.redirecting) return;
      closeModal();
    } catch (error) {
      logAuthError(error);
      setAuthFeedback(getAuthErrorMessage(error));
    } finally {
      setAuthRequestInProgress(false);
    }
  });
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.authRequestInProgress || !validateAuthForm(form)) return;
    const name = form.querySelector('#auth-name').value.trim();
    const email = form.querySelector('#auth-email').value.trim();
    const password = form.querySelector('#auth-password').value;
    setAuthRequestInProgress(true, 'auth-forgot-password');
    try {
      if (form.dataset.mode === 'register') {
        await registerWithEmail(name, email, password);
      } else {
        await signInWithEmail(email, password);
      }
      closeModal();
    } catch (error) {
      logAuthError(error);
      setAuthFeedback(getAuthErrorMessage(error));
    } finally {
      setAuthRequestInProgress(false);
    }
  });
  document.getElementById('auth-forgot-password')?.addEventListener('click', async () => {
    const email = form.querySelector('#auth-email').value.trim();
    if (!email) {
      setAuthFieldError(form, 'auth-email', 'Enter the email address for your account.');
      form.querySelector('#auth-email').focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setAuthFieldError(form, 'auth-email', 'Enter a valid email address.');
      form.querySelector('#auth-email').focus();
      return;
    }
    setAuthRequestInProgress(true, 'auth-submit');
    try {
      await sendPasswordReset(email);
      setAuthFeedback('If an account exists for that email, a password reset email has been sent.', 'success');
    } catch (error) {
      logAuthError(error);
      setAuthFeedback(getAuthErrorMessage(error));
    } finally {
      setAuthRequestInProgress(false);
    }
  });
  if (initialError) document.getElementById('auth-error')?.focus();
  else document.getElementById('auth-email')?.focus();
}

/* ==========================================================================
   4. STATE MANAGEMENT
   ========================================================================== */
const state = {
  currentRoute: 'home',
  user: null,
  authStatus: 'loading',
  guestMode: Boolean(safeStorageGet(STORAGE_KEYS.GUEST_MODE, false)),
  showDemoData: Boolean(safeStorageGet(STORAGE_KEYS.SHOW_DEMO_DATA, false)),
  authRequestInProgress: false,
  isAdmin: false,
  theme: safeStorageGet(STORAGE_KEYS.THEME, 'system'),
  // Applications format: array of { id, internshipId, status, appliedDate, interviewDate, notes, updatedAt }
  applications: safeStorageGet(STORAGE_KEYS.APPLICATIONS, []),
  profile: safeStorageGet(STORAGE_KEYS.PROFILE, rawDefaultProfile),
  completedCourses: safeStorageGet(STORAGE_KEYS.COMPLETED_COURSES, []),
  selectedSkills: safeStorageGet(STORAGE_KEYS.SELECTED_SKILLS, ['JavaScript', 'React', 'HTML5', 'CSS3', 'Git', 'Figma']),
  
  // Filters & Sorting for Internships
  internshipFilters: {
    search: new URLSearchParams(window.location.search).get('q') || '',
    field: 'All Fields',
    location: 'all',
    state: 'all',
    mode: 'all',
    duration: 'all',
    compensation: 'all',
    stipendRange: 'all',
    companyType: 'all',
    eligibility: 'all',
    verifiedOnly: false,
    deadlineSoon: false,
    sort: 'newest'
  },
  companyFilters: {
    sector: 'all',
    type: 'all',
    state: 'all',
    city: 'all',
    hasInternships: false
  },

  // Filters for Courses
  courseFilters: {
    search: '',
    category: 'all',
    level: 'all',
    price: 'all'
  },

  // Tracker Active Tab Filter
  trackerTab: 'All',
  videoCategory: 'Internship Prep',
  videoTopic: 'all',
  videoSearch: '',
  videoLanguage: 'all',
  videoLevel: 'all',
  videoDuration: 'all',
  savedVideos: safeStorageGet(STORAGE_KEYS.SAVED_VIDEOS, []),
  watchedVideos: safeStorageGet(STORAGE_KEYS.WATCHED_VIDEOS, []),
  learningPaths: [],
  pathCourseDeclarations: safeStorageGet(STORAGE_KEYS.PATH_COURSE_DECLARATIONS, []),
  pathQuizResults: safeStorageGet(STORAGE_KEYS.PATH_QUIZ_RESULTS, {}),
  certificates: [],
  verifyCertId: ''
};

function initializeAiPages() {
  const callbacks = {
    getUser: () => state.user,
    onRequireAuth: feature => showLoginModal({ initialError: `Sign in to use ${feature}.` }),
    onAddSkills: async skills => {
      if (!Array.isArray(state.profile.skills)) state.profile.skills = [];
      skills.forEach(skill => {
        if (typeof skill === 'string' && !state.profile.skills.some(item => item.toLowerCase() === skill.toLowerCase())) {
          state.profile.skills.push(skill);
        }
      });
      safeStorageSet(STORAGE_KEYS.PROFILE, state.profile);
      renderProfileSkills();
      if (state.user) await saveUserProfile(state.user.uid, state.profile);
    },
    onFeedSkills: skills => {
      navigateTo('ai-guidance');
      setGuidanceSkills(skills);
    },
    onTakeMissing: (missingSkills, currentSkills) => {
      navigateTo('skill-gap');
      const notice = document.getElementById('ai-skill-gap-note');
      if (!notice) return;
      const skills = (Array.isArray(missingSkills) ? missingSkills : [])
        .map(item => typeof item === 'string' ? item : item?.skill)
        .filter(skill => typeof skill === 'string');
      notice.innerHTML = `<section class="ai-subcard"><strong>Skills to explore from AI Guidance</strong><p>These are gaps, not skills you have already. Add one to the matcher only if you already have that skill.</p><div class="ai-actions">${skills.map(skill => `<button type="button" class="btn btn-outline btn-sm" data-ai-skill-add="${escapeHtml(skill)}">${currentSkills.includes(skill) ? 'Already selected: ' : 'I have: '}${escapeHtml(skill)}</button>`).join('')}</div></section>`;
    },
    onOpenCourse: id => {
      navigateTo('courses');
      showCourseDetailModal(id, document.activeElement);
    },
    onOpenVideo: id => {
      navigateTo('videos');
      const video = allVideos.find(item => item.id === id);
      if (video) showVideoModal(video, document.activeElement);
    },
    onOpenInternship: (id, trigger) => {
      navigateTo('internships');
      showInternshipDetailModal(id, trigger);
    }
  };
  initAiGuidance(callbacks);
  initResumeAnalyser(callbacks);
}

/* ==========================================================================
   5. TOAST NOTIFICATIONS
   ========================================================================== */
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#10b981"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#f59e0b"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
  } else if (type === 'danger') {
    iconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#ef4444"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
  } else {
    iconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#3b82f6"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
  }

  toast.innerHTML = `
    <div class="toast-message">
      ${iconSvg}
      <span>${escapeHtml(message)}</span>
    </div>
    <button class="toast-close-btn" aria-label="Dismiss">&times;</button>
  `;

  toast.querySelector('.toast-close-btn').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 250ms ease';
      setTimeout(() => toast.remove(), 250);
    }
  }, duration);
}

/* ==========================================================================
   6. THEME CONTROLLER
   ========================================================================== */
function initTheme() {
  const root = document.documentElement;
  const preferredTheme = state.theme;

  if (preferredTheme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (preferredTheme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    // System preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }

  updateThemeIcons();

  // Listen to OS scheme changes if on system
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.theme === 'system') {
      root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      updateThemeIcons();
    }
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  state.theme = next;
  safeStorageSet(STORAGE_KEYS.THEME, next);
  updateThemeIcons();
  showToast(`Switched to ${next} theme`, 'info', 2000);
}

function updateThemeIcons() {
  const current = document.documentElement.getAttribute('data-theme');
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  if (current === 'dark') {
    // Sun icon to switch to light
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.39.39-1.03 0-1.41s-1.02-.39-1.41 0z"/></svg>`;
    btn.setAttribute('aria-label', 'Switch to light mode');
    btn.title = 'Switch to light mode';
  } else {
    // Moon icon to switch to dark
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61e-5.01-.77.08-1.56.24-2.32 1.24-5.83 6.96-10.05 12.79-8.81.76.16 1.5.42 2.2.78C18.07 4.74 15.22 3 12 3z"/></svg>`;
    btn.setAttribute('aria-label', 'Switch to dark mode');
    btn.title = 'Switch to dark mode';
  }
}

/* ==========================================================================
   7. MODAL DIALOG CONTROLLER (Accessible Focus Trap & Escape)
   ========================================================================== */
let activeModalTrigger = null;

function openModal(dialogContentHtml, triggerElement = null) {
  activeModalTrigger = triggerElement || document.activeElement;
  const overlay = document.getElementById('global-modal-overlay');
  const dialog = document.getElementById('global-modal-dialog');
  if (!overlay || !dialog) return;

  dialog.innerHTML = dialogContentHtml;
  const title = dialog.querySelector('#modal-title');
  if (title) {
    title.id = 'active-modal-title';
    overlay.setAttribute('aria-labelledby', title.id);
  } else {
    overlay.removeAttribute('aria-labelledby');
  }
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  // Attach close listener to any [data-close-modal] buttons
  dialog.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // Focus the first actionable element in the modal
  const focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length) focusable[0].focus();
}

function closeModal() {
  const overlay = document.getElementById('global-modal-overlay');
  if (!overlay) return;

  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.removeAttribute('aria-labelledby');
  document.body.style.overflow = '';

  if (activeModalTrigger && typeof activeModalTrigger.focus === 'function') {
    activeModalTrigger.focus();
  }
}

// Global modal keyboard handling
window.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('global-modal-overlay');
  if (overlay && overlay.classList.contains('open')) {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter(element => element.getClientRects().length > 0);

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  }
});

/* ==========================================================================
   8. APPLICATION / TRACKER HELPERS
   ========================================================================== */
function isInternshipSaved(internshipId) {
  return state.applications.some(app => app.internshipId === internshipId);
}

function getApplicationRecord(internshipId) {
  return state.applications.find(app => app.internshipId === internshipId) || null;
}

function toggleSaveInternship(internshipId) {
  const existingIndex = state.applications.findIndex(app => app.internshipId === internshipId);
  const internship = rawInternships.find(i => i.id === internshipId);
  const companyName = internship ? internship.company : 'internship';

  if (existingIndex > -1) {
    // Remove from tracker
    state.applications.splice(existingIndex, 1);
    safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
    showToast(`Removed ${companyName} from tracker`, 'info');
  } else {
    // Add to tracker as 'Saved'
    const newRecord = {
      id: 'app-' + Date.now(),
      internshipId: internshipId,
      status: 'Saved',
      appliedDate: '',
      interviewDate: '',
      notes: '',
      updatedAt: new Date().toISOString()
    };
    state.applications.push(newRecord);
    safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
    showToast(`Saved ${companyName} to tracker!`, 'success');
  }

  updateBadges();
  // Refresh current view if applicable
  if (state.currentRoute === 'internships') {
    renderInternships();
  } else if (state.currentRoute === 'tracker') {
    renderTracker();
  } else if (state.currentRoute === 'home') {
    renderHomeFeatured();
  } else if (state.currentRoute === 'skill-gap') {
    renderSkillGapResults();
  }
}

function updateApplicationStatus(appId, newStatus) {
  const app = state.applications.find(a => a.id === appId);
  if (!app) return;

  app.status = newStatus;
  app.updatedAt = new Date().toISOString();
  if (newStatus === 'Applied' && !app.appliedDate) {
    app.appliedDate = new Date().toISOString().split('T')[0];
  }

  safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
  updateBadges();
  renderTracker();
  showToast(`Moved to ${newStatus}`, 'success');
}

function updateApplicationNotes(appId, notes) {
  const app = state.applications.find(a => a.id === appId);
  if (!app) return;
  app.notes = notes;
  app.updatedAt = new Date().toISOString();
  safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
}

function updateApplicationDates(appId, field, value) {
  const app = state.applications.find(a => a.id === appId);
  if (!app) return;
  app[field] = value;
  app.updatedAt = new Date().toISOString();
  safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
}

function removeApplication(appId) {
  state.applications = state.applications.filter(a => a.id !== appId);
  safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
  updateBadges();
  renderTracker();
  showToast('Application deleted', 'info');
}

function updateBadges() {
  const count = state.applications.length;
  const desktopBadge = document.getElementById('tracker-nav-count');
  const mobileBadge = document.getElementById('mobile-tracker-badge');

  if (desktopBadge) {
    desktopBadge.textContent = count;
    desktopBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }
  if (mobileBadge) {
    mobileBadge.textContent = count;
    mobileBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

/* ==========================================================================
   9. SKILL-GAP ENGINE
   ========================================================================== */
function calculateInternshipMatch(requiredSkills, userSkills) {
  if (!requiredSkills || !requiredSkills.length) {
    return { score: 100, matched: [], missing: [] };
  }

  const userSkillSet = new Set((userSkills || []).map(s => s.toLowerCase()));
  const matched = [];
  const missing = [];

  requiredSkills.forEach(reqSkill => {
    if (userSkillSet.has(reqSkill.toLowerCase())) {
      matched.push(reqSkill);
    } else {
      missing.push(reqSkill);
    }
  });

  const score = Math.round((matched.length / requiredSkills.length) * 100);
  return { score, matched, missing };
}

function findSuggestedCoursesForSkill(skillName) {
  const lowerSkill = skillName.toLowerCase();
  return rawCourses.filter(course =>
    course.skillsCovered.some(sc => sc.toLowerCase() === lowerSkill || sc.toLowerCase().includes(lowerSkill))
  );
}

/* ==========================================================================
   10. RENDER FUNCTIONS
   ========================================================================== */

/**
 * Render Home Page
 */
function renderHome() {
  renderHomeStats();
  renderHomeFeatured();
  renderHomeCategories();
}

function getVisibleInternships() {
  return rawInternships.filter(internship => state.showDemoData || internship.isDemo !== true);
}

function syncDemoDataControls() {
  ['home-include-demo', 'filter-include-demo', 'company-include-demo']
    .forEach(id => {
      const input = document.getElementById(id);
      if (input) input.checked = state.showDemoData;
    });
}

function setShowDemoData(show) {
  state.showDemoData = Boolean(show);
  safeStorageSet(STORAGE_KEYS.SHOW_DEMO_DATA, state.showDemoData);
  syncDemoDataControls();
  renderHomeStats();
  renderHomeFeatured();
  renderInternships();
  renderCompanies();
  if (state.currentRoute === 'skill-gap') renderSkillGapResults();
}

function renderHomeStats() {
  const statsContainer = document.getElementById('home-stats-banner');
  if (!statsContainer) return;

  const totalInternships = getVisibleInternships().length;
  const totalCourses = rawCourses.length;
  const activeApplications = state.applications.filter(a => ['Applied', 'Interview'].includes(a.status)).length;
  const completedCoursesCount = state.completedCourses.length;
  const heroInternshipCount = document.getElementById('hero-internship-count');
  if (heroInternshipCount) {
    heroInternshipCount.textContent = `${totalInternships} internship programs`;
  }

  statsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon" style="background: var(--primary-light); color: var(--primary);">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/></svg>
      </div>
      <div>
        <div class="stat-value">${totalInternships}</div>
        <div class="stat-label">Internship programs</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background: var(--secondary-light); color: var(--secondary-hover);">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>
      </div>
      <div>
        <div class="stat-value">${totalCourses}</div>
        <div class="stat-label">In-Demand Courses</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background: var(--accent-light); color: var(--accent);">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"/></svg>
      </div>
      <div>
        <div class="stat-value">${activeApplications}</div>
        <div class="stat-label">Active Applications</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background: var(--success-light); color: var(--success-text);">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
      </div>
      <div>
        <div class="stat-value">${completedCoursesCount}</div>
        <div class="stat-label">Skills Mastered</div>
      </div>
    </div>
  `;
}

function renderHomeCategories() {
  const container = document.getElementById('home-quick-chips');
  if (!container) return;

  const categories = rawCategories.filter(c => c !== 'All Fields');
  container.innerHTML = categories.map(cat => `
    <button class="chip" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
  `).join('');

  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.category;
      state.internshipFilters.field = cat;
      navigateTo('internships');
      const select = document.getElementById('filter-field');
      if (select) select.value = cat;
      renderInternships();
    });
  });
}

function renderHomeFeatured() {
  const container = document.getElementById('home-featured-grid');
  if (!container) return;

  const featured = getVisibleInternships().filter(i => i.featured).slice(0, 6);
  container.innerHTML = featured.map(internship => createInternshipCardHtml(internship)).join('');
  attachInternshipCardEvents(container);
}

/**
 * Internship Card HTML & Event Binder
 */
function createInternshipCardHtml(internship) {
  const isSaved = isInternshipSaved(internship.id);
  const matchInfo = calculateInternshipMatch(internship.skills, state.selectedSkills);
  const applyUrl = safeExternalUrl(internship.applyLink);

  // Format skills with matched highlighting
  const skillsHtml = internship.skills.map(skill => {
    const isMatched = matchInfo.matched.some(m => m.toLowerCase() === skill.toLowerCase());
    return `<span class="skill-tag ${isMatched ? 'matched' : ''}">${escapeHtml(skill)}</span>`;
  }).join('');

  // Mode badge class
  let modeBadgeClass = 'badge-neutral';
  if (internship.mode === 'Remote') modeBadgeClass = 'badge-success';
  else if (internship.mode === 'Hybrid') modeBadgeClass = 'badge-primary';

  return `
    <article class="internship-card" data-id="${escapeHtml(internship.id)}">
      <div class="card-top">
      <div class="company-logo" style="background-color: ${escapeHtml(internship.logoBg || '#e0e7ff')}; color: ${escapeHtml(internship.logoColor || '#3730a3')}">
        ${escapeHtml((internship.company || '').substring(0, 2).toUpperCase())}
        </div>
        <div class="card-title-group">
          <h3 class="card-title">${highlightText(internship.title, state.internshipFilters.search)}</h3>
          <div class="card-company">${highlightText(internship.company, state.internshipFilters.search)}</div>
        </div>
        <button class="bookmark-toggle-btn ${isSaved ? 'saved' : ''}" 
                data-action="toggle-save" 
                data-id="${internship.id}" 
                title="${isSaved ? 'Remove from Tracker' : 'Save to Tracker'}" 
                aria-label="${isSaved ? 'Remove from Tracker' : 'Save to Tracker'}">
          <svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
        </button>
      </div>

      <div class="card-meta-list">
        <span class="card-meta-item">
          <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          ${escapeHtml(internship.location)}
        </span>
        <span class="badge ${modeBadgeClass}">${escapeHtml(internship.mode)}</span>
        <span class="badge badge-neutral">${escapeHtml(internship.duration)}</span>
      </div>

      <p class="card-desc">${escapeHtml(internship.description)}</p>

      <div class="skills-tag-wrap">
        ${skillsHtml}
      </div>

      <div class="card-footer">
        <div>
          <div class="card-stipend">${escapeHtml(internship.stipend)}</div>
          <div class="card-deadline">Deadline: ${escapeHtml(internship.isDemo ? 'Demo only - no real deadline' : internship.deadline || 'Rolling / Check site')}</div>
          <div class="verification-label">${internship.isDemo ? '<span class="badge badge-warning badge-demo">Demo data</span>' : hasVerificationEvidence(internship) ? `Verified · Last checked ${escapeHtml(internship.lastVerified)}` : 'Check official site'}</div>
        </div>
        <div class="card-actions">
          <button class="btn btn-outline btn-sm" data-action="view-details" data-id="${internship.id}">
            Details
          </button>
          ${applyUrl
            ? `<button class="btn btn-primary btn-sm" data-action="quick-apply" data-id="${escapeHtml(internship.id)}">Check official site</button>`
            : `<span class="btn btn-primary btn-sm" aria-disabled="true">${internship.isDemo ? 'Demo only - no application link' : 'Check official site'}</span>`}
        </div>
      </div>
    </article>
  `;
}

function attachInternshipCardEvents(container) {
  if (!container) return;

  container.querySelectorAll('[data-action="toggle-save"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleSaveInternship(id);
    });
  });

  container.querySelectorAll('[data-action="view-details"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      showInternshipDetailModal(id, btn);
    });
  });

  container.querySelectorAll('[data-action="quick-apply"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      handleQuickApply(id, btn);
    });
  });

  // Clicking card opens modal too
  container.querySelectorAll('.internship-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = card.dataset.id;
      showInternshipDetailModal(id, card);
    });
  });
}

/**
 * Handle Quick Apply flow
 */
function handleQuickApply(internshipId, triggerElement) {
  const internship = rawInternships.find(i => i.id === internshipId);
  if (!internship) return;
  const applyUrl = safeExternalUrl(internship.applyLink);
  if (!applyUrl) {
    showToast('This listing has no confirmed application URL. Check the official company site.', 'warning');
    return;
  }

  let app = getApplicationRecord(internshipId);
  if (!app) {
    app = {
      id: 'app-' + Date.now(),
      internshipId: internshipId,
      status: 'Applied',
      appliedDate: new Date().toISOString().split('T')[0],
      interviewDate: '',
      notes: 'Applied via SkillBridge Portal.',
      updatedAt: new Date().toISOString()
    };
    state.applications.push(app);
  } else {
    app.status = 'Applied';
    if (!app.appliedDate) {
      app.appliedDate = new Date().toISOString().split('T')[0];
    }
    app.updatedAt = new Date().toISOString();
  }

  safeStorageSet(STORAGE_KEYS.APPLICATIONS, state.applications);
  updateBadges();

  showToast(`Marked ${internship.company} as 'Applied'! Redirecting...`, 'success');

  // Open apply link in new tab
  setTimeout(() => {
    window.open(applyUrl, '_blank', 'noopener,noreferrer');
  }, 400);

  if (state.currentRoute === 'tracker') {
    renderTracker();
  } else if (state.currentRoute === 'internships') {
    renderInternships();
  }
}

/**
 * Render Internships Directory
 */
function renderInternships() {
  const container = document.getElementById('internships-list');
  const countDisplay = document.getElementById('internships-result-count');
  if (!container) return;

  const filters = state.internshipFilters;
  const engineFilters = {
    q: filters.search,
    field: filters.field === 'All Fields' ? 'all' : filters.field,
    state: filters.state,
    city: filters.location,
    mode: filters.mode,
    duration: filters.duration,
    paid: filters.compensation,
    stipendRange: filters.stipendRange,
    companyType: filters.companyType,
    eligibility: filters.eligibility,
    verifiedOnly: filters.verifiedOnly,
    deadlineSoon: filters.deadlineSoon,
    includeDemoData: state.showDemoData
  };
  const results = sortInternships(
    filterInternships(rawInternships, engineFilters),
    filters.sort,
    filters.search
  );
  syncInternshipFiltersToUrl(filters);
  renderActiveFilterChips(filters);

  if (countDisplay) {
    countDisplay.textContent = `Showing ${results.length} of ${rawInternships.length} internships`;
  }

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        </div>
        <h3 class="empty-state-title">No matching internships found</h3>
        <p class="empty-state-text">Try adjusting your filters, clearing your search keywords, or selecting a broader field.</p>
        <button class="btn btn-primary" id="btn-reset-internship-filters">Clear All Filters</button>
      </div>
    `;
    const resetBtn = document.getElementById('btn-reset-internship-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetInternshipFilters);
    }
    return;
  }

  container.innerHTML = results.map(internship => createInternshipCardHtml(internship)).join('');
  attachInternshipCardEvents(container);
}

function syncInternshipFiltersToUrl(filters) {
  const params = new URLSearchParams(window.location.search);
  const values = {
    q: filters.search,
    field: filters.field === 'All Fields' ? '' : filters.field,
    state: filters.state,
    city: filters.location,
    mode: filters.mode,
    duration: filters.duration,
    paid: filters.compensation,
    stipend: filters.stipendRange,
    type: filters.companyType,
    eligibility: filters.eligibility,
    verified: filters.verifiedOnly ? 'true' : '',
    deadlineSoon: filters.deadlineSoon ? 'true' : '',
    demo: state.showDemoData ? 'true' : '',
    sort: filters.sort === 'newest' ? '' : filters.sort
  };
  for (const [key, value] of Object.entries(values)) {
    if (!value || value === 'all') params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

function renderActiveFilterChips(filters) {
  const container = document.getElementById('active-filter-chips');
  if (!container) return;
  const entries = [
    ['search', 'Search', filters.search],
    ['field', 'Field', filters.field !== 'All Fields' ? filters.field : ''],
    ['state', 'State', filters.state !== 'all' ? filters.state : ''],
    ['location', 'City', filters.location !== 'all' ? filters.location : ''],
    ['mode', 'Mode', filters.mode !== 'all' ? filters.mode : ''],
    ['duration', 'Duration', filters.duration !== 'all' ? `${filters.duration} months` : ''],
    ['compensation', 'Paid status', filters.compensation !== 'all' ? filters.compensation : ''],
    ['stipendRange', 'Stipend', STIPEND_RANGES.find(range => range.id === filters.stipendRange)?.label || ''],
    ['companyType', 'Company type', filters.companyType !== 'all' ? filters.companyType : ''],
    ['eligibility', 'Eligibility', filters.eligibility !== 'all' ? filters.eligibility : ''],
    ['verifiedOnly', 'Verified only', filters.verifiedOnly ? 'Yes' : ''],
    ['deadlineSoon', 'Deadline soon', filters.deadlineSoon ? 'Yes' : ''],
    ['showDemoData', 'Demo data', state.showDemoData ? 'Included' : 'Hidden'],
    ['sort', 'Sort', filters.sort !== 'newest' ? filters.sort : '']
  ].filter(([, , value]) => value);
  container.innerHTML = entries.map(([key, label, value]) =>
    `<button type="button" class="chip active" data-clear-filter="${key}">${escapeHtml(label)}: ${escapeHtml(value)} ×</button>`
  ).join('');
  container.querySelectorAll('[data-clear-filter]').forEach(button => {
    button.addEventListener('click', () => clearInternshipFilter(button.dataset.clearFilter));
  });
}

function clearInternshipFilter(key) {
  const defaults = {
    search: '',
    field: 'All Fields',
    state: 'all',
    location: 'all',
    mode: 'all',
    duration: 'all',
    compensation: 'all',
    stipendRange: 'all',
    companyType: 'all',
    eligibility: 'all',
    verifiedOnly: false,
    deadlineSoon: false,
    showDemoData: false,
    sort: 'newest'
  };
  if (!(key in defaults)) return;
  if (key === 'showDemoData') {
    setShowDemoData(false);
    return;
  }
  state.internshipFilters[key] = defaults[key];
  if (key === 'state') state.internshipFilters.location = 'all';
  const controls = {
    search: 'internship-search-input',
    field: 'filter-field',
    state: 'filter-state',
    location: 'filter-location',
    mode: 'filter-mode',
    duration: 'filter-duration',
    compensation: 'filter-comp',
    stipendRange: 'filter-stipend-range',
    companyType: 'filter-company-type',
    eligibility: 'filter-eligibility',
    verifiedOnly: 'filter-verified',
    deadlineSoon: 'filter-deadline-soon',
    showDemoData: 'filter-include-demo',
    sort: 'filter-sort'
  };
  const control = document.getElementById(controls[key]);
  if (control) {
    if (key === 'verifiedOnly' || key === 'deadlineSoon' || key === 'showDemoData') control.checked = false;
    else control.value = defaults[key];
  }
  if (key === 'state') {
    document.getElementById('filter-location').innerHTML = [
      '<option value="all">All Cities</option>',
      ...[...new Set(Object.values(CITIES_BY_STATE).flat())].sort()
        .map(city => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`)
    ].join('');
  }
  if (key === 'search') {
    const heroInput = document.getElementById('hero-search-input');
    if (heroInput) heroInput.value = '';
  }
  renderInternships();
}

function getCompanyProgramIndex() {
  const programsByCompany = new Map();
  getVisibleInternships().forEach(internship => {
    const programs = programsByCompany.get(internship.companyId) || [];
    programs.push(internship);
    programsByCompany.set(internship.companyId, programs);
  });
  const counts = new Map([...programsByCompany].map(([id, programs]) => [id, programs.length]));
  const titles = new Map([...programsByCompany].map(([id, programs]) => [
    id,
    programs.map(program => program.title)
  ]));
  return { programsByCompany, counts, titles };
}

function showCompanyDetailModal(companyId, triggerElement) {
  const company = rawCompanies.find(record => record.id === companyId);
  if (!company) return;
  const { programsByCompany } = getCompanyProgramIndex();
  const programs = programsByCompany.get(companyId) || [];
  const website = safeExternalUrl(company.website);
  const careersUrl = safeExternalUrl(company.careersUrl);
  const links = [
    website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Website</a>` : '',
    careersUrl ? `<a href="${escapeHtml(careersUrl)}" target="_blank" rel="noopener noreferrer">Careers</a>` : ''
  ].filter(Boolean).join(' · ');
  openModal(`
    <div class="modal-header">
      <div>
        <h2 id="modal-title">${escapeHtml(company.name)}</h2>
        <p class="text-muted">${escapeHtml(company.sector || 'Industry: Check official site')} · ${escapeHtml(company.type || 'Type: Check official site')}</p>
      </div>
      <button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close modal">&times;</button>
    </div>
    <div class="modal-body">
      <p class="verification-label">${company.isDemo ? '<span class="badge badge-warning badge-demo">Demo data</span>' : hasVerificationEvidence(company) ? `Verified · Last checked ${escapeHtml(company.lastVerified)}` : 'Check official site'}</p>
      <p>${escapeHtml(company.description || 'Description: Check official site')}</p>
      <p class="text-muted">${escapeHtml([company.city, company.state].filter(Boolean).join(', ') || 'Headquarters: Check official site')}</p>
      <p>${links || 'Official website: Check official site'}</p>
      <h3>Internship programs (${programs.length})</h3>
      ${programs.length ? `<ul class="company-program-list">${programs.map(program => `
        <li>
          <button type="button" class="btn btn-ghost btn-sm" data-company-program="${escapeHtml(program.id)}">${escapeHtml(program.title)}</button>
          <span class="text-muted">${program.isDemo ? 'Demo data - not a real opening' : escapeHtml(program.deadline || 'Rolling / Check site')}</span>
        </li>`).join('')}</ul>` : '<p class="text-muted">No internship programs are currently listed.</p>'}
    </div>
  `, triggerElement);
  document.querySelectorAll('[data-company-program]').forEach(button => {
    button.addEventListener('click', () => {
      const internshipId = button.dataset.companyProgram;
      closeModal();
      navigateTo('internships');
      showInternshipDetailModal(internshipId, triggerElement);
    });
  });
}

function renderCompanies() {
  const container = document.getElementById('companies-list');
  const countDisplay = document.getElementById('companies-result-count');
  if (!container) return;
  const { counts, titles } = getCompanyProgramIndex();
  const companies = filterCompanies(rawCompanies, {
    ...state.companyFilters,
    q: document.getElementById('company-search-input')?.value || '',
    includeDemoData: state.showDemoData,
    programTitlesByCompany: titles
  }, counts);
  if (countDisplay) countDisplay.textContent = `Showing ${companies.length} of ${rawCompanies.length} organizations`;
  if (!companies.length) {
    container.innerHTML = '<div class="empty-state"><h3 class="empty-state-title">No organizations found</h3><p class="empty-state-text">Try changing the search or filters.</p><button class="btn btn-primary" type="button" id="btn-reset-company-filters">Reset filters</button></div>';
    container.querySelector('#btn-reset-company-filters')?.addEventListener('click', resetCompanyFilters);
    return;
  }
  container.innerHTML = companies.map(company => {
    const initials = company.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    const website = safeExternalUrl(company.website);
    const careersUrl = safeExternalUrl(company.careersUrl);
    const officialLinks = [
      website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Website</a>` : '',
      careersUrl ? `<a href="${escapeHtml(careersUrl)}" target="_blank" rel="noopener noreferrer">Careers</a>` : ''
    ].filter(Boolean).join(' · ');
    const programCount = counts.get(company.id) || 0;
    const location = [company.city, company.state].filter(Boolean).join(', ')
      || 'Headquarters: Check official site';
    const verification = company.isDemo
      ? '<span class="badge badge-warning badge-demo">Demo data</span>'
      : hasVerificationEvidence(company)
        ? `Verified · Last checked ${escapeHtml(company.lastVerified)}`
        : 'Check official site';
    return `
      <article class="course-card company-card">
        <div class="company-card-heading">
          <div class="company-initials" aria-hidden="true">${escapeHtml(initials)}</div>
          <div>
            <h2 class="course-title">${escapeHtml(company.name)}</h2>
            <p class="course-provider">${escapeHtml(company.sector || 'Industry: Check official site')} · ${escapeHtml(company.type || 'Type: Check official site')}</p>
          </div>
        </div>
        <p class="card-desc">${escapeHtml(company.description || 'Description: Check official site')}</p>
        <p class="text-muted">${escapeHtml(location)}</p>
        <p class="verification-label">${verification}</p>
        <p class="text-muted">${programCount} internship program${programCount === 1 ? '' : 's'}</p>
        <div class="card-footer">
          <div class="card-actions">${officialLinks || '<span class="text-muted">Official links: Check official site</span>'}</div>
          <div class="card-actions">
            <button type="button" class="btn btn-outline btn-sm" data-company-details="${escapeHtml(company.id)}">Details</button>
            <button type="button" class="btn btn-outline btn-sm" data-company-filter="${escapeHtml(company.name)}">Browse internships</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function renderAdmin() {
  const companySelect = document.getElementById('admin-company-select');
  const internshipSelect = document.getElementById('admin-internship-select');
  const status = document.getElementById('admin-status');
  try {
    const [companies, internships] = await Promise.all([
      fetchAll(companiesService),
      fetchAll(internshipsService)
    ]);
    if (companySelect) {
      companySelect.innerHTML = [
        '<option value="">Select a company to edit</option>',
        ...companies.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.name)}</option>`)
      ].join('');
    }
    if (internshipSelect) {
      internshipSelect.innerHTML = [
        '<option value="">Select an internship to edit</option>',
        ...internships.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.title)}</option>`)
      ].join('');
    }
    if (status) status.textContent = `Loaded ${companies.length} organizations and ${internships.length} internship records.`;
  } catch (error) {
    console.error('[Admin] Could not load catalog records.', error);
    if (status) status.textContent = `Could not load catalog records: ${error.message}`;
  }
}

async function loadAdminRecord(service, selectId, textareaId) {
  const id = document.getElementById(selectId)?.value;
  const textarea = document.getElementById(textareaId);
  const status = document.getElementById('admin-status');
  if (!id || !textarea) return;
  try {
    const record = await service.getById(id);
    if (!record) throw new Error('The selected record no longer exists.');
    textarea.value = JSON.stringify(record, null, 2);
    if (status) status.textContent = `Loaded ${id}.`;
  } catch (error) {
    console.error('[Admin] Could not load the selected record.', error);
    if (status) status.textContent = error.message;
  }
}

async function saveAdminRecord(textareaId, save) {
  const status = document.getElementById('admin-status');
  try {
    if (!state.user) throw new Error('Sign in with an admin account first.');
    const record = JSON.parse(document.getElementById(textareaId).value);
    await save(record);
    if (status) status.textContent = `Saved ${record.id}.`;
    await loadCatalogs();
    await renderAdmin();
  } catch (error) {
    console.error('[Admin] Could not save catalog record.', error);
    if (status) status.textContent = error.message;
  }
}

async function deleteAdminRecord(remove, label) {
  const status = document.getElementById('admin-status');
  try {
    if (!state.user) throw new Error('Sign in with an admin account first.');
    await remove();
    if (status) status.textContent = `${label} deleted.`;
    await loadCatalogs();
    await renderAdmin();
  } catch (error) {
    console.error(`[Admin] Could not delete ${label.toLowerCase()}.`, error);
    if (status) status.textContent = error.message;
  }
}

function updateCompanyCityOptions() {
  const citySelect = document.getElementById('company-city-filter');
  if (!citySelect) return;
  const selectedState = state.companyFilters.state;
  const cities = [...new Set(rawCompanies
    .filter(company => selectedState === 'all' || company.state === selectedState)
    .map(company => company.city)
    .filter(Boolean))].sort();
  citySelect.innerHTML = [
    '<option value="all">All cities</option>',
    ...cities.map(city => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`)
  ].join('');
  if (!cities.includes(state.companyFilters.city)) state.companyFilters.city = 'all';
  citySelect.value = state.companyFilters.city;
}

function initCompanyFilters() {
  const sectorSelect = document.getElementById('company-sector-filter');
  if (sectorSelect) {
    const sectors = [...new Set(rawCompanies.map(company => company.sector).filter(Boolean))].sort();
    sectorSelect.innerHTML = [
      '<option value="all">All industries</option>',
      ...sectors.map(sector => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`)
    ].join('');
    sectorSelect.value = state.companyFilters.sector;
    sectorSelect.addEventListener('change', event => {
      state.companyFilters.sector = event.target.value;
      renderCompanies();
    });
  }

  const typeSelect = document.getElementById('company-type-filter');
  if (typeSelect) {
    typeSelect.innerHTML = [
      '<option value="all">All company types</option>',
      ...COMPANY_TYPES.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    ].join('');
    typeSelect.value = state.companyFilters.type;
    typeSelect.addEventListener('change', event => {
      state.companyFilters.type = event.target.value;
      renderCompanies();
    });
  }

  const stateSelect = document.getElementById('company-state-filter');
  if (stateSelect) {
    const states = [...new Set(rawCompanies.map(company => company.state)
      .filter(value => INDIAN_STATES.includes(value)))].sort();
    stateSelect.innerHTML = [
      '<option value="all">All states</option>',
      ...states.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    ].join('');
    stateSelect.value = state.companyFilters.state;
    stateSelect.addEventListener('change', event => {
      state.companyFilters.state = event.target.value;
      state.companyFilters.city = 'all';
      updateCompanyCityOptions();
      renderCompanies();
    });
  }
  updateCompanyCityOptions();

  const citySelect = document.getElementById('company-city-filter');
  citySelect?.addEventListener('change', event => {
    state.companyFilters.city = event.target.value;
    renderCompanies();
  });

  const hasInternships = document.getElementById('company-has-internships');
  if (hasInternships) {
    hasInternships.checked = state.companyFilters.hasInternships;
    hasInternships.addEventListener('change', event => {
      state.companyFilters.hasInternships = event.target.checked;
      renderCompanies();
    });
  }
  document.getElementById('company-reset-filters')?.addEventListener('click', resetCompanyFilters);
}

function resetCompanyFilters() {
  state.companyFilters = {
    sector: 'all',
    type: 'all',
    state: 'all',
    city: 'all',
    hasInternships: false
  };
  const search = document.getElementById('company-search-input');
  if (search) search.value = '';
  ['company-sector-filter', 'company-type-filter', 'company-state-filter']
    .forEach(id => {
      const select = document.getElementById(id);
      if (select) select.value = 'all';
    });
  const hasInternships = document.getElementById('company-has-internships');
  if (hasInternships) hasInternships.checked = false;
  updateCompanyCityOptions();
  setShowDemoData(false);
  renderCompanies();
}

function resetInternshipFilters() {
  state.internshipFilters = {
    search: '',
    field: 'All Fields',
    location: 'all',
    state: 'all',
    mode: 'all',
    duration: 'all',
    compensation: 'all',
    stipendRange: 'all',
    companyType: 'all',
    eligibility: 'all',
    verifiedOnly: false,
    deadlineSoon: false,
    sort: 'newest'
  };

  const searchInput = document.getElementById('internship-search-input');
  if (searchInput) searchInput.value = '';

  const fieldSelect = document.getElementById('filter-field');
  if (fieldSelect) fieldSelect.value = 'All Fields';

  const locationSelect = document.getElementById('filter-location');
  if (locationSelect) {
    const cities = [...new Set(Object.values(CITIES_BY_STATE).flat())].sort();
    locationSelect.innerHTML = [
      '<option value="all">All Cities</option>',
      ...cities.map(city => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`)
    ].join('');
    locationSelect.value = 'all';
  }

  const stateSelect = document.getElementById('filter-state');
  if (stateSelect) stateSelect.value = 'all';

  const modeSelect = document.getElementById('filter-mode');
  if (modeSelect) modeSelect.value = 'all';

  const durationSelect = document.getElementById('filter-duration');
  if (durationSelect) durationSelect.value = 'all';

  const compSelect = document.getElementById('filter-comp');
  if (compSelect) compSelect.value = 'all';

  ['filter-stipend-range', 'filter-company-type', 'filter-eligibility'].forEach(id => {
    const select = document.getElementById(id);
    if (select) select.value = 'all';
  });
  const verifiedSelect = document.getElementById('filter-verified');
  if (verifiedSelect) verifiedSelect.checked = false;
  const deadlineSelect = document.getElementById('filter-deadline-soon');
  if (deadlineSelect) deadlineSelect.checked = false;
  state.showDemoData = false;
  safeStorageSet(STORAGE_KEYS.SHOW_DEMO_DATA, false);
  syncDemoDataControls();

  const sortSelect = document.getElementById('filter-sort');
  if (sortSelect) sortSelect.value = 'newest';

  renderInternships();
  showToast('Filters cleared', 'info');
}

/**
 * Render Courses Directory
 */
function renderCourses() {
  const container = document.getElementById('courses-list');
  const countDisplay = document.getElementById('courses-result-count');
  if (!container) return;
  renderPathCards('course-learning-paths');

  const filters = state.courseFilters;

  let results = rawCourses.filter(course => {
    // Search text match
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const nameMatch = course.name.toLowerCase().includes(q);
      const descMatch = course.description.toLowerCase().includes(q);
      const provMatch = course.provider.toLowerCase().includes(q);
      const skillMatch = course.skillsCovered.some(s => s.toLowerCase().includes(q));
      if (!nameMatch && !descMatch && !provMatch && !skillMatch) return false;
    }

    // Category match
    if (filters.category !== 'all') {
      if (course.category !== filters.category) return false;
    }

    // Level match
    if (filters.level !== 'all') {
      if (course.level.toLowerCase() !== filters.level.toLowerCase()) return false;
    }

    // Price match
    if (filters.price !== 'all') {
      if (filters.price === 'free' && !course.isFree) return false;
      if (filters.price === 'paid' && course.isFree) return false;
    }

    return true;
  });

  if (countDisplay) {
    countDisplay.textContent = `Showing ${results.length} of ${rawCourses.length} courses`;
  }

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3z"/></svg>
        </div>
        <h3 class="empty-state-title">No matching courses found</h3>
        <p class="empty-state-text">Try resetting course category or level filters.</p>
        <button class="btn btn-secondary" id="btn-reset-course-filters">Reset Course Filters</button>
      </div>
    `;
    const resetBtn = document.getElementById('btn-reset-course-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetCourseFilters);
    }
    return;
  }

  container.innerHTML = results.map(course => {
    const isCompleted = state.completedCourses.includes(course.id);
    const skillsHtml = (course.skillsCovered || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('');
    const courseUrl = safeExternalUrl(course.link);

    return `
      <article class="course-card" data-id="${escapeHtml(course.id)}">
        <div class="course-badge-row">
          <span class="badge ${course.isFree ? 'badge-success' : 'badge-primary'}">${escapeHtml(course.price)}</span>
          <span class="badge badge-neutral">${escapeHtml(course.level)}</span>
        </div>

        <h3 class="course-title">${escapeHtml(course.name)}</h3>
        <div class="course-provider">${escapeHtml(course.provider)} • ${escapeHtml(course.duration)}</div>

        <p class="card-desc">${escapeHtml(course.description)}</p>
        <p class="verification-label">${course.verified === true ? 'Verified' : 'Check official site'}${course.lastVerified ? ` · Last checked ${escapeHtml(course.lastVerified)}` : ''}</p>

        <div class="skills-tag-wrap">
          ${skillsHtml}
        </div>

        <div class="card-footer">
          <label class="course-completed-toggle" title="Mark as completed to update your learning progress">
            <input type="checkbox" class="course-checkbox" data-course-id="${course.id}" ${isCompleted ? 'checked' : ''}>
            <span>${isCompleted ? 'Completed ✓' : 'Mark Complete'}</span>
          </label>
          <div class="card-actions">
            <button class="btn btn-outline btn-sm" data-action="view-course-details" data-id="${course.id}">
              Syllabus
            </button>
            ${courseUrl
              ? `<a href="${escapeHtml(courseUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Official course site ↗</a>`
              : '<span class="btn btn-secondary btn-sm" aria-disabled="true">Check official site</span>'}
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Course events
  container.querySelectorAll('.course-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const cid = cb.dataset.courseId;
      toggleCourseCompletion(cid, cb.checked);
    });
  });

  container.querySelectorAll('[data-action="view-course-details"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const cid = btn.dataset.id;
      showCourseDetailModal(cid, btn);
    });
  });
}

function resetCourseFilters() {
  state.courseFilters = {
    search: '',
    category: 'all',
    level: 'all',
    price: 'all'
  };

  const searchInput = document.getElementById('course-search-input');
  if (searchInput) searchInput.value = '';

  const catSelect = document.getElementById('filter-course-category');
  if (catSelect) catSelect.value = 'all';

  const lvlSelect = document.getElementById('filter-course-level');
  if (lvlSelect) lvlSelect.value = 'all';

  renderCourses();
  showToast('Course filters reset', 'info');
}

function toggleCourseCompletion(courseId, isChecked) {
  const course = rawCourses.find(c => c.id === courseId);
  const name = course ? course.name : 'Course';

  if (isChecked) {
    if (!state.completedCourses.includes(courseId)) {
      state.completedCourses.push(courseId);
    }
    showToast(`Completed: ${name}! Added to your profile.`, 'success');
  } else {
    state.completedCourses = state.completedCourses.filter(id => id !== courseId);
    showToast(`Removed from completed courses`, 'info');
  }

  safeStorageSet(STORAGE_KEYS.COMPLETED_COURSES, state.completedCourses);
  renderCourses();
  renderProfile();
  renderHomeStats();
}

/**
 * Render Skill-Gap Matcher
 */
function renderSkillGap() {
  renderSkillSelectorCloud();
  renderSkillGapResults();
}

function renderSkillSelectorCloud() {
  const cloud = document.getElementById('skills-picker-cloud');
  const countBadge = document.getElementById('selected-skills-count');
  if (!cloud) return;

  if (countBadge) {
    countBadge.textContent = `${state.selectedSkills.length} selected`;
  }

  cloud.innerHTML = rawSkills.map(skill => {
    const isSelected = state.selectedSkills.some(s => s.toLowerCase() === skill.toLowerCase());
    return `
      <button class="chip ${isSelected ? 'active' : ''}" data-skill="${escapeHtml(skill)}">
        ${isSelected ? '✓ ' : '+ '}${escapeHtml(skill)}
      </button>
    `;
  }).join('');

  cloud.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const skill = chip.dataset.skill;
      toggleSelectedSkill(skill);
    });
  });
}

function toggleSelectedSkill(skill) {
  const lower = skill.toLowerCase();
  const exists = state.selectedSkills.some(s => s.toLowerCase() === lower);

  if (exists) {
    state.selectedSkills = state.selectedSkills.filter(s => s.toLowerCase() !== lower);
  } else {
    state.selectedSkills.push(skill);
  }

  safeStorageSet(STORAGE_KEYS.SELECTED_SKILLS, state.selectedSkills);
  renderSkillSelectorCloud();
  renderSkillGapResults();
}

function addCustomSkill(skillName) {
  const cleaned = skillName.trim();
  if (!cleaned) return;

  const exists = state.selectedSkills.some(s => s.toLowerCase() === cleaned.toLowerCase());
  if (!exists) {
    state.selectedSkills.push(cleaned);
    safeStorageSet(STORAGE_KEYS.SELECTED_SKILLS, state.selectedSkills);
    showToast(`Added skill: "${cleaned}"`, 'success');
  } else {
    showToast(`Skill "${cleaned}" is already selected`, 'info');
  }

  renderSkillSelectorCloud();
  renderSkillGapResults();
}

function syncSkillsFromProfile() {
  if (state.profile && Array.isArray(state.profile.skills)) {
    state.selectedSkills = [...state.profile.skills];
    safeStorageSet(STORAGE_KEYS.SELECTED_SKILLS, state.selectedSkills);
    renderSkillSelectorCloud();
    renderSkillGapResults();
    showToast(`Synced ${state.selectedSkills.length} skills from Profile`, 'success');
  }
}

function renderSkillGapResults() {
  const container = document.getElementById('skill-gap-results');
  if (!container) return;

  if (state.selectedSkills.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        </div>
        <h3 class="empty-state-title">Select your skills above</h3>
        <p class="empty-state-text">Choose the skills you currently know to analyze your match percentage across internships and get personalized course recommendations to bridge the gap.</p>
        <button class="btn btn-primary" id="btn-sync-skills">Load Skills From Profile</button>
      </div>
    `;
    const syncBtn = document.getElementById('btn-sync-skills');
    if (syncBtn) syncBtn.addEventListener('click', syncSkillsFromProfile);
    return;
  }

  // Calculate scores for all internships
  const scoredInternships = rawInternships.map(internship => {
    const match = calculateInternshipMatch(internship.skills, state.selectedSkills);
    return {
      internship,
      score: match.score,
      matched: match.matched,
      missing: match.missing
    };
  });

  // Sort descending by match score
  scoredInternships.sort((a, b) => b.score - a.score);

  container.innerHTML = scoredInternships.map(({ internship, score, matched, missing }) => {
    let gaugeClass = 'low';
    if (score >= 80) gaugeClass = 'high';
    else if (score >= 50) gaugeClass = 'medium';

    // Build suggested courses for missing skills
    let suggestedCoursesHtml = '';
    if (missing.length > 0) {
      const suggestions = [];
      missing.slice(0, 3).forEach(ms => {
        const found = findSuggestedCoursesForSkill(ms);
        if (found.length) {
          suggestions.push({ skill: ms, course: found[0] });
        }
      });

      if (suggestions.length > 0) {
        suggestedCoursesHtml = `
          <div style="margin-top: 1rem;">
            <div class="match-col-title" style="color: var(--primary);">
              💡 Recommended courses to bridge your gap:
            </div>
            ${suggestions.map(s => `
              <div class="suggested-course-mini">
                <div>
                  <strong>${escapeHtml(s.course.name)}</strong>
                  <span class="text-muted" style="font-size: 0.75rem;">(${escapeHtml(s.course.provider)} • ${escapeHtml(s.course.price)})</span>
                </div>
                <button class="btn btn-primary btn-sm" data-action="view-course-details" data-id="${s.course.id}">
                  View
                </button>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    const isSaved = isInternshipSaved(internship.id);

    return `
      <div class="match-result-card">
        <div class="match-header-row">
          <div class="flex items-center gap-3">
            <div class="match-gauge-circle ${gaugeClass}">
              ${score}%
            </div>
            <div>
              <h3 style="font-size: 1.15rem; margin-bottom: 0.2rem;">${escapeHtml(internship.title)}</h3>
              <div class="text-muted" style="font-size: 0.9rem; font-weight: 600;">
                ${escapeHtml(internship.company)} • ${escapeHtml(internship.field)} • ${escapeHtml(internship.stipend)}
              </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="bookmark-toggle-btn ${isSaved ? 'saved' : ''}" data-action="toggle-save" data-id="${internship.id}" title="${isSaved ? 'Remove from Tracker' : 'Save'}">
              <svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            </button>
            <button class="btn btn-outline btn-sm" data-action="view-details" data-id="${internship.id}">
              Details
            </button>
            <button class="btn btn-primary btn-sm" data-action="quick-apply" data-id="${internship.id}">
              Apply
            </button>
          </div>
        </div>

        <div class="match-breakdown">
          <div>
            <div class="match-col-title" style="color: var(--success-text);">
              ✓ Matched Skills (${matched.length})
            </div>
            <div class="skills-tag-wrap" style="margin-bottom: 0;">
              ${matched.length ? matched.map(m => `<span class="skill-tag matched">✓ ${escapeHtml(m)}</span>`).join('') : '<span class="text-muted" style="font-size: 0.85rem;">None</span>'}
            </div>
          </div>
          <div>
            <div class="match-col-title" style="color: var(--warning-text);">
              ⚠ Missing Skills to Learn (${missing.length})
            </div>
            <div class="skills-tag-wrap" style="margin-bottom: 0;">
              ${missing.length ? missing.map(m => `<span class="skill-tag missing">+ ${escapeHtml(m)}</span>`).join('') : '<span class="text-muted" style="font-size: 0.85rem;">Great job! You have all required skills.</span>'}
            </div>
          </div>
        </div>

        ${suggestedCoursesHtml}
      </div>
    `;
  }).join('');

  attachInternshipCardEvents(container);

  container.querySelectorAll('[data-action="view-course-details"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.id;
      showCourseDetailModal(cid, btn);
    });
  });
}

/**
 * Render Application Tracker
 */
function renderTracker() {
  const authNotice = document.getElementById('tracker-auth-notice');
  if (authNotice) authNotice.hidden = state.authStatus !== 'guest';
  renderTrackerMetrics();
  renderTrackerTabs();
  renderTrackerList();
}

function renderTrackerMetrics() {
  const container = document.getElementById('tracker-metrics-grid');
  if (!container) return;

  const total = state.applications.length;
  const saved = state.applications.filter(a => a.status === 'Saved').length;
  const applied = state.applications.filter(a => a.status === 'Applied').length;
  const interview = state.applications.filter(a => a.status === 'Interview').length;
  const offer = state.applications.filter(a => a.status === 'Offer').length;
  const rejected = state.applications.filter(a => a.status === 'Rejected').length;

  const responseRate = (applied + interview + offer + rejected) > 0 
    ? Math.round(((interview + offer) / (applied + interview + offer + rejected)) * 100) 
    : 0;

  container.innerHTML = `
    <div class="metric-box">
      <div class="metric-number">${total}</div>
      <div class="metric-title">Total Tracked</div>
    </div>
    <div class="metric-box">
      <div class="metric-number" style="color: var(--primary);">${saved}</div>
      <div class="metric-title">Saved Opportunities</div>
    </div>
    <div class="metric-box">
      <div class="metric-number" style="color: var(--info);">${applied}</div>
      <div class="metric-title">Applied</div>
    </div>
    <div class="metric-box">
      <div class="metric-number" style="color: var(--warning);">${interview}</div>
      <div class="metric-title">Interviews Scheduled</div>
    </div>
    <div class="metric-box">
      <div class="metric-number" style="color: var(--success);">${offer}</div>
      <div class="metric-title">Offers Received 🎉</div>
    </div>
    <div class="metric-box">
      <div class="metric-number" style="color: var(--secondary);">${responseRate}%</div>
      <div class="metric-title">Interview Rate</div>
    </div>
  `;
}

function renderTrackerTabs() {
  const container = document.getElementById('tracker-status-tabs');
  if (!container) return;

  const statuses = ['All', 'Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];

  container.innerHTML = statuses.map(status => {
    let count = 0;
    if (status === 'All') count = state.applications.length;
    else count = state.applications.filter(a => a.status === status).length;

    const isActive = state.trackerTab === status;
    return `
      <button id="tracker-tab-${status.toLowerCase()}" class="tracker-tab-btn ${isActive ? 'active' : ''}" role="tab" aria-selected="${isActive}" aria-controls="tracker-items-list" tabindex="${isActive ? '0' : '-1'}" data-tab="${status}">
        ${status} <span class="badge ${isActive ? 'badge-neutral' : 'badge-primary'}">${count}</span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.tracker-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.trackerTab = btn.dataset.tab;
      renderTrackerTabs();
      renderTrackerList();
      const selectedTab = document.getElementById(`tracker-tab-${state.trackerTab.toLowerCase()}`);
      if (selectedTab) selectedTab.focus();
    });

    btn.addEventListener('keydown', (event) => {
      const tabs = [...container.querySelectorAll('[role="tab"]')];
      const currentIndex = tabs.indexOf(btn);
      let nextIndex = currentIndex;

      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;

      event.preventDefault();
      state.trackerTab = tabs[nextIndex].dataset.tab;
      renderTrackerTabs();
      renderTrackerList();
      const selectedTab = document.getElementById(`tracker-tab-${state.trackerTab.toLowerCase()}`);
      if (selectedTab) selectedTab.focus();
    });
  });
}

function renderTrackerList() {
  const container = document.getElementById('tracker-items-list');
  if (!container) return;
  const activeTab = document.getElementById(`tracker-tab-${state.trackerTab.toLowerCase()}`);
  if (activeTab) container.setAttribute('aria-labelledby', activeTab.id);

  let filtered = state.applications;
  if (state.trackerTab !== 'All') {
    filtered = filtered.filter(a => a.status === state.trackerTab);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"/></svg>
        </div>
        <h3 class="empty-state-title">No applications in "${state.trackerTab}"</h3>
        <p class="empty-state-text">Browse the internship directory to bookmark internships or mark them as applied.</p>
        <button class="btn btn-primary" onclick="window.location.hash = '#internships'">Browse Internships</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(app => {
    const internship = rawInternships.find(i => i.id === app.internshipId);
    if (!internship) return '';

    const statuses = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
    const statusOptions = statuses.map(s => `
      <option value="${s}" ${app.status === s ? 'selected' : ''}>${s}</option>
    `).join('');

    return `
      <div class="tracker-item-card" data-app-id="${app.id}">
        <div class="tracker-item-header">
          <div class="flex items-center gap-3">
            <div class="company-logo" style="background-color: ${internship.logoBg}; color: ${internship.logoColor}">
              ${internship.company.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 style="font-size: 1.15rem; margin-bottom: 0.2rem;">${escapeHtml(internship.title)}</h3>
              <div class="text-muted" style="font-size: 0.85rem; font-weight: 600;">
                ${escapeHtml(internship.company)} • ${escapeHtml(internship.location)} • ${escapeHtml(internship.stipend)}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select class="form-select tracker-status-select" aria-label="Status for ${escapeHtml(internship.title)}" data-action="change-status" data-app-id="${escapeHtml(app.id)}">
              ${statusOptions}
            </select>
            <button class="btn btn-outline btn-sm" data-action="view-details" data-id="${internship.id}">
              View
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete-app" data-app-id="${escapeHtml(app.id)}" title="Delete application" aria-label="Delete ${escapeHtml(internship.title)}">
              ✕
            </button>
          </div>
        </div>

        <div class="tracker-dates-row">
          <div class="flex items-center gap-2">
            <label class="form-label" for="applied-date-${escapeHtml(app.id)}" style="margin-bottom: 0;">Applied Date:</label>
            <input id="applied-date-${escapeHtml(app.id)}" type="date" class="form-input form-input-sm" data-action="update-applied-date" data-app-id="${escapeHtml(app.id)}" value="${escapeHtml(app.appliedDate || '')}">
          </div>
          <div class="flex items-center gap-2">
            <label class="form-label" for="interview-date-${escapeHtml(app.id)}" style="margin-bottom: 0;">Interview Date:</label>
            <input id="interview-date-${escapeHtml(app.id)}" type="date" class="form-input form-input-sm" data-action="update-interview-date" data-app-id="${escapeHtml(app.id)}" value="${escapeHtml(app.interviewDate || '')}">
          </div>
        </div>

        <div class="tracker-notes-wrap">
          <label class="form-label" for="notes-${escapeHtml(app.id)}">Notes & Follow-ups</label>
          <textarea id="notes-${escapeHtml(app.id)}" class="form-textarea tracker-notes-textarea" data-action="update-notes" data-app-id="${escapeHtml(app.id)}" placeholder="Add interview prep notes, referral contacts, or next steps...">${escapeHtml(app.notes || '')}</textarea>
        </div>
      </div>
    `;
  }).join('');

  // Event handlers for tracker items
  container.querySelectorAll('[data-action="change-status"]').forEach(select => {
    select.addEventListener('change', (e) => {
      const appId = select.dataset.appId;
      updateApplicationStatus(appId, select.value);
    });
  });

  container.querySelectorAll('[data-action="update-applied-date"]').forEach(input => {
    input.addEventListener('change', () => {
      const appId = input.dataset.appId;
      updateApplicationDates(appId, 'appliedDate', input.value);
      showToast('Applied date updated', 'info', 1500);
    });
  });

  container.querySelectorAll('[data-action="update-interview-date"]').forEach(input => {
    input.addEventListener('change', () => {
      const appId = input.dataset.appId;
      updateApplicationDates(appId, 'interviewDate', input.value);
      showToast('Interview date updated', 'info', 1500);
    });
  });

  container.querySelectorAll('[data-action="update-notes"]').forEach(textarea => {
    textarea.addEventListener('input', debounce(() => {
      const appId = textarea.dataset.appId;
      updateApplicationNotes(appId, textarea.value);
    }, 400));
  });

  container.querySelectorAll('[data-action="delete-app"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const appId = btn.dataset.appId;
      if (confirm('Are you sure you want to delete this tracked application?')) {
        removeApplication(appId);
      }
    });
  });

  container.querySelectorAll('[data-action="view-details"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      showInternshipDetailModal(id, btn);
    });
  });
}

function exportTrackerData() {
  try {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state.applications, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `skillbridge_tracker_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Exported tracker data successfully!', 'success');
  } catch (err) {
    showToast('Failed to export data', 'danger');
  }
}

/**
 * Render Profile
 */
function renderProfile() {
  const profile = state.profile;
  const authNotice = document.getElementById('profile-auth-notice');
  if (authNotice) authNotice.hidden = state.authStatus !== 'guest';
  const avatarInitials = (profile.name || 'User')
    .split(' ')
    .map(p => p[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  // Header avatar & name sync
  const headerAvatar = document.getElementById('header-avatar');
  const headerName = document.getElementById('header-profile-name');
  if (headerAvatar) headerAvatar.textContent = avatarInitials;
  if (headerName) headerName.textContent = profile.name ? profile.name.split(' ')[0] : 'Profile';

  // Profile fields sync
  const nameInput = document.getElementById('profile-name-input');
  const headlineInput = document.getElementById('profile-headline-input');
  const emailInput = document.getElementById('profile-email-input');
  const phoneInput = document.getElementById('profile-phone-input');
  const locationInput = document.getElementById('profile-location-input');
  const bioInput = document.getElementById('profile-bio-input');

  if (nameInput) nameInput.value = profile.name || '';
  if (headlineInput) headlineInput.value = profile.headline || '';
  if (emailInput) emailInput.value = profile.email || '';
  if (phoneInput) phoneInput.value = profile.phone || '';
  if (locationInput) locationInput.value = profile.location || '';
  if (bioInput) bioInput.value = profile.bio || '';

  // Avatar in profile card
  const bigAvatar = document.getElementById('profile-big-avatar');
  if (bigAvatar) bigAvatar.textContent = avatarInitials;

  const cardName = document.getElementById('profile-card-name');
  const cardHeadline = document.getElementById('profile-card-headline');
  if (cardName) cardName.textContent = profile.name;
  if (cardHeadline) cardHeadline.textContent = profile.headline;

  // Learning progress
  const totalCourses = rawCourses.length;
  const completedCount = state.completedCourses.length;
  const progressPercent = Math.min(100, Math.round((completedCount / totalCourses) * 100));

  const progressPercentText = document.getElementById('profile-progress-percent');
  const progressBarFill = document.getElementById('profile-progress-fill');
  const progressSummaryText = document.getElementById('profile-progress-summary');

  if (progressPercentText) progressPercentText.textContent = `${progressPercent}%`;
  if (progressBarFill) progressBarFill.style.width = `${progressPercent}%`;
  if (progressSummaryText) progressSummaryText.textContent = `${completedCount} of ${totalCourses} recommended courses completed`;

  // Profile skills chips
  renderProfileSkills();
  renderProfileCompletedCoursesList();
  renderCertificateList('profile-certificates-list');
}

function renderMyLearning() {
  renderPathCards('my-learning-paths');
  renderCertificateList('learning-certificates-list');
  if (state.user) loadCertificates();
}

function renderCertificateList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!state.user && state.authStatus === 'loading') {
    container.innerHTML = '<p class="text-muted" role="status" aria-busy="true">Checking account status…</p>';
    return;
  }
  if (!state.user) {
    container.innerHTML = `<p class="text-muted">Certificates require an account and are issued only after server-verified steps and quiz results.</p>
      <button class="btn btn-primary btn-sm" type="button" data-auth-prompt="certificates">Sign in to use this</button>`;
    return;
  }
  if (!state.certificates.length) {
    container.innerHTML = '<p class="text-muted">No SkillBridge certificates yet. Complete a learning path and pass its final quiz to earn one.</p>';
    return;
  }
  container.innerHTML = state.certificates.map(certificate => {
    const verifyUrl = certificateVerificationUrl(certificate.certId);
    const valid = certificate.status === 'valid';
    const issueDate = new Date(certificate.issuedAt).toLocaleDateString();
    return `<article class="certificate-card">
      <div class="certificate-card-heading">
        <div><h3>${escapeHtml(certificate.pathTitle)}</h3><p>${escapeHtml(certificate.recipientName || 'Personal details removed')}</p></div>
        <span class="badge ${valid ? 'badge-success' : 'badge-neutral'}">${valid ? 'Valid' : 'Revoked'}</span>
      </div>
      <p class="text-muted">Issued ${escapeHtml(issueDate)} · ${certificate.score == null ? 'Score removed' : `${escapeHtml(String(certificate.score))}%`} · ${certificate.hours == null ? 'Hours removed' : `${escapeHtml(String(certificate.hours))} hours`}</p>
      <p><a href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener noreferrer">Certificate ID ${escapeHtml(certificate.certId)}</a></p>
      ${valid ? `<label class="certificate-score-toggle"><input type="checkbox" data-certificate-score="${escapeHtml(certificate.certId)}" ${certificate.showScorePublicly ? 'checked' : ''}> Show score on the public verification page</label>` : ''}
      <div class="card-actions">
        ${valid ? `<button type="button" class="btn btn-outline btn-sm" data-certificate-download-pdf="${escapeHtml(certificate.certId)}">Download PDF</button>
            <button type="button" class="btn btn-outline btn-sm" data-certificate-preview="${escapeHtml(certificate.certId)}">Preview certificate</button>
            <button type="button" class="btn btn-outline btn-sm" data-certificate-download-image="${escapeHtml(certificate.certId)}">Download image</button>
          <button type="button" class="btn btn-outline btn-sm" data-certificate-link="${escapeHtml(certificate.certId)}">Copy verification link</button>
          <button type="button" class="btn btn-outline btn-sm" data-certificate-linkedin="${escapeHtml(certificate.certId)}">Share on LinkedIn</button>
          <button type="button" class="btn btn-ghost btn-sm" data-certificate-add-profile="${escapeHtml(certificate.certId)}">Add to my profile</button>
          <button type="button" class="btn btn-ghost btn-sm" data-certificate-delete="${escapeHtml(certificate.certId)}">Delete my certificate</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderVerifyPage() {
  const input = document.getElementById('public-cert-id');
  if (input) input.value = state.verifyCertId;
  const result = document.getElementById('certificate-verification-result');
  if (result) result.textContent = '';
  if (state.verifyCertId) verifyCertificate(state.verifyCertId);
}

async function verifyCertificate(certId) {
  const result = document.getElementById('certificate-verification-result');
  if (!result) return;
  result.textContent = 'Checking certificate status…';
  try {
    const record = await certificateRequest(`/certificates/verify/${encodeURIComponent(certId)}`);
    if (record.status === 'not_found') {
      result.innerHTML = '<p class="badge badge-neutral">Not found</p><p>No certificate was found. Check the ID and try again.</p>';
      return;
    }
    const issued = record.issuedAt ? new Date(record.issuedAt).toLocaleDateString() : 'Date unavailable';
    const valid = record.status === 'valid';
    result.innerHTML = `<article class="card verification-card">
      <span class="badge ${valid ? 'badge-success' : 'badge-neutral'}">${valid ? 'Valid' : 'Revoked · not valid'}</span>
      ${record.recipientName ? `<h2>${escapeHtml(record.recipientName)}</h2>` : ''}
      ${record.pathTitle ? `<p>Learning path: <strong>${escapeHtml(record.pathTitle)}</strong></p>` : ''}
      <p>Issued ${escapeHtml(issued)} by ${escapeHtml(record.issuer || 'SkillBridge')}</p>
      ${Number.isFinite(record.score) ? `<p>Score: ${escapeHtml(String(record.score))}%</p>` : ''}
      <p class="certificate-disclaimer">This certificate shows completion of a SkillBridge learning path. It is not an accredited qualification.</p>
    </article>`;
  } catch (error) {
    result.textContent = error.message || 'Certificate verification is temporarily unavailable.';
  }
}

async function loadAdminCertificates() {
  const container = document.getElementById('admin-certificates-list');
  if (!container) return;
  container.textContent = 'Loading certificates…';
  try {
    const records = await certificateRequest('/admin/certificates');
    container.innerHTML = records.length ? records.map(record => `
      <article class="admin-certificate-row">
        <div><strong>${escapeHtml(record.recipientName || 'Personal details removed')}</strong>
          <span>${escapeHtml(record.pathTitle)} · ${escapeHtml(record.certId)} · ${escapeHtml(record.status)}</span></div>
        ${record.status === 'valid' ? `<button type="button" class="btn btn-ghost btn-sm" data-admin-revoke="${escapeHtml(record.certId)}">Revoke</button>` : ''}
      </article>`).join('') : '<p class="text-muted">No certificates found.</p>';
  } catch (error) {
    container.textContent = error.message;
  }
}

function openAdminRevokeModal(certId) {
  openModal(`<div class="modal-header"><div><h2 id="modal-title">Revoke certificate</h2><p class="text-muted">${escapeHtml(certId)}</p></div><button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close modal">&times;</button></div>
    <form id="admin-revoke-form" class="modal-body form-stack">
      <label class="form-label" for="admin-revoke-reason">Reason (required)</label>
      <textarea id="admin-revoke-reason" class="form-input" maxlength="240" rows="3" required></textarea>
      <button class="btn btn-primary" type="submit">Confirm revocation</button>
      <p id="admin-revoke-status" role="status" aria-live="polite"></p>
    </form>`);
  document.getElementById('admin-revoke-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const reason = document.getElementById('admin-revoke-reason').value.trim();
    if (!reason) return;
    const status = document.getElementById('admin-revoke-status');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await certificateRequest(`/admin/certificates/${encodeURIComponent(certId)}/revoke`, {
        method: 'POST', body: { reason }
      });
      closeModal();
      await loadAdminCertificates();
      showToast('Certificate revoked.', 'success');
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = false;
    }
  });
}

function initLearningPathHandlers() {
  document.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.pathWatch) {
      toggleVideoState('watchedVideos', target.dataset.pathWatch);
      return;
    }
    if (target.dataset.pathVideoOpen) {
      const video = internshipPrepVideos.find(item => item.id === target.dataset.pathVideoOpen);
      if (video) showVideoModal(video, target);
      return;
    }
    if (target.dataset.courseDeclare) {
      openCourseDeclaration(target.dataset.courseDeclare, target.dataset.courseId);
      return;
    }
    if (target.dataset.pathQuiz) {
      await startPathQuiz(target.dataset.pathQuiz, target);
      return;
    }
    if (target.dataset.pathIssue) {
      const path = state.learningPaths.find(item => item.id === target.dataset.pathIssue);
      const result = state.pathQuizResults[target.dataset.pathIssue];
      if (path && result?.passed) {
        renderQuizResult(path, {
          ...result,
          passed: true,
          passMark: path.passMark,
          results: []
        }, target);
      }
      return;
    }
    if (target.hasAttribute('data-quiz-sign-in')) {
      closeModal();
      showLoginModal();
      return;
    }
    const certId = target.dataset.certificateDownloadPdf
      || target.dataset.certificatePreview
      || target.dataset.certificateDownloadImage
      || target.dataset.certificateLink
      || target.dataset.certificateLinkedin
      || target.dataset.certificateAddProfile
      || target.dataset.certificateDelete
      || target.dataset.adminRevoke;
    if (!certId) return;
    const certificate = state.certificates.find(item => item.certId === certId);
    try {
      if (target.dataset.certificateDownloadPdf && certificate) {
        await downloadCertificatePdf(certificate);
      } else if (target.dataset.certificatePreview && certificate) {
        const previewUrl = await certificatePreviewDataUrl(certificate);
        openModal(`<div class="modal-header"><h2 id="modal-title">SkillBridge certificate preview</h2><button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close preview">&times;</button></div><div class="modal-body certificate-preview"></div>`, target);
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = `Preview of SkillBridge completion certificate for ${certificate.recipientName}`;
        document.querySelector('.certificate-preview')?.append(image);
      } else if (target.dataset.certificateDownloadImage && certificate) {
        await downloadCertificateImage(certificate);
      } else if (target.dataset.certificateLink) {
        await navigator.clipboard.writeText(certificateVerificationUrl(certId));
        showToast('Verification link copied.', 'success');
      } else if (target.dataset.certificateLinkedin && certificate) {
        shareCertificateOnLinkedIn(certificate);
      } else if (target.dataset.certificateAddProfile) {
        navigateTo('profile');
        document.querySelector('.profile-earned-certificates')?.scrollIntoView({ behavior: 'smooth' });
        showToast('Your earned certificates appear on your SkillBridge profile.', 'success');
      } else if (target.dataset.certificateDelete) {
        if (!window.confirm('Delete this certificate? It will be revoked and personal certificate data removed.')) return;
        await certificateRequest(`/certificates/${encodeURIComponent(certId)}`, { method: 'DELETE' });
        await loadCertificates();
        refreshLearningViews();
        showToast('Certificate deleted and revoked.', 'success');
      } else if (target.dataset.adminRevoke) {
        openAdminRevokeModal(certId);
      }
    } catch (error) {
      console.error('[Certificates] Certificate action failed.', error);
      showToast(error.message || 'Certificate action failed.', 'danger');
    }
  });

  document.addEventListener('change', async event => {
    const input = event.target.closest('[data-certificate-score]');
    if (!input) return;
    try {
      const updated = await certificateRequest(`/certificates/${encodeURIComponent(input.dataset.certificateScore)}/score-visibility`, {
        method: 'PATCH',
        body: { showScorePublicly: input.checked }
      });
      state.certificates = state.certificates.map(item => item.certId === updated.certId ? updated : item);
      renderCertificateList('learning-certificates-list');
      renderCertificateList('profile-certificates-list');
      showToast(input.checked ? 'Score is visible on the public verification page.' : 'Public score visibility disabled.', 'success');
    } catch (error) {
      input.checked = !input.checked;
      showToast(error.message, 'danger');
    }
  });

  [['learning-verify-form', 'learning-cert-id'], ['public-verify-form', 'public-cert-id']].forEach(([formId, inputId]) => {
    document.getElementById(formId)?.addEventListener('submit', event => {
      event.preventDefault();
      const certId = document.getElementById(inputId).value.trim().toUpperCase();
      state.verifyCertId = certId;
      if (formId === 'learning-verify-form') {
        navigateTo('verify');
        const verifyInput = document.getElementById('public-cert-id');
        if (verifyInput) verifyInput.value = certId;
      } else {
        verifyCertificate(certId);
      }
    });
  });
  document.getElementById('admin-load-certificates')?.addEventListener('click', loadAdminCertificates);
}

function renderPathCards(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!state.learningPaths.length) {
    container.innerHTML = '<p class="text-muted">Learning paths are unavailable. Reload the page while online.</p>';
    return;
  }
  container.innerHTML = state.learningPaths.map(path => {
    const requiredItems = path.items.filter(item => item.required);
    const completedItems = requiredItems.filter(item => isPathItemComplete(path, item));
    const quizPassed = state.pathQuizResults[path.id]?.passed === true;
    const progressTotal = requiredItems.length + 1;
    const progressPercent = Math.round(((completedItems.length + (quizPassed ? 1 : 0)) / progressTotal) * 100);
    const quizLabel = quizPassed ? `Quiz passed · ${state.pathQuizResults[path.id].score}%` : 'Final quiz not passed';
    const itemMarkup = path.items.map(item => {
      const done = isPathItemComplete(path, item);
      const name = learningPathItemName(item);
      if (item.type === 'video') {
        return `<li class="learning-path-step ${done ? 'is-complete' : ''}">
          <span>${escapeHtml(name)} <small>Video step</small></span>
          <div class="card-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-path-video-open="${escapeHtml(item.id)}">Open</button>
            <button type="button" class="btn btn-outline btn-sm" data-path-watch="${escapeHtml(item.id)}">${done ? 'Watched ✓' : 'Mark watched'}</button>
          </div>
        </li>`;
      }
      const course = rawCourses.find(record => record.id === item.id);
      const courseUrl = safeExternalUrl(course?.link);
      return `<li class="learning-path-step ${done ? 'is-complete' : ''}">
        <span>${escapeHtml(name)} <small>External course · self-declaration only</small></span>
        <div class="card-actions">
          ${courseUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(courseUrl)}" target="_blank" rel="noopener noreferrer">Open course</a>` : ''}
          <button type="button" class="btn btn-outline btn-sm" data-course-declare="${escapeHtml(path.id)}" data-course-id="${escapeHtml(item.id)}" ${done ? 'disabled' : ''}>${done ? 'Step recorded ✓' : 'I finished this course'}</button>
        </div>
      </li>`;
    }).join('');
    const canTakeQuiz = completedItems.length === requiredItems.length;
    return `<article class="learning-path-card">
      <div class="learning-path-card-heading">
        <div><span class="badge badge-primary">${escapeHtml(path.field)}</span><h2>${escapeHtml(path.title)}</h2></div>
        <span class="badge badge-neutral">${escapeHtml(path.level)}</span>
      </div>
      <p>${escapeHtml(path.description)}</p>
      <p class="text-muted">${escapeHtml(String(path.estimatedHours))} estimated hours · ${escapeHtml(String(path.items.length))} steps · ${escapeHtml(String(path.questionCount))} quiz questions</p>
      <div class="progress-bar-track" role="progressbar" aria-label="${escapeHtml(path.title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
        <div class="progress-bar-fill" style="width:${progressPercent}%"></div>
      </div>
      <p class="learning-path-progress-label" aria-live="polite">${completedItems.length} of ${requiredItems.length} steps complete · ${escapeHtml(quizLabel)}</p>
      <ul class="learning-path-steps">${itemMarkup}</ul>
      <div class="learning-path-card-footer">
        <span class="text-muted">Passing score: ${escapeHtml(String(path.passMark || DEFAULT_PATH_PASS_MARK))}%</span>
        <button type="button" class="btn btn-primary btn-sm" data-path-quiz="${escapeHtml(path.id)}" ${canTakeQuiz ? '' : 'disabled'}>${quizPassed ? 'Retake final quiz' : 'Take final quiz'}</button>
      </div>
      ${quizPassed && !state.certificates.some(item => item.pathId === path.id && item.status === 'valid')
        ? `<button type="button" class="btn btn-outline btn-sm" data-path-issue="${escapeHtml(path.id)}">Request certificate</button>` : ''}
    </article>`;
  }).join('');
}

function isPathItemComplete(path, item) {
  if (!item.required) return true;
  if (item.type === 'video') return state.watchedVideos.includes(item.id);
  return state.pathCourseDeclarations.some(declaration => (
    declaration.pathId === path.id && declaration.courseId === item.id
  ));
}

function learningPathItemName(item) {
  if (item.type === 'video') {
    return internshipPrepVideos.find(video => video.id === item.id)?.title || item.id;
  }
  return rawCourses.find(course => course.id === item.id)?.name || item.id;
}

async function syncGuestCourseDeclarations() {
  if (!state.user) return;
  for (const declaration of state.pathCourseDeclarations) {
    await certificateRequest(`/paths/${encodeURIComponent(declaration.pathId)}/course-declaration`, {
      method: 'POST',
      body: { courseId: declaration.courseId, note: declaration.note || '' }
    });
  }
}

async function loadServerLearningProgress() {
  const progress = await certificateRequest('/paths/progress');
  const declarations = new Map(state.pathCourseDeclarations.map(item => [
    `${item.pathId}:${item.courseId}`, item
  ]));
  progress.courseDeclarations.forEach(item => declarations.set(`${item.pathId}:${item.courseId}`, item));
  state.pathCourseDeclarations = [...declarations.values()];
  safeStorageSet(STORAGE_KEYS.PATH_COURSE_DECLARATIONS, state.pathCourseDeclarations);
  state.pathQuizResults = Object.fromEntries(progress.quizResults.map(item => [item.pathId, item]));
}

async function loadCertificates() {
  if (!state.user) {
    state.certificates = [];
    renderCertificateList('learning-certificates-list');
    renderCertificateList('profile-certificates-list');
    return;
  }
  try {
    state.certificates = await certificateRequest('/certificates/mine');
    renderCertificateList('learning-certificates-list');
    renderCertificateList('profile-certificates-list');
    renderPathCards('course-learning-paths');
    renderPathCards('video-learning-paths');
    renderPathCards('my-learning-paths');
  } catch (error) {
    console.error('[Certificates] Could not load the signed-in user certificates.', error);
    const message = 'Certificates could not be loaded from the server. Please try again.';
    ['learning-certificates-list', 'profile-certificates-list'].forEach(id => {
      const container = document.getElementById(id);
      if (container) container.textContent = message;
    });
  }
}

function openCourseDeclaration(pathId, courseId) {
  const courseName = learningPathItemName({ type: 'course', id: courseId });
  openModal(`<div class="modal-header"><div><h2 id="modal-title">Course step declaration</h2><p class="text-muted">${escapeHtml(courseName)}</p></div><button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close modal">&times;</button></div>
    <form id="course-declaration-form" class="modal-body form-stack">
      <p>This is a self-declaration step only. SkillBridge cannot verify completion of an external course and does not treat this as proof.</p>
      <label class="form-label" for="course-declaration-note">Optional note</label>
      <textarea id="course-declaration-note" class="form-input" maxlength="240" rows="3" aria-describedby="course-declaration-help"></textarea>
      <small id="course-declaration-help" class="text-muted">Maximum 240 characters. Do not include sensitive information.</small>
      <button class="btn btn-primary" type="submit">Record this step</button>
      <p id="course-declaration-status" role="status" aria-live="polite"></p>
    </form>`);
  document.getElementById('course-declaration-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const note = document.getElementById('course-declaration-note').value.trim();
    if (note.length > 240) return;
    try {
      if (state.user) {
        await certificateRequest(`/paths/${encodeURIComponent(pathId)}/course-declaration`, {
          method: 'POST', body: { courseId, note }
        });
      }
      state.pathCourseDeclarations = state.pathCourseDeclarations.filter(item => (
        item.pathId !== pathId || item.courseId !== courseId
      ));
      state.pathCourseDeclarations.push({ pathId, courseId, note });
      safeStorageSet(STORAGE_KEYS.PATH_COURSE_DECLARATIONS, state.pathCourseDeclarations);
      closeModal();
      refreshLearningViews();
      showToast('Course step recorded as a self-declaration.', 'success');
    } catch (error) {
      const status = document.getElementById('course-declaration-status');
      if (status) status.textContent = error.message;
    }
  });
}

async function startPathQuiz(pathId, triggerElement) {
  const path = state.learningPaths.find(item => item.id === pathId);
  if (!path) return;
  try {
    const body = state.user ? {} : {
      guestSessionId: getGuestLearningSessionId(),
      watchedVideoIds: state.watchedVideos,
      declaredCourseIds: state.pathCourseDeclarations
        .filter(item => item.pathId === pathId)
        .map(item => item.courseId)
    };
    const attempt = await certificateRequest(`/paths/${encodeURIComponent(pathId)}/quiz/start`, {
      method: 'POST', body
    });
    const questionFields = attempt.questions.map((question, index) => `
      <fieldset class="quiz-question">
        <legend>${index + 1}. ${escapeHtml(question.prompt)}</legend>
        ${question.options.map(option => `<label class="quiz-option"><input type="radio" name="question-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}" required><span>${escapeHtml(option.text)}</span></label>`).join('')}
      </fieldset>`).join('');
    openModal(`<div class="modal-header"><div><h2 id="modal-title">${escapeHtml(path.title)} · Final quiz</h2><p class="text-muted">${attempt.questions.length} questions · Pass mark ${escapeHtml(String(attempt.passMark))}%</p></div><button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close quiz">&times;</button></div>
      <form id="path-quiz-form" class="modal-body form-stack">
        <p>Question and option order are randomized. Correct answers and explanations appear only after submission.</p>
        ${questionFields}
        <button class="btn btn-primary" type="submit">Submit final quiz</button>
        <p id="path-quiz-status" role="status" aria-live="polite"></p>
      </form>`, triggerElement);
    const form = document.getElementById('path-quiz-form');
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const answers = Object.fromEntries(attempt.questions.map(question => {
        const selected = form.querySelector(`input[name="question-${CSS.escape(question.id)}"]:checked`);
        return [question.id, selected?.value || ''];
      }));
      try {
        const result = await certificateRequest(`/paths/${encodeURIComponent(pathId)}/quiz/submit`, {
          method: 'POST',
          body: {
            attemptId: attempt.attemptId,
            answers,
            ...(state.user ? {} : { guestSessionId: getGuestLearningSessionId() })
          }
        });
        state.pathQuizResults[pathId] = {
          pathId,
          passed: result.passed,
          score: result.score,
          submittedAt: new Date().toISOString()
        };
        if (!state.user) safeStorageSet(STORAGE_KEYS.PATH_QUIZ_RESULTS, state.pathQuizResults);
        if (state.user) {
          try {
            await loadServerLearningProgress();
          } catch (error) {
            console.error('[Learning paths] The quiz was graded but progress could not be refreshed.', error);
            showToast('Your quiz result was saved, but progress could not be refreshed. Reload to try again.', 'warning');
          }
        }
        renderQuizResult(path, result, triggerElement);
        refreshLearningViews();
      } catch (error) {
        const status = document.getElementById('path-quiz-status');
        if (status) status.textContent = error.message;
        submit.disabled = false;
      }
    });
  } catch (error) {
    showToast(error.message, 'warning');
  }
}

function renderQuizResult(path, result, triggerElement) {
  const explanationHtml = result.results.map((item, index) => `
    <article class="quiz-explanation">
      <h3>${index + 1}. ${escapeHtml(item.isCorrect ? 'Correct' : 'Review this answer')}</h3>
      <p><strong>Answer:</strong> ${escapeHtml(item.correctAnswer)}</p>
      <p>${escapeHtml(item.explanation)}</p>
      <p class="text-muted">${item.topicTags.map(escapeHtml).join(' · ')}</p>
    </article>`).join('');
  const issueForm = result.passed && state.user ? `<form id="certificate-issue-form" class="certificate-issue-form">
    <label class="form-label" for="certificate-recipient-name">Name on certificate</label>
    <input id="certificate-recipient-name" class="form-input" maxlength="100" required value="${escapeHtml(state.profile.name || '')}">
    <small class="text-muted">This name must match your saved profile and may be changed once before your first certificate is issued.</small>
    <label class="certificate-consent"><input type="checkbox" id="certificate-public-consent" required>
      I consent to displaying my name and path title on the public verification page.
    </label>
    <p class="certificate-disclaimer">This certificate shows completion of a SkillBridge learning path. It is not an accredited qualification.</p>
    <button class="btn btn-primary" type="submit">Issue SkillBridge certificate</button>
    <p id="certificate-issue-status" role="status" aria-live="polite"></p>
  </form>` : result.passed
    ? '<div class="certificate-issue-form"><p>Sign in to transfer this server-graded quiz result and issue a certificate.</p><button class="btn btn-primary" type="button" data-quiz-sign-in>Sign in to issue</button></div>'
    : '<p class="text-muted">You can take another attempt when ready. A maximum of 3 attempts is allowed in 24 hours.</p>';
  openModal(`<div class="modal-header"><div><h2 id="modal-title">${result.passed ? 'Quiz passed' : 'Keep practicing'}</h2><p class="text-muted">${escapeHtml(path.title)} · Score ${escapeHtml(String(result.score))}% · Pass mark ${escapeHtml(String(result.passMark))}%</p></div><button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close results">&times;</button></div>
    <div class="modal-body"><p class="${result.passed ? 'badge badge-success' : 'badge badge-neutral'}">${result.passed ? 'Passed' : 'Not passed yet'}</p>
      <h3>Answer explanations</h3>${explanationHtml}${issueForm}</div>`, triggerElement);
  document.getElementById('certificate-issue-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const nameInput = document.getElementById('certificate-recipient-name');
    const consent = document.getElementById('certificate-public-consent');
    const status = document.getElementById('certificate-issue-status');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (!nameInput.reportValidity() || !consent.checked) return;
    submit.disabled = true;
    try {
      await certificateRequest('/certificates/recipient-name', {
        method: 'POST', body: { name: nameInput.value.trim() }
      });
      const certificate = await certificateRequest('/certificates/issue', {
        method: 'POST', body: { pathId: path.id, consent: true }
      });
      state.certificates = [...state.certificates.filter(item => item.certId !== certificate.certId), certificate];
      closeModal();
      renderMyLearning();
      renderProfile();
      showToast('Your SkillBridge certificate has been issued.', 'success');
    } catch (error) {
      if (status) status.textContent = error.message;
      submit.disabled = false;
    }
  });
}

function refreshLearningViews() {
  renderPathCards('course-learning-paths');
  renderPathCards('video-learning-paths');
  renderPathCards('my-learning-paths');
}

function renderProfileSkills() {
  const container = document.getElementById('profile-skills-list');
  if (!container) return;

  const skills = state.profile.skills || [];
  container.innerHTML = skills.map(skill => `
    <span class="chip active">
      ${escapeHtml(skill)}
      <span class="chip-remove" data-remove-skill="${escapeHtml(skill)}" title="Remove skill">✕</span>
    </span>
  `).join('');

  container.querySelectorAll('[data-remove-skill]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const toRemove = btn.dataset.removeSkill;
      state.profile.skills = state.profile.skills.filter(s => s !== toRemove);
      safeStorageSet(STORAGE_KEYS.PROFILE, state.profile);
      renderProfileSkills();
      showToast(`Removed ${toRemove}`, 'info');
    });
  });
}

function renderProfileCompletedCoursesList() {
  const container = document.getElementById('profile-completed-courses-list');
  if (!container) return;

  const completed = rawCourses.filter(c => state.completedCourses.includes(c.id));

  if (completed.length === 0) {
    container.innerHTML = `<p class="text-muted" style="font-size: 0.9rem;">No courses marked completed yet. Explore the Courses tab to get started!</p>`;
    return;
  }

  container.innerHTML = completed.map(course => `
    <div class="suggested-course-mini">
      <div>
        <strong>${escapeHtml(course.name)}</strong>
        <span class="text-muted" style="font-size: 0.75rem;">(${escapeHtml(course.provider)} • ${escapeHtml(course.duration)})</span>
      </div>
      <button class="btn btn-outline btn-sm" data-action="uncomplete-course" data-id="${course.id}" title="Remove from completed">
        Remove
      </button>
    </div>
  `).join('');

  container.querySelectorAll('[data-action="uncomplete-course"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      toggleCourseCompletion(id, false);
    });
  });
}

function saveProfileFromForm() {
  const name = document.getElementById('profile-name-input').value.trim();
  const headline = document.getElementById('profile-headline-input').value.trim();
  const email = document.getElementById('profile-email-input').value.trim();
  const phone = document.getElementById('profile-phone-input').value.trim();
  const location = document.getElementById('profile-location-input').value.trim();
  const bio = document.getElementById('profile-bio-input').value.trim();

  state.profile.name = name || 'Student';
  state.profile.headline = headline;
  state.profile.email = email;
  state.profile.phone = phone;
  state.profile.location = location;
  state.profile.bio = bio;

  safeStorageSet(STORAGE_KEYS.PROFILE, state.profile);
  renderProfile();
  if (state.user) {
    saveUserProfile(state.user.uid, state.profile).then(() => {
      showToast('Profile updated successfully!', 'success');
    }).catch(error => {
      console.error('[Profile] Could not sync profile to Firebase.', error);
      showToast('Profile saved in this browser, but could not be synced to your account.', 'warning');
    });
  } else {
    showToast('Profile updated successfully!', 'success');
  }
}

/**
 * Internship Detail Modal
 */
function showInternshipDetailModal(internshipId, triggerElement) {
  const item = rawInternships.find(i => i.id === internshipId);
  if (!item) return;

  const isSaved = isInternshipSaved(item.id);
  const skills = Array.isArray(item.skills) ? item.skills : [];
  const matchInfo = calculateInternshipMatch(skills, state.selectedSkills);
  const sourceUrl = safeExternalUrl(item.sourceUrl || item.source);
  const applyUrl = safeExternalUrl(item.applyLink);

  const skillsHtml = skills.map(skill => {
    const isMatched = matchInfo.matched.some(m => m.toLowerCase() === skill.toLowerCase());
    return `<span class="skill-tag ${isMatched ? 'matched' : ''}">${isMatched ? '✓ ' : ''}${escapeHtml(skill)}</span>`;
  }).join('');
  const renderListSection = (title, items) => Array.isArray(items) && items.length
    ? `<h4 style="margin-bottom: 0.5rem;">${title}</h4>
       <ul style="margin-left: 1.25rem; margin-bottom: 1.25rem; color: var(--text-secondary); line-height: 1.6;">
         ${items.map(value => `<li>${escapeHtml(value)}</li>`).join('')}
       </ul>`
    : '';

  const modalHtml = `
    <div class="modal-header">
      <div class="flex items-center gap-3">
        <div class="company-logo" style="background-color: ${escapeHtml(item.logoBg || '#e0e7ff')}; color: ${escapeHtml(item.logoColor || '#3730a3')}">
          ${escapeHtml((item.company || '').substring(0, 2).toUpperCase())}
        </div>
        <div>
          <h2 id="modal-title" style="font-size: 1.35rem; margin-bottom: 0.2rem;">${escapeHtml(item.title)}</h2>
          <div class="text-muted" style="font-size: 0.95rem; font-weight: 600;">
            ${escapeHtml(item.company)} • ${escapeHtml(item.location)}
          </div>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close modal" style="font-size: 1.5rem; line-height: 1;">&times;</button>
    </div>

    <div class="modal-body">
      <div class="card-meta-list" style="margin-bottom: 1.25rem;">
        <span class="badge badge-success">${escapeHtml(item.mode)}</span>
        <span class="badge badge-primary">${escapeHtml(item.duration)}</span>
        <span class="badge badge-neutral">Stipend: ${escapeHtml(item.stipend)}</span>
        <span class="badge badge-warning">Deadline: ${escapeHtml(item.isDemo ? 'Demo only - no real deadline' : item.deadline || 'Rolling / Check site')}</span>
      </div>
      <p class="verification-label">${item.isDemo ? '<span class="badge badge-warning badge-demo">Demo data</span>' : hasVerificationEvidence(item) ? `Verified · Last checked ${escapeHtml(item.lastVerified)}` : 'Check official site'}${sourceUrl && !item.isDemo ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source</a>` : ''}</p>

      <h4 style="margin-bottom: 0.5rem;">About the Role</h4>
      <p style="margin-bottom: 1.25rem;">${escapeHtml(item.description)}</p>

      ${renderListSection('Key Responsibilities', item.responsibilities)}
      ${renderListSection('Requirements', item.requirements)}

      <h4 style="margin-bottom: 0.5rem;">Required Skills (${matchInfo.score}% match with your profile)</h4>
      <div class="skills-tag-wrap" style="margin-bottom: 1.25rem;">
        ${skillsHtml}
      </div>

      ${renderListSection('Perks & Benefits', item.perks)}

      <h4 style="margin: 1.25rem 0 0.5rem;">Prepare for this internship</h4>
      <div class="internship-video-recommendations">
        ${getVideosForInternship(item, internshipPrepVideos).map(video => `
          <article class="internship-video-recommendation">
            <strong>${escapeHtml(video.title)}</strong>
            <span class="text-muted">${escapeHtml(video.topic)}</span>
            <a href="${escapeHtml(safeExternalUrl(video.url) || 'https://www.youtube.com/')}" target="_blank" rel="noopener noreferrer">${video.verified === true ? 'Watch on YouTube' : 'Search on YouTube'} ↗</a>
          </article>`).join('') || '<p class="text-muted">Browse Video Classes for general internship preparation tips.</p>'}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn ${isSaved ? 'btn-danger' : 'btn-outline'}" id="modal-save-btn" data-id="${escapeHtml(item.id)}">
        ${isSaved ? 'Remove from Tracker' : 'Bookmark / Track'}
      </button>
      ${applyUrl
        ? `<button class="btn btn-primary" id="modal-apply-btn" data-id="${escapeHtml(item.id)}">Check official site ↗</button>`
        : `<span class="btn btn-secondary" aria-disabled="true">${item.isDemo ? 'Demo only - no application link' : 'Check official site'}</span>`}
    </div>
  `;

  openModal(modalHtml, triggerElement);

  // Attach modal action listeners
  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      toggleSaveInternship(item.id);
      closeModal();
    });
  }

  const applyBtn = document.getElementById('modal-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      handleQuickApply(item.id, applyBtn);
      closeModal();
    });
  }
}

/**
 * Course Detail / Syllabus Modal
 */
function showCourseDetailModal(courseId, triggerElement) {
  const course = rawCourses.find(c => c.id === courseId);
  if (!course) return;

  const isCompleted = state.completedCourses.includes(course.id);
  const skillsHtml = (course.skillsCovered || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('');
  const courseUrl = safeExternalUrl(course.link);

  const modalHtml = `
    <div class="modal-header">
      <div>
        <div class="flex items-center gap-2" style="margin-bottom: 0.4rem;">
          <span class="badge ${course.isFree ? 'badge-success' : 'badge-primary'}">${escapeHtml(course.price)}</span>
          <span class="badge badge-neutral">${escapeHtml(course.level)}</span>
        </div>
        <h2 id="modal-title" style="font-size: 1.35rem; line-height: 1.3;">${escapeHtml(course.name)}</h2>
        <div class="text-muted" style="font-size: 0.9rem; font-weight: 600; margin-top: 0.2rem;">
          ${escapeHtml(course.provider)} • ${escapeHtml(course.duration)}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close modal" style="font-size: 1.5rem; line-height: 1;">&times;</button>
    </div>

    <div class="modal-body">
      <h4 style="margin-bottom: 0.5rem;">Course Overview</h4>
      <p style="margin-bottom: 1.25rem;">${escapeHtml(course.description)}</p>

      <h4 style="margin-bottom: 0.5rem;">Curriculum & Topics Covered</h4>
      <ol style="margin-left: 1.25rem; margin-bottom: 1.25rem; color: var(--text-secondary); line-height: 1.6;">
        ${(course.syllabus || []).map(topic => `<li>${escapeHtml(topic)}</li>`).join('')}
      </ol>

      <h4 style="margin-bottom: 0.5rem;">Skills You Will Master</h4>
      <div class="skills-tag-wrap" style="margin-bottom: 1.25rem;">
        ${skillsHtml}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-course-complete-btn">
        ${isCompleted ? 'Mark as In-Progress' : 'Mark as Completed ✓'}
      </button>
      ${courseUrl
        ? `<a href="${escapeHtml(courseUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Official course site ↗</a>`
        : '<span class="btn btn-secondary" aria-disabled="true">Check official site</span>'}
    </div>
  `;

  openModal(modalHtml, triggerElement);

  const completeBtn = document.getElementById('modal-course-complete-btn');
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      toggleCourseCompletion(course.id, !isCompleted);
      closeModal();
    });
  }
}

function toggleVideoState(key, id) {
  const collection = state[key];
  const index = collection.indexOf(id);
  if (index >= 0) collection.splice(index, 1);
  else collection.push(id);
  const storageKey = key === 'watchedVideos' ? STORAGE_KEYS.WATCHED_VIDEOS : STORAGE_KEYS.SAVED_VIDEOS;
  safeStorageSet(storageKey, collection);
  if (key === 'watchedVideos' && state.user) {
    updateWatchedVideo(state.user.uid, id, index < 0, collection).catch(error => {
      console.error('[Videos] Could not sync watched state to the signed-in account.', error);
      showToast('Watched progress could not be synced. It remains saved in this browser.', 'warning');
    });
  }
  renderVideos();
  refreshLearningViews();
}

function showVideoModal(video, triggerElement) {
  const isVerifiedVideo = video.verified === true && /^[\w-]{11}$/.test(video.videoId || '');
  const searchUrl = safeExternalUrl(video.url);
  const safeUrl = isVerifiedVideo
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`
    : searchUrl?.startsWith('https://www.youtube.com/results?') ? searchUrl : 'https://www.youtube.com/';
  const offlineMessage = navigator.onLine
    ? 'If playback is unavailable or embedding is blocked, use the YouTube link below.'
    : 'You appear to be offline. Reconnect to the internet to watch this video.';
  const playerContent = !navigator.onLine
    ? `<p class="video-search-notice">${offlineMessage}</p>`
    : isVerifiedVideo
      ? `<iframe class="video-player-frame" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}" title="${escapeHtml(video.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe><p class="video-search-notice">${offlineMessage}</p>`
      : `<p class="video-search-notice">This entry is a YouTube search link, not a verified video. Choose a result from YouTube; no video is embedded here. ${offlineMessage}</p>`;
  const modalHtml = `
    <div class="modal-header">
      <div><h2 id="modal-title">${escapeHtml(video.title)}</h2><p class="text-muted">${escapeHtml(video.topic)} · ${escapeHtml(video.language)}</p></div>
      <button class="btn btn-ghost btn-sm" data-close-modal aria-label="Close modal">&times;</button>
    </div>
    <div class="modal-body">
      <p>${escapeHtml(video.description)}</p>
      ${playerContent}
    </div>
    <div class="modal-footer">
      <a class="btn btn-primary" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${isVerifiedVideo ? 'Watch on YouTube ↗' : 'Search on YouTube ↗'}</a>
      <button class="btn btn-outline" id="modal-video-watched">${state.watchedVideos.includes(video.id) ? 'Mark as not watched' : 'Mark as watched'}</button>
    </div>`;
  openModal(modalHtml, triggerElement);
  document.getElementById('modal-video-watched')?.addEventListener('click', () => {
    toggleVideoState('watchedVideos', video.id);
    closeModal();
    showToast('Video progress updated', 'success');
  });
}

function renderVideos() {
  const topicContainer = document.getElementById('video-topic-chips');
  const list = document.getElementById('video-classes-list');
  const learningPath = document.getElementById('video-learning-path-list');
  if (!topicContainer || !list || !learningPath) return;
  renderPathCards('video-learning-paths');

  topicContainer.innerHTML = ['all', ...VIDEO_TOPICS].map(topic => `
    <button type="button" class="video-topic-chip ${state.videoTopic === topic ? 'active' : ''}" data-video-topic="${escapeHtml(topic)}" aria-pressed="${state.videoTopic === topic}">
      ${topic === 'all' ? 'All topics' : escapeHtml(topic)}
    </button>`).join('');

  const pathVideos = VIDEO_LEARNING_PATH.map(id => internshipPrepVideos.find(video => video.id === id)).filter(Boolean);
  const progress = getLearningPathProgress(VIDEO_LEARNING_PATH, state.watchedVideos);
  const progressFill = document.getElementById('video-path-progress');
  const progressTrack = progressFill?.parentElement;
  if (progressFill) progressFill.style.width = `${progress.percent}%`;
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(progress.percent));
  const progressLabel = document.getElementById('video-path-progress-label');
  if (progressLabel) progressLabel.textContent = `${progress.completed} of ${progress.total} watched`;
  learningPath.innerHTML = pathVideos.map((video, index) => `
    <article class="video-path-item">
      <span class="video-path-step">${index + 1}</span>
      <div><h3>${escapeHtml(video.title)}</h3><span class="text-muted">${escapeHtml(video.topic)}</span></div>
      <button class="btn btn-outline btn-sm" type="button" data-video-open="${escapeHtml(video.id)}">Explore</button>
    </article>`).join('');

  const selectedTab = state.videoCategory === 'Skills' ? 'video-tab-skills' : 'video-tab-prep';
  const isSkillsTab = state.videoCategory === 'Skills';
  const pathSection = document.querySelector('.video-learning-path');
  if (pathSection) pathSection.hidden = isSkillsTab;
  const certificatePaths = document.querySelector('#video-learning-paths')?.closest('.learning-paths-embed');
  if (certificatePaths) certificatePaths.hidden = isSkillsTab;
  topicContainer.hidden = isSkillsTab;
  document.querySelectorAll('.video-category-tab').forEach(tab => {
    const active = tab.id === selectedTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  const panel = document.getElementById('video-class-panel');
  if (panel) panel.setAttribute('aria-labelledby', selectedTab);

  const filtered = filterVideos(internshipPrepVideos, {
    category: state.videoCategory,
    topic: state.videoTopic,
    language: state.videoLanguage,
    level: state.videoLevel,
    duration: state.videoDuration,
    search: state.videoSearch
  });
  const count = document.getElementById('video-result-count');
  if (count) count.textContent = `${filtered.length} class${filtered.length === 1 ? '' : 'es'} found`;
  const emptyMessage = state.videoCategory === 'Skills'
    ? 'The static edition does not include a separate skills-video catalog yet. Browse Skills & Courses for the existing learning catalog.'
    : 'Try a different search or filter.';
  list.innerHTML = filtered.length ? filtered.map(video => {
    const watched = state.watchedVideos.includes(video.id);
    const saved = state.savedVideos.includes(video.id);
    return `<article class="video-class-card">
      ${video.verified === true && /^[\w-]{11}$/.test(video.videoId || '')
        ? `<img class="video-thumbnail" src="https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg" alt="" loading="lazy" data-video-thumbnail="${escapeHtml(video.id)}">`
        : '<div class="video-thumbnail video-thumbnail-placeholder" aria-hidden="true">YouTube class</div>'}
      <div class="video-class-card-top"><span class="badge badge-primary">${escapeHtml(video.topic)}</span><span class="badge badge-neutral">${escapeHtml(video.level)}</span></div>
      <h2>${escapeHtml(video.title)}</h2><p class="video-class-description">${escapeHtml(video.description)}</p>
      <p class="text-muted">${escapeHtml(video.language)} · ${escapeHtml(video.durationLabel)} · ${escapeHtml(video.type)}</p>
      <div class="video-class-actions">
        <button type="button" class="btn btn-primary btn-sm" data-video-open="${escapeHtml(video.id)}">${video.verified === true && /^[\w-]{11}$/.test(video.videoId || '') ? 'Watch video' : 'Search on YouTube'}</button>
        <button type="button" class="btn btn-outline btn-sm" data-video-watch="${escapeHtml(video.id)}">${watched ? 'Watched ✓' : 'Mark as watched'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-video-save="${escapeHtml(video.id)}">${saved ? 'Saved ✓' : 'Save for later'}</button>
      </div>
    </article>`;
  }).join('') : `<div class="empty-state"><h3>No classes found</h3><p>${escapeHtml(emptyMessage)}</p></div>`;

  list.querySelectorAll('[data-video-thumbnail]').forEach(image => {
    image.addEventListener('error', () => {
      const placeholder = document.createElement('div');
      placeholder.className = 'video-thumbnail video-thumbnail-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'Thumbnail unavailable';
      image.replaceWith(placeholder);
    }, { once: true });
  });

  list.querySelectorAll('[data-video-open]').forEach(button => {
    button.addEventListener('click', () => {
      const video = internshipPrepVideos.find(item => item.id === button.dataset.videoOpen);
      if (video) showVideoModal(video, button);
    });
  });
  list.querySelectorAll('[data-video-watch]').forEach(button => {
    button.addEventListener('click', () => toggleVideoState('watchedVideos', button.dataset.videoWatch));
  });
  list.querySelectorAll('[data-video-save]').forEach(button => {
    button.addEventListener('click', () => toggleVideoState('savedVideos', button.dataset.videoSave));
  });
  learningPath.querySelectorAll('[data-video-open]').forEach(button => {
    button.addEventListener('click', () => {
      const video = internshipPrepVideos.find(item => item.id === button.dataset.videoOpen);
      if (video) showVideoModal(video, button);
    });
  });
  topicContainer.querySelectorAll('[data-video-topic]').forEach(button => {
    button.addEventListener('click', () => {
      state.videoTopic = button.dataset.videoTopic;
      renderVideos();
    });
  });
}

/* ==========================================================================
   11. ROUTER & EVENT HANDLERS
   ========================================================================== */
function navigateTo(route) {
  closeMoreMenus();
  if (route === 'admin' && state.authStatus === 'loading') return;
  if (route === 'admin' && (!state.user || !state.isAdmin)) {
    showLoginModal({
      initialError: state.user
        ? 'Your signed-in account does not have administrator access.'
        : 'Sign in to use the admin area.'
    });
    route = 'home';
  }
  state.currentRoute = route;
  window.location.hash = `#${route}`;

  // Hide all sections, show active
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeSection = document.getElementById(`view-${route}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Update navigation links
  document.querySelectorAll('.nav-link, .bottom-nav-item, .nav-more-menu a').forEach(link => {
    if (link.dataset.route === route) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Render view-specific data
  if (route === 'home') {
    renderHome();
  } else if (route === 'internships') {
    renderInternships();
  } else if (route === 'companies') {
    renderCompanies();
  } else if (route === 'admin') {
    renderAdmin();
    if (state.isAdmin) loadAdminCertificates();
  } else if (route === 'courses') {
    renderCourses();
  } else if (route === 'videos') {
    renderVideos();
  } else if (route === 'my-learning') {
    renderMyLearning();
  } else if (route === 'verify') {
    renderVerifyPage();
  } else if (route === 'skill-gap') {
    renderSkillGap();
  } else if (route === 'tracker') {
    renderTracker();
  } else if (route === 'profile') {
    renderProfile();
    if (state.user) loadCertificates();
  } else if (route === 'ai-guidance') {
    renderAiGuidance(state.profile, state.user);
  } else if (route === 'resume-analyser') {
    renderResumeAnalyser(state.user);
  }
}

function closeMoreMenus() {
  document.querySelectorAll('[data-more-menu]').forEach(menu => {
    menu.hidden = true;
    menu.parentElement?.querySelector('[data-more-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

function hydrateInternshipFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const filters = state.internshipFilters;
  const field = params.get('field');
  const selectedState = params.get('state');
  const selectedCity = params.get('city');
  const mode = params.get('mode');
  const duration = params.get('duration');
  const paid = params.get('paid');
  const stipend = params.get('stipend');
  const companyType = params.get('type');
  const eligibility = params.get('eligibility');
  const sort = params.get('sort');
  if (params.get('demo') === 'true') {
    state.showDemoData = true;
    safeStorageSet(STORAGE_KEYS.SHOW_DEMO_DATA, true);
  }
  if (FIELDS.includes(field)) filters.field = field;
  if (INDIAN_STATES.includes(selectedState)) filters.state = selectedState;
  if ((CITIES_BY_STATE[filters.state] || []).includes(selectedCity)
    || (filters.state === 'all' && Object.values(CITIES_BY_STATE).flat().includes(selectedCity))) {
    filters.location = selectedCity;
  }
  if (MODES.includes(mode)) filters.mode = mode;
  if (DURATIONS.map(String).includes(duration)) filters.duration = duration;
  if (['paid', 'unpaid', 'unknown'].includes(paid)) filters.compensation = paid;
  if (STIPEND_RANGES.some(range => range.id === stipend)) filters.stipendRange = stipend;
  if (COMPANY_TYPES.includes(companyType)) filters.companyType = companyType;
  if (ELIGIBILITY.includes(eligibility)) filters.eligibility = eligibility;
  filters.verifiedOnly = params.get('verified') === 'true';
  filters.deadlineSoon = params.get('deadlineSoon') === 'true';
  if (['relevance', 'newest', 'deadline', 'stipend'].includes(sort)) filters.sort = sort;
}

function initRouter() {
  hydrateInternshipFiltersFromUrl();
  const directVerification = window.location.pathname.match(/^\/verify\/([^/]+)\/?$/);
  if (directVerification) {
    try {
      state.verifyCertId = decodeURIComponent(directVerification[1]);
    } catch {
      state.verifyCertId = '';
    }
  }
  const hash = window.location.hash.replace('#', '') || (directVerification ? 'verify' : 'home');
  const validRoutes = ['home', 'internships', 'companies', 'courses', 'videos', 'my-learning', 'verify', 'skill-gap', 'tracker', 'profile', 'admin', 'ai-guidance', 'resume-analyser'];
  const initialRoute = validRoutes.includes(hash) ? hash : 'home';
  navigateTo(initialRoute);

  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash.replace('#', '');
    if (validRoutes.includes(newHash) && newHash !== state.currentRoute) {
      navigateTo(newHash);
    }
  });

  // Navigation clicks
  document.querySelectorAll('[data-route]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const targetRoute = el.dataset.route;
      navigateTo(targetRoute);
    });
  });

  document.querySelectorAll('[data-more-toggle]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const menu = button.parentElement.querySelector('[data-more-menu]');
      const opening = menu.hidden;
      closeMoreMenus();
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (opening) menu.querySelector('a')?.focus();
    });
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.nav-more')) closeMoreMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const openMenu = [...document.querySelectorAll('[data-more-menu]')].find(menu => !menu.hidden);
      if (openMenu) {
        closeMoreMenus();
        openMenu.parentElement?.querySelector('[data-more-toggle]')?.focus();
      }
    }
  });
}

function initEventHandlers() {
  initLearningPathHandlers();
  initCompanyFilters();
  syncDemoDataControls();
  ['home-include-demo', 'filter-include-demo', 'company-include-demo']
    .forEach(id => {
      document.getElementById(id)?.addEventListener('change', event => {
        setShowDemoData(event.target.checked);
      });
    });
  document.addEventListener('click', event => {
    const prompt = event.target.closest('[data-auth-prompt]');
    if (!prompt) return;
    showLoginModal({
      initialError: `Sign in to use ${prompt.dataset.authPrompt}.`,
      triggerElement: prompt
    });
  });
  document.getElementById('ai-skill-gap-note')?.addEventListener('click', event => {
    const button = event.target.closest('[data-ai-skill-add]');
    if (button) addCustomSkill(button.dataset.aiSkillAdd);
  });
  document.getElementById('auth-action-btn')?.addEventListener('click', async event => {
    if (state.authStatus === 'loading') return;
    if (!state.user) {
      showLoginModal({ triggerElement: event.currentTarget });
      return;
    }
    try {
      await signOutUser();
      clearGuestMode();
      if (state.currentRoute === 'admin') navigateTo('home');
    } catch (error) {
      logAuthError(error);
      showToast(getAuthErrorMessage(error), 'danger');
    }
  });

  document.getElementById('admin-load-company')?.addEventListener('click', async () => {
    await loadAdminRecord(companiesService, 'admin-company-select', 'admin-company-json');
  });
  document.getElementById('admin-load-internship')?.addEventListener('click', async () => {
    await loadAdminRecord(internshipsService, 'admin-internship-select', 'admin-internship-json');
  });
  document.getElementById('admin-company-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    await saveAdminRecord('admin-company-json', record => saveCompany(state.user.uid, record));
  });
  document.getElementById('admin-internship-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    await saveAdminRecord('admin-internship-json', record => saveInternship(state.user.uid, record));
  });
  document.getElementById('admin-delete-company')?.addEventListener('click', async () => {
    const id = document.getElementById('admin-company-select')?.value;
    await deleteAdminRecord(() => deleteCompany(state.user.uid, id), 'Company');
  });
  document.getElementById('admin-delete-internship')?.addEventListener('click', async () => {
    const id = document.getElementById('admin-internship-select')?.value;
    await deleteAdminRecord(() => deleteInternship(state.user.uid, id), 'Internship');
  });

  const companySearch = document.getElementById('company-search-input');
  companySearch?.addEventListener('input', debounce(renderCompanies, 200));
  document.getElementById('companies-list')?.addEventListener('click', event => {
    const detailsButton = event.target.closest('[data-company-details]');
    if (detailsButton) {
      showCompanyDetailModal(detailsButton.dataset.companyDetails, detailsButton);
      return;
    }
    const button = event.target.closest('[data-company-filter]');
    if (!button) return;
    state.internshipFilters.search = button.dataset.companyFilter;
    navigateTo('internships');
    const searchInput = document.getElementById('internship-search-input');
    if (searchInput) searchInput.value = state.internshipFilters.search;
    renderInternships();
  });

  const videoTabs = document.querySelector('.video-category-tabs');
  if (videoTabs) {
    videoTabs.innerHTML = VIDEO_CATEGORIES.map(category => {
      const id = category === 'Internship Prep' ? 'video-tab-prep' : 'video-tab-skills';
      const active = state.videoCategory === category;
      return `<button type="button" class="video-category-tab${active ? ' active' : ''}" id="${id}" role="tab" aria-selected="${active}" aria-controls="video-class-panel" data-video-category="${escapeHtml(category)}" tabindex="${active ? '0' : '-1'}">${escapeHtml(category)}</button>`;
    }).join('');
  }
  document.querySelectorAll('.video-category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.videoCategory = tab.dataset.videoCategory;
      state.videoTopic = 'all';
      renderVideos();
    });
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('.video-category-tab')];
      const currentIndex = tabs.indexOf(tab);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
    tab.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const tabs = [...document.querySelectorAll('.video-category-tab')];
        const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      }
    });
  });

  const videoSearch = document.getElementById('video-search');
  videoSearch?.addEventListener('input', debounce(() => {
    state.videoSearch = videoSearch.value.trim();
    renderVideos();
  }, 250));
  [
    ['video-language-filter', 'videoLanguage'],
    ['video-level-filter', 'videoLevel'],
    ['video-duration-filter', 'videoDuration']
  ].forEach(([id, key]) => {
    const select = document.getElementById(id);
    if (id === 'video-language-filter' && select) {
      select.innerHTML = ['<option value="all">All languages</option>',
        ...VIDEO_LANGUAGES.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      ].join('');
    }
    if (id === 'video-level-filter' && select) {
      select.innerHTML = ['<option value="all">All levels</option>',
        ...VIDEO_LEVELS.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      ].join('');
    }
    if (id === 'video-duration-filter' && select) {
      const durationLabels = {
        all: 'All durations',
        'under-10': 'Under 10 minutes',
        '10-30': '10–30 minutes',
        'over-30': 'Over 30 minutes',
        varies: 'Not listed'
      };
      select.innerHTML = VIDEO_DURATION_FILTERS.map(value =>
        `<option value="${escapeHtml(value)}">${escapeHtml(durationLabels[value])}</option>`
      ).join('');
    }
    select?.addEventListener('change', () => {
      state[key] = select.value;
      renderVideos();
    });
  });

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle-btn');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Global modal overlay click to close
  const overlay = document.getElementById('global-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  // Hero Search input
  const heroSearchInput = document.getElementById('hero-search-input');
  if (heroSearchInput) {
    heroSearchInput.value = state.internshipFilters.search;
    heroSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = heroSearchInput.value.trim();
        state.internshipFilters.search = query;
        navigateTo('internships');
        const dirSearch = document.getElementById('internship-search-input');
        if (dirSearch) dirSearch.value = query;
        renderInternships();
      }
    });
  }

  // Hero Search button
  const heroSearchBtn = document.getElementById('hero-search-btn');
  if (heroSearchBtn) {
    heroSearchBtn.addEventListener('click', () => {
      const query = heroSearchInput.value.trim();
      state.internshipFilters.search = query;
      navigateTo('internships');
      const dirSearch = document.getElementById('internship-search-input');
      if (dirSearch) dirSearch.value = query;
      renderInternships();
    });
  }

  // Internships filter inputs
  const dirSearchInput = document.getElementById('internship-search-input');
  if (dirSearchInput) {
    dirSearchInput.value = state.internshipFilters.search;
    dirSearchInput.addEventListener('input', debounce((e) => {
      state.internshipFilters.search = e.target.value.trim();
      renderInternships();
    }, 250));
  }

  const filterField = document.getElementById('filter-field');
  if (filterField) {
    filterField.innerHTML = rawCategories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    filterField.value = state.internshipFilters.field;
    filterField.addEventListener('change', (e) => {
      state.internshipFilters.field = e.target.value;
      renderInternships();
    });
  }

  const filterState = document.getElementById('filter-state');
  const filterLocation = document.getElementById('filter-location');
  const updateCityOptions = () => {
    if (!filterLocation) return;
    const cities = state.internshipFilters.state === 'all'
      ? [...new Set(Object.values(CITIES_BY_STATE).flat())].sort()
      : CITIES_BY_STATE[state.internshipFilters.state] || [];
    filterLocation.innerHTML = [
      '<option value="all">All Cities</option>',
      ...cities.map(city => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`)
    ].join('');
    filterLocation.value = cities.includes(state.internshipFilters.location)
      ? state.internshipFilters.location
      : 'all';
  };
  if (filterState) {
    filterState.innerHTML = [
      '<option value="all">All States</option>',
      ...INDIAN_STATES.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    ].join('');
    filterState.value = state.internshipFilters.state;
    filterState.addEventListener('change', event => {
      state.internshipFilters.state = event.target.value;
      state.internshipFilters.location = 'all';
      updateCityOptions();
      renderInternships();
    });
  }
  updateCityOptions();
  if (filterLocation) {
    filterLocation.value = state.internshipFilters.location;
    filterLocation.addEventListener('change', (e) => {
      state.internshipFilters.location = e.target.value;
      renderInternships();
    });
  }

  const filterMode = document.getElementById('filter-mode');
  if (filterMode) {
    filterMode.innerHTML = [
      '<option value="all">All Modes</option>',
      ...MODES.map(mode => `<option value="${escapeHtml(mode)}">${escapeHtml(mode)}</option>`)
    ].join('');
    filterMode.value = state.internshipFilters.mode;
    filterMode.addEventListener('change', (e) => {
      state.internshipFilters.mode = e.target.value;
      renderInternships();
    });
  }

  const filterComp = document.getElementById('filter-comp');
  if (filterComp) {
    filterComp.innerHTML = [
      '<option value="all">All stipend statuses</option>',
      ...PAID_STATUS.map(value => `<option value="${value}">${value === 'paid' ? 'Paid' : value === 'unpaid' ? 'Unpaid' : 'Not specified'}</option>`)
    ].join('');
    filterComp.value = state.internshipFilters.compensation;
    filterComp.addEventListener('change', (e) => {
      state.internshipFilters.compensation = e.target.value;
      renderInternships();
    });
  }

  const filterDuration = document.getElementById('filter-duration');
  if (filterDuration) {
    filterDuration.innerHTML = [
      '<option value="all">Any Duration</option>',
      ...DURATIONS.map(months => `<option value="${months}">${months} months</option>`)
    ].join('');
    filterDuration.value = state.internshipFilters.duration;
    filterDuration.addEventListener('change', (e) => {
      state.internshipFilters.duration = e.target.value;
      renderInternships();
    });
  }

  const filterStipendRange = document.getElementById('filter-stipend-range');
  if (filterStipendRange) {
    filterStipendRange.innerHTML = [
      '<option value="all">Any stipend</option>',
      ...STIPEND_RANGES.map(range => `<option value="${escapeHtml(range.id)}">${escapeHtml(range.label)}</option>`)
    ].join('');
    filterStipendRange.value = state.internshipFilters.stipendRange;
    filterStipendRange.addEventListener('change', event => {
      state.internshipFilters.stipendRange = event.target.value;
      renderInternships();
    });
  }

  const filterCompanyType = document.getElementById('filter-company-type');
  if (filterCompanyType) {
    filterCompanyType.innerHTML = [
      '<option value="all">All types</option>',
      ...COMPANY_TYPES.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    ].join('');
    filterCompanyType.value = state.internshipFilters.companyType;
    filterCompanyType.addEventListener('change', event => {
      state.internshipFilters.companyType = event.target.value;
      renderInternships();
    });
  }

  const filterEligibility = document.getElementById('filter-eligibility');
  if (filterEligibility) {
    filterEligibility.innerHTML = [
      '<option value="all">All eligibility</option>',
      ...ELIGIBILITY.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    ].join('');
    filterEligibility.value = state.internshipFilters.eligibility;
    filterEligibility.addEventListener('change', event => {
      state.internshipFilters.eligibility = event.target.value;
      renderInternships();
    });
  }

  const filterVerified = document.getElementById('filter-verified');
  if (filterVerified) {
    filterVerified.checked = state.internshipFilters.verifiedOnly;
    filterVerified.addEventListener('change', event => {
      state.internshipFilters.verifiedOnly = event.target.checked;
      renderInternships();
    });
  }

  const filterDeadline = document.getElementById('filter-deadline-soon');
  if (filterDeadline) {
    filterDeadline.checked = state.internshipFilters.deadlineSoon;
    filterDeadline.addEventListener('change', event => {
      state.internshipFilters.deadlineSoon = event.target.checked;
      renderInternships();
    });
  }

  const filterSort = document.getElementById('filter-sort');
  if (filterSort) {
    const sortLabels = {
      relevance: 'Relevance',
      newest: 'Newest First',
      deadline: 'Deadline Closing Soon',
      stipend: 'Highest Stipend'
    };
    filterSort.innerHTML = INTERNSHIP_SORTS.map(value =>
      `<option value="${value}">${sortLabels[value]}</option>`
    ).join('');
    filterSort.value = state.internshipFilters.sort;
    filterSort.addEventListener('change', (e) => {
      state.internshipFilters.sort = e.target.value;
      renderInternships();
    });
  }

  const clearFiltersBtn = document.getElementById('btn-clear-filters');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', resetInternshipFilters);
  }

  // Courses filter inputs
  const courseSearchInput = document.getElementById('course-search-input');
  if (courseSearchInput) {
    courseSearchInput.addEventListener('input', debounce((e) => {
      state.courseFilters.search = e.target.value.trim();
      renderCourses();
    }, 250));
  }

  const courseCatSelect = document.getElementById('filter-course-category');
  if (courseCatSelect) {
    const courseCats = ['all', ...COURSE_CATEGORIES];
    courseCatSelect.innerHTML = courseCats.map(cat => `
      <option value="${cat}">${cat === 'all' ? 'All Categories' : cat}</option>
    `).join('');
    courseCatSelect.addEventListener('change', (e) => {
      state.courseFilters.category = e.target.value;
      renderCourses();
    });
  }

  const courseLvlSelect = document.getElementById('filter-course-level');
  if (courseLvlSelect) {
    courseLvlSelect.innerHTML = ['<option value="all">All Levels</option>',
      ...COURSE_LEVELS.map(value => `<option value="${value.toLowerCase()}">${escapeHtml(value)}</option>`)
    ].join('');
    courseLvlSelect.addEventListener('change', (e) => {
      state.courseFilters.level = e.target.value;
      renderCourses();
    });
  }

  const coursePriceSelect = document.getElementById('filter-course-price');
  if (coursePriceSelect) {
    coursePriceSelect.innerHTML = [
      '<option value="all">Free & Paid</option>',
      ...COURSE_PRICING.map(value => `<option value="${value}">${value === 'free' ? 'Free Courses' : 'Paid / Certificate'}</option>`)
    ].join('');
    coursePriceSelect.addEventListener('change', (e) => {
      state.courseFilters.price = e.target.value;
      renderCourses();
    });
  }

  // Custom skill input form
  const customSkillForm = document.getElementById('custom-skill-form');
  const customSkillInput = document.getElementById('custom-skill-input');
  if (customSkillForm && customSkillInput) {
    customSkillForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addCustomSkill(customSkillInput.value);
      customSkillInput.value = '';
    });
  }

  const btnSyncSkills = document.getElementById('btn-sync-profile-skills');
  if (btnSyncSkills) {
    btnSyncSkills.addEventListener('click', syncSkillsFromProfile);
  }

  const btnClearSkills = document.getElementById('btn-clear-selected-skills');
  if (btnClearSkills) {
    btnClearSkills.addEventListener('click', () => {
      state.selectedSkills = [];
      safeStorageSet(STORAGE_KEYS.SELECTED_SKILLS, []);
      renderSkillSelectorCloud();
      renderSkillGapResults();
      showToast('Cleared all selected skills', 'info');
    });
  }

  // Tracker Export
  const btnExportTracker = document.getElementById('btn-export-tracker');
  if (btnExportTracker) {
    btnExportTracker.addEventListener('click', exportTrackerData);
  }

  // Profile Save Form
  const profileForm = document.getElementById('profile-edit-form');
  if (profileForm) {
    profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveProfileFromForm();
    });
  }

  // Profile Add Skill
  const profileAddSkillForm = document.getElementById('profile-add-skill-form');
  const profileAddSkillInput = document.getElementById('profile-add-skill-input');
  if (profileAddSkillForm && profileAddSkillInput) {
    profileAddSkillForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = profileAddSkillInput.value.trim();
      if (!val) return;
      if (!state.profile.skills) state.profile.skills = [];
      if (!state.profile.skills.includes(val)) {
        state.profile.skills.push(val);
        safeStorageSet(STORAGE_KEYS.PROFILE, state.profile);
        renderProfileSkills();
        showToast(`Added ${val} to profile`, 'success');
      }
      profileAddSkillInput.value = '';
    });
  }
}

/* ==========================================================================
   12. PWA SERVICE WORKER REGISTRATION
   ========================================================================== */
function registerServiceWorker() {
  if (import.meta.env.DEV) {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .then(() => caches.keys())
        .then(cacheNames => Promise.all(
          cacheNames.filter(name => name.startsWith('skillbridge-')).map(name => caches.delete(name))
        ))
        .catch(error => console.warn('[PWA] Development service worker cleanup failed:', error));
    }
    return;
  }

  const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  if ('serviceWorker' in navigator && isHttp) {
    navigator.serviceWorker.register('./service-worker.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  }
}

/* ==========================================================================
   13. INITIALIZATION
   ========================================================================== */
async function initializeApplication() {
  try {
    await loadLearningPaths();
  } catch (error) {
    console.error('[Learning] Learning path data is invalid.', error);
    showToast('Learning path data could not be loaded.', 'danger');
  }
  try {
    const response = await fetch('./data/seed/videos.json');
    if (!response.ok) throw new Error(`Video catalog request failed: ${response.status}`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new TypeError('Video catalog must be a JSON array');
    allVideos = records;
    internshipPrepVideos = records.filter(video =>
      video && typeof video.id === 'string' &&
      typeof video.title === 'string' &&
      typeof video.url === 'string' &&
      video.category === 'Internship Prep'
    );
    if (internshipPrepVideos.length !== records.length) {
      console.warn('[Videos] Some invalid catalog records were omitted.');
    }
  } catch (error) {
    console.error('[Videos] Could not load the video catalog.', error);
    showToast('Video classes could not be loaded. Please reload while online.', 'danger');
  }
  await loadCatalogs();
  initTheme();
  updateBadges();
  initializeAiPages();
  initRouter();
  initEventHandlers();
  await initializeAuth();
  registerServiceWorker();
  console.log('[SkillBridge] App successfully loaded with', rawInternships.length, 'internships and', rawCourses.length, 'courses.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApplication, { once: true });
} else {
  void initializeApplication();
}
