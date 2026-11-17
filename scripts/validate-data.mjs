import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  CITIES_BY_STATE,
  COMPANY_TYPES,
  COURSE_CATEGORIES,
  COURSE_LEVELS,
  DURATIONS,
  ELIGIBILITY,
  FIELDS,
  INDIAN_STATES,
  LEARNING_PATH_IDS,
  MODES,
  VIDEO_CATEGORIES,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  VIDEO_TOPICS
} from '../client/src/constants.js';
import { validatePaths } from '../server/certificate-utils.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const companies = JSON.parse(await readFile(resolve(root, 'data/seed/companies.json'), 'utf8'));
const internships = JSON.parse(await readFile(resolve(root, 'data/seed/internships.json'), 'utf8'));
const courses = JSON.parse(await readFile(resolve(root, 'data/seed/courses.json'), 'utf8'));
const videos = JSON.parse(await readFile(resolve(root, 'data/seed/videos.json'), 'utf8'));
const paths = JSON.parse(await readFile(resolve(root, 'data/seed/paths.json'), 'utf8'));
const publicPaths = JSON.parse(await readFile(resolve(root, 'public/learning-paths.json'), 'utf8'));
const errors = [];
const today = new Date().toISOString().slice(0, 10);
const requiredCompanyFields = [
  'id', 'name', 'sector', 'type', 'city', 'state', 'website', 'careersUrl',
  'logo', 'description', 'sourceUrl', 'verified', 'lastVerified', 'isDemo'
];
const requiredInternshipFields = [
  'id', 'title', 'companyId', 'companyName', 'field', 'skills', 'city', 'state',
  'mode', 'durationMonths', 'stipendMin', 'stipendMax', 'isPaid', 'eligibility',
  'companyType', 'applyUrl', 'source', 'sourceUrl', 'verified', 'lastVerified',
  'deadline', 'description', 'searchTokens', 'isDemo'
];
const companyIds = new Set();
const internshipIds = new Set();
const courseIds = new Set();
const videoIds = new Set();
const companyById = new Map();
const allowedTypes = new Set(COMPANY_TYPES);
const allowedFields = new Set(FIELDS);
const allowedModes = new Set(MODES);
const allowedDurations = new Set(DURATIONS);
const allowedEligibility = new Set(ELIGIBILITY);
const allowedStates = new Set(INDIAN_STATES);
const allowedCities = new Map(Object.entries(CITIES_BY_STATE));

errors.push(...validatePaths(paths, videos, courses));
const pathIds = new Set(paths.map(path => path.id));
if (pathIds.size !== paths.length) errors.push('Learning path IDs must be unique.');
if (paths.length < 6) errors.push('At least six learning paths are required.');
if (paths.length !== LEARNING_PATH_IDS.length
  || paths.some((path, index) => LEARNING_PATH_IDS[index] !== path.id)) {
  errors.push('Learning path IDs must match the shared constants in order.');
}
if (!Array.isArray(publicPaths)) {
  errors.push('Public learning path metadata must be an array.');
} else {
  if (publicPaths.length !== paths.length) errors.push('Public learning path metadata is out of sync.');
  paths.forEach((path, index) => {
    const { quiz, ...metadata } = path;
    const questionCount = Array.isArray(quiz?.questions) ? quiz.questions.length : null;
    const expectedPublicPath = { ...metadata, questionCount };
    if (!isDeepStrictEqual(publicPaths[index], expectedPublicPath)) {
      errors.push(`${path.id}: public learning path metadata is stale or contains private quiz data.`);
    }
  });
}

function validateRequired(record, fields, label) {
  for (const field of fields) {
    if (!(field in record)) errors.push(`${label}: missing required field ${field}`);
  }
}

function validateUrl(value, label) {
  if (value == null) return;
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label}: invalid URL ${value}`);
    return;
  }
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid protocol');
  } catch {
    errors.push(`${label}: invalid URL ${value}`);
  }
}

function validateId(record, ids, label) {
  if (typeof record.id !== 'string' || !record.id.trim()) {
    errors.push(`${label}: id must be a non-empty string`);
    return;
  }
  if (ids.has(record.id)) errors.push(`Duplicate ${label} id: ${record.id}`);
  ids.add(record.id);
}

function validateLocation(record, label) {
  if (record.state != null && !allowedStates.has(record.state)) {
    errors.push(`${label}: unknown state ${record.state}`);
  }
  if (record.city != null && record.state == null) {
    errors.push(`${label}: city is set without a state`);
  } else if (record.city != null
    && !allowedCities.get(record.state)?.includes(record.city)) {
    errors.push(`${label}: city ${record.city} is not listed for ${record.state}`);
  }
}

for (const company of companies) {
  validateRequired(company, requiredCompanyFields, company.id || 'company');
  validateId(company, companyIds, 'company');
  if (typeof company.id === 'string') companyById.set(company.id, company);
  if (company.type != null && !allowedTypes.has(company.type)) errors.push(`${company.id}: unknown company type ${company.type}`);
  if (typeof company.isDemo !== 'boolean') errors.push(`${company.id}: isDemo must be a boolean`);
  if (company.isDemo === true && company.verified === true) errors.push(`${company.id}: demo records cannot be verified`);
  if (company.verified === true && (!company.sourceUrl || !company.lastVerified)) {
    errors.push(`${company.id}: verified company must include sourceUrl and lastVerified`);
  }
  if (company.isDemo === true && (company.website || company.careersUrl || company.sourceUrl)) {
    errors.push(`${company.id}: demo companies cannot include real website or careers links`);
  }
  validateLocation(company, company.id);
  validateUrl(company.website, `${company.id}.website`);
  validateUrl(company.careersUrl, `${company.id}.careersUrl`);
  validateUrl(company.sourceUrl, `${company.id}.sourceUrl`);
}

for (const internship of internships) {
  validateRequired(internship, requiredInternshipFields, internship.id || 'internship');
  validateId(internship, internshipIds, 'internship');
  const company = companyById.get(internship.companyId);
  if (!company) {
    errors.push(`${internship.id}: orphan companyId ${internship.companyId}`);
  } else {
    if (internship.companyName !== company.name) {
      errors.push(`${internship.id}: companyName does not match ${internship.companyId}`);
    }
    if (internship.companyType != null && company.type != null
      && internship.companyType !== company.type) {
      errors.push(`${internship.id}: companyType does not match ${internship.companyId}`);
    }
  }
  if (internship.field != null && !allowedFields.has(internship.field)) errors.push(`${internship.id}: unknown field ${internship.field}`);
  if (internship.companyType != null && !allowedTypes.has(internship.companyType)) errors.push(`${internship.id}: unknown companyType ${internship.companyType}`);
  if (internship.mode != null && !allowedModes.has(internship.mode)) errors.push(`${internship.id}: unknown mode ${internship.mode}`);
  if (internship.eligibility != null && !allowedEligibility.has(internship.eligibility)) errors.push(`${internship.id}: unknown eligibility ${internship.eligibility}`);
  if (internship.durationMonths != null && !allowedDurations.has(internship.durationMonths)) {
    errors.push(`${internship.id}: unknown duration ${internship.durationMonths}`);
  }
  validateLocation(internship, internship.id);
  if (internship.stipendMin != null && internship.stipendMax != null
    && internship.stipendMin > internship.stipendMax) {
    errors.push(`${internship.id}: stipendMin exceeds stipendMax`);
  }
  if (internship.deadline != null) {
    const deadlineTime = Date.parse(internship.deadline);
    if (Number.isNaN(deadlineTime) || !/^\d{4}-\d{2}-\d{2}$/.test(internship.deadline)) {
      errors.push(`${internship.id}: invalid deadline ${internship.deadline}`);
    } else if (internship.deadline < today
      && (internship.open === true || internship.status === 'Open')) {
      errors.push(`${internship.id}: past deadline is marked open`);
    }
  }
  if (!Array.isArray(internship.skills)) errors.push(`${internship.id}: skills must be an array`);
  if (!Array.isArray(internship.searchTokens)) errors.push(`${internship.id}: searchTokens must be an array`);
  if (typeof internship.isDemo !== 'boolean') errors.push(`${internship.id}: isDemo must be a boolean`);
  if (typeof internship.verified !== 'boolean') errors.push(`${internship.id}: verified must be a boolean`);
  if (internship.verified === true && (!internship.sourceUrl || !internship.lastVerified)) {
    errors.push(`${internship.id}: verified record must include sourceUrl and lastVerified`);
  }
  if (internship.isDemo === true && internship.verified === true) {
    errors.push(`${internship.id}: demo records cannot be verified`);
  }
  if (internship.isDemo === true && (internship.applyUrl || internship.source || internship.sourceUrl)) {
    errors.push(`${internship.id}: demo internships cannot include application or source links`);
  }
  validateUrl(internship.applyUrl, `${internship.id}.applyUrl`);
  validateUrl(internship.source, `${internship.id}.source`);
  validateUrl(internship.sourceUrl, `${internship.id}.sourceUrl`);
}

for (const course of courses) {
  validateRequired(course, ['id', 'name', 'category', 'level', 'link', 'verified', 'lastVerified'], course.id || 'course');
  if (courseIds.has(course.id)) errors.push(`Duplicate course id: ${course.id}`);
  courseIds.add(course.id);
  if (!COURSE_CATEGORIES.includes(course.category)) errors.push(`${course.id}: unknown course category ${course.category}`);
  if (!COURSE_LEVELS.includes(course.level)) errors.push(`${course.id}: unknown course level ${course.level}`);
  validateUrl(course.link, `${course.id}.link`);
}

for (const video of videos) {
  validateRequired(video, [
    'id', 'title', 'channel', 'category', 'topic', 'field', 'level', 'language',
    'durationLabel', 'type', 'skills', 'url', 'videoId', 'description',
    'verified', 'lastVerified'
  ], video.id || 'video');
  if (videoIds.has(video.id)) errors.push(`Duplicate video id: ${video.id}`);
  videoIds.add(video.id);
  if (!VIDEO_CATEGORIES.includes(video.category)) errors.push(`${video.id}: unknown video category ${video.category}`);
  if (!VIDEO_TOPICS.includes(video.topic)) errors.push(`${video.id}: unknown video topic ${video.topic}`);
  if (!VIDEO_LEVELS.includes(video.level)) errors.push(`${video.id}: unknown video level ${video.level}`);
  if (!VIDEO_LANGUAGES.includes(video.language)) errors.push(`${video.id}: unknown video language ${video.language}`);
  if (!['Single video', 'Playlist', 'Full course'].includes(video.type)) {
    errors.push(`${video.id}: unknown video type ${video.type}`);
  }
  if (!Array.isArray(video.skills)) errors.push(`${video.id}: skills must be an array`);
  if (typeof video.verified !== 'boolean') errors.push(`${video.id}: verified must be a boolean`);
  if (video.durationLabel !== 'Varies' && !/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(video.durationLabel)) {
    errors.push(`${video.id}: durationLabel must be Varies or a time in mm:ss or h:mm:ss format`);
  }
  if (video.videoId !== null && typeof video.videoId !== 'string') {
    errors.push(`${video.id}: videoId must be a string or null`);
  }
  if (video.videoId && (!/^[\w-]{11}$/.test(video.videoId)
    || video.url !== `https://www.youtube.com/watch?v=${video.videoId}` || video.verified !== true)) {
    errors.push(`${video.id}: verified videoId and URL do not match`);
  }
  if (!video.videoId && (video.verified !== false
    || !video.url.startsWith('https://www.youtube.com/results?search_query='))) {
    errors.push(`${video.id}: unverified videos must use a YouTube search link`);
  }
  validateUrl(video.url, `${video.id}.url`);
}

if (errors.length) {
  console.error(`Data validation failed (${errors.length} errors):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Data validation passed: ${companies.length} organizations, ${internships.length} internships, ${courses.length} courses, ${videos.length} videos.`);
}
