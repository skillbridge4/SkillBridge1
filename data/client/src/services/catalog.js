import { db, firestoreApi, isFirebaseConfigured } from './firebase.js';

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheKey(collectionName, filters, pageSize) {
  return JSON.stringify([collectionName, filters, pageSize]);
}

function queryConstraints(api, filters = {}) {
  return Object.entries(filters).map(([field, value]) => {
    if (value && typeof value === 'object' && 'op' in value) {
      return api.where(field, value.op, value.value);
    }
    return api.where(field, '==', value);
  });
}

export async function listCatalog(collectionName, {
  filters = {},
  pageSize = 50,
  cursor = null,
  sortBy = 'id',
  direction = 'asc'
} = {}) {
  if (!isFirebaseConfigured() || !db) {
    throw new Error('Firebase is not configured.');
  }
  const key = cacheKey(collectionName, { filters, pageSize, cursor: cursor?.id, sortBy, direction }, pageSize);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.value;

  const api = firestoreApi;
  const constraints = [
    ...queryConstraints(api, filters),
    api.orderBy(sortBy, direction),
    api.limit(Math.min(Math.max(pageSize, 1), 100))
  ];
  if (cursor) constraints.splice(constraints.length - 1, 0, api.startAfter(cursor));

  const snapshot = await api.getDocs(api.query(api.collection(db, collectionName), ...constraints));
  const result = {
    items: snapshot.docs.map(item => ({ id: item.id, ...item.data() })),
    cursor: snapshot.docs.at(-1) || null
  };
  cache.set(key, { value: result, createdAt: Date.now() });
  return result;
}

export async function getCatalogById(collectionName, id) {
  if (!isFirebaseConfigured() || !db) {
    throw new Error('Firebase is not configured.');
  }
  const snapshot = await firestoreApi.getDoc(firestoreApi.doc(db, collectionName, id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function createCatalogService(collectionName) {
  return {
    list: options => listCatalog(collectionName, options),
    getById: id => getCatalogById(collectionName, id),
    query: (filters, options = {}) => listCatalog(collectionName, { ...options, filters })
  };
}

export const companiesService = createCatalogService('companies');
export const internshipsService = createCatalogService('internships');
export const coursesService = createCatalogService('courses');
export const videosService = createCatalogService('videos');
