import { SEARCH_ALIASES, STIPEND_RANGES } from '../constants.js';

export function normalizeSearchText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getSearchPhrases(record) {
  const fields = [
    record.title,
    record.companyName,
    record.company,
    record.companyType,
    record.field,
    record.city,
    record.state,
    ...(record.skills || []),
    ...(record.searchTokens || [])
  ];
  return normalizeSearchText(fields.filter(Boolean).join(' '));
}

function queryGroups(search) {
  const normalized = normalizeSearchText(search);
  if (!normalized) return [];
  const aliases = Object.entries(SEARCH_ALIASES)
    .map(([key, values]) => [normalizeSearchText(key), values.map(normalizeSearchText)]);
  const exactAlias = aliases.find(([key]) => key === normalized);
  if (exactAlias) return [[normalized, ...exactAlias[1]]];
  return normalized.split(' ').map(term => {
    const alias = aliases.find(([key]) => key === term);
    return [term, ...(alias?.[1] || [])];
  });
}

export function matchesSearch(record, search) {
  const groups = queryGroups(search);
  if (!groups.length) return true;
  const searchable = getSearchPhrases(record);
  return groups.every(group => group.some(phrase => searchable.includes(phrase)));
}

function isWithinStipendRange(record, rangeId) {
  const range = STIPEND_RANGES.find(item => item.id === rangeId);
  if (!range) return false;
  if (record.stipendMin == null && record.stipendMax == null) return false;
  const min = record.stipendMin ?? record.stipendMax;
  const max = record.stipendMax ?? record.stipendMin;
  return (range.max == null || min <= range.max) && max >= range.min;
}

function isDeadlineSoon(deadline, now) {
  if (!deadline) return false;
  const end = new Date(`${deadline}T23:59:59`);
  const start = new Date(now);
  return !Number.isNaN(end.getTime())
    && end >= start
    && end <= new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function filterInternships(records, filters = {}, now = new Date()) {
  const query = filters.q ?? filters.search ?? '';
  return records.filter(record => {
    if (!matchesSearch(record, query)) return false;
    if (filters.field && filters.field !== 'all' && record.field !== filters.field) return false;
    if (filters.state && filters.state !== 'all' && record.state !== filters.state) return false;
    if (filters.city && filters.city !== 'all' && record.city !== filters.city) return false;
    if (filters.mode && filters.mode !== 'all' && record.mode !== filters.mode) return false;
    if (filters.duration && filters.duration !== 'all'
      && String(record.durationMonths) !== String(filters.duration)) return false;
    if (filters.companyType && filters.companyType !== 'all'
      && record.companyType !== filters.companyType) return false;
    if (filters.eligibility && filters.eligibility !== 'all'
      && record.eligibility !== filters.eligibility) return false;
    if (filters.paid === 'paid' && record.isPaid !== true) return false;
    if (filters.paid === 'unpaid' && record.isPaid !== false) return false;
    if (filters.paid === 'unknown' && record.isPaid != null) return false;
    if (filters.stipendRange && filters.stipendRange !== 'all'
      && !isWithinStipendRange(record, filters.stipendRange)) return false;
    if (filters.verifiedOnly && record.verified !== true) return false;
    if (filters.deadlineSoon && !isDeadlineSoon(record.deadline, now)) return false;
    return true;
  });
}

function compareNullable(a, b, direction = 1) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a < b ? -1 : a > b ? 1 : 0) * direction;
}

export function sortInternships(records, sort = 'relevance', search = '') {
  const query = normalizeSearchText(search);
  return [...records].sort((a, b) => {
    if (sort === 'newest') return compareNullable(a.postedDate, b.postedDate, -1);
    if (sort === 'deadline') return compareNullable(a.deadline, b.deadline);
    if (sort === 'stipend') {
      return compareNullable(a.stipendMax ?? a.stipendMin, b.stipendMax ?? b.stipendMin, -1);
    }
    if (!query) return a.title.localeCompare(b.title);
    const aScore = query.split(' ').filter(term => getSearchPhrases(a).includes(term)).length;
    const bScore = query.split(' ').filter(term => getSearchPhrases(b).includes(term)).length;
    return bScore - aScore || a.title.localeCompare(b.title);
  });
}
