import {
  CITIES_BY_STATE,
  COMPANY_TYPES,
  DURATIONS,
  ELIGIBILITY,
  FIELDS,
  INDIAN_STATES,
  MODES
} from '../constants.js';
import { db, firestoreApi, isFirebaseConfigured } from './firebase.js';

function requireFirestore() {
  if (!isFirebaseConfigured() || !db) throw new Error('Firebase is not configured.');
  return firestoreApi;
}

function ensureRequired(record, keys) {
  return keys.filter(key => !(key in record)).map(key => `Missing ${key}`);
}

function isUrl(value) {
  if (value == null) return true;
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateCompany(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record must be a JSON object'];
  const errors = ensureRequired(record, [
    'id', 'name', 'sector', 'type', 'city', 'state', 'website',
    'careersUrl', 'logo', 'verified', 'lastVerified'
  ]);
  if (typeof record.id !== 'string' || !record.id.trim()) errors.push('id must be a non-empty string');
  if (typeof record.name !== 'string' || !record.name.trim()) errors.push('name must be a non-empty string');
  if (!COMPANY_TYPES.includes(record.type)) errors.push('type is not a supported company type');
  if (record.state != null && !INDIAN_STATES.includes(record.state)) errors.push('state is not in the supported state list');
  if (record.city != null && (!record.state || !CITIES_BY_STATE[record.state]?.includes(record.city))) {
    errors.push('city is not listed for the selected state');
  }
  if (!isUrl(record.website) || !isUrl(record.careersUrl) || !isUrl(record.logo)) errors.push('website, careersUrl, and logo must be valid HTTP(S) URLs or null');
  if (typeof record.verified !== 'boolean') errors.push('verified must be boolean');
  return errors;
}

export function validateInternship(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record must be a JSON object'];
  const errors = ensureRequired(record, [
    'id', 'title', 'companyId', 'companyName', 'field', 'skills', 'city', 'state',
    'mode', 'durationMonths', 'stipendMin', 'stipendMax', 'isPaid', 'eligibility',
    'companyType', 'applyUrl', 'source', 'verified', 'lastVerified', 'deadline',
    'description', 'searchTokens'
  ]);
  if (!FIELDS.includes(record.field)) errors.push('field is not a supported internship field');
  if (!COMPANY_TYPES.includes(record.companyType)) errors.push('companyType is not supported');
  if (!ELIGIBILITY.includes(record.eligibility)) errors.push('eligibility is not supported');
  if (!MODES.includes(record.mode)) errors.push('mode is not supported');
  if (record.durationMonths != null && !DURATIONS.includes(record.durationMonths)) errors.push('durationMonths is not supported');
  if (record.state != null && !INDIAN_STATES.includes(record.state)) errors.push('state is not supported');
  if (record.city != null && (!record.state || !CITIES_BY_STATE[record.state]?.includes(record.city))) {
    errors.push('city is not listed for the selected state');
  }
  if (record.stipendMin != null && typeof record.stipendMin !== 'number') errors.push('stipendMin must be a number or null');
  if (record.stipendMax != null && typeof record.stipendMax !== 'number') errors.push('stipendMax must be a number or null');
  if (record.stipendMin != null && record.stipendMax != null && record.stipendMin > record.stipendMax) {
    errors.push('stipendMin cannot exceed stipendMax');
  }
  if (record.isPaid != null && typeof record.isPaid !== 'boolean') errors.push('isPaid must be boolean or null');
  if (!Array.isArray(record.skills) || !Array.isArray(record.searchTokens)) errors.push('skills and searchTokens must be arrays');
  if (typeof record.verified !== 'boolean') errors.push('verified must be boolean');
  if (!isUrl(record.applyUrl) || !isUrl(record.source)) errors.push('applyUrl and source must be valid HTTP(S) URLs or null');
  if (record.deadline != null && Number.isNaN(Date.parse(record.deadline))) errors.push('deadline must be an ISO date or null');
  return errors;
}

export async function hasAdminAccess(uid) {
  const api = requireFirestore();
  if (!uid) return false;
  const snapshot = await api.getDoc(api.doc(db, 'admins', uid));
  return snapshot.exists();
}

export async function saveCompany(uid, record) {
  const errors = validateCompany(record);
  if (errors.length) throw new Error(errors.join('; '));
  const api = requireFirestore();
  if (!await hasAdminAccess(uid)) throw new Error('Admin access is required.');
  await api.setDoc(api.doc(db, 'companies', record.id), record, { merge: true });
}

export async function deleteCompany(uid, id) {
  const api = requireFirestore();
  if (!await hasAdminAccess(uid)) throw new Error('Admin access is required.');
  await api.deleteDoc(api.doc(db, 'companies', id));
}

export async function saveInternship(uid, record) {
  const errors = validateInternship(record);
  if (errors.length) throw new Error(errors.join('; '));
  const api = requireFirestore();
  if (!await hasAdminAccess(uid)) throw new Error('Admin access is required.');
  const company = await api.getDoc(api.doc(db, 'companies', record.companyId));
  if (!company.exists()) throw new Error('companyId does not refer to an existing organization.');
  const companyData = company.data();
  if (record.companyName !== companyData.name || record.companyType !== companyData.type) {
    throw new Error('companyName and companyType must match the linked company record.');
  }
  await api.setDoc(api.doc(db, 'internships', record.id), record, { merge: true });
}

export async function deleteInternship(uid, id) {
  const api = requireFirestore();
  if (!await hasAdminAccess(uid)) throw new Error('Admin access is required.');
  await api.deleteDoc(api.doc(db, 'internships', id));
}
