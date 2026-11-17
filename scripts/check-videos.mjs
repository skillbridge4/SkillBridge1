import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VIDEO_CATEGORIES,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  VIDEO_TOPICS
} from '../client/src/constants.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(root, 'data/seed/videos.json');
const reportPath = resolve(root, 'reports/video-report.json');
const records = JSON.parse(await readFile(catalogPath, 'utf8'));
if (!Array.isArray(records)) throw new TypeError('Video catalog must be an array');
const validCategories = new Set(VIDEO_CATEGORIES);
const validTopics = new Set(VIDEO_TOPICS);
const validLevels = new Set(VIDEO_LEVELS);
const validLanguages = new Set(VIDEO_LANGUAGES);
const errors = [];
const reports = new Array(records.length);
const ids = new Set();
let nextIndex = 0;

function validate(video, index) {
  const required = [
    'id', 'title', 'channel', 'category', 'topic', 'field', 'level', 'language',
    'durationLabel', 'type', 'skills', 'url', 'videoId', 'description',
    'verified', 'lastVerified'
  ];
  if (!video || typeof video !== 'object' || Array.isArray(video)) {
    errors.push(`${index}: video must be an object`);
    return;
  }
  for (const key of required) {
    if (!(key in video)) errors.push(`${video.id || index}: missing ${key}`);
  }
  for (const key of ['id', 'title', 'channel', 'topic', 'field', 'level', 'language', 'durationLabel', 'type', 'url', 'description', 'lastVerified']) {
    if (typeof video[key] !== 'string' || !video[key].trim()) errors.push(`${video.id || index}: invalid ${key}`);
  }
  if (typeof video.id === 'string') {
    if (ids.has(video.id)) errors.push(`Duplicate video id: ${video.id}`);
    ids.add(video.id);
  }
  if (!validCategories.has(video.category)) errors.push(`${video.id}: invalid category`);
  if (!validTopics.has(video.topic)) errors.push(`${video.id}: invalid topic`);
  if (!validLevels.has(video.level)) errors.push(`${video.id}: invalid level`);
  if (!validLanguages.has(video.language)) errors.push(`${video.id}: invalid language`);
  if (video.durationLabel !== 'Varies' && !/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(video.durationLabel)) {
    errors.push(`${video.id}: invalid durationLabel`);
  }
  if (!Array.isArray(video.skills)) errors.push(`${video.id}: skills must be an array`);
  if (!['Single video', 'Playlist', 'Full course'].includes(video.type)) errors.push(`${video.id}: invalid type`);
  if (typeof video.verified !== 'boolean') errors.push(`${video.id}: verified must be a boolean`);
  if (video.videoId) {
    if (!/^[\w-]{11}$/.test(video.videoId)
      || video.url !== `https://www.youtube.com/watch?v=${video.videoId}`
      || video.verified !== true) errors.push(`${video.id}: videoId and URL do not match`);
  } else if (video.verified !== false
    || typeof video.url !== 'string'
    || !video.url.startsWith('https://www.youtube.com/results?search_query=')) {
    errors.push(`${video.id}: entries without verified video IDs must be YouTube search links with verified:false`);
  }
}

async function checkVideo(video) {
  let lastError = 'oEmbed request failed';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`;
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const matches = result.title === video.title && result.author_name === video.channel;
      return {
        id: video.id,
        title: video.title,
        channel: video.channel,
        url: video.url,
        status: matches ? 'verified' : 'mismatch',
        returnedTitle: result.title,
        returnedChannel: result.author_name
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  return { id: video.id, title: video.title, channel: video.channel, url: video.url, status: 'unverified', reason: lastError };
}

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= records.length) return;
    const video = records[index];
    validate(video, index);
    if (!video || typeof video !== 'object' || Array.isArray(video)) {
      reports[index] = { id: null, status: 'unverified', reason: 'Invalid video record' };
    } else if (typeof video.videoId === 'string' && video.videoId) {
      reports[index] = await checkVideo(video);
      if (video.verified === true && reports[index].status !== 'verified') {
        errors.push(`${video.id}: verified video could not be matched by oEmbed`);
      }
    } else {
      reports[index] = {
        id: video.id,
        title: video.title,
        channel: video.channel,
        url: video.url,
        status: 'unverified',
        reason: 'YouTube search link; no video ID was supplied or verified'
      };
    }
  }
}

await Promise.all(Array.from({ length: Math.min(2, records.length) }, () => worker()));
await mkdir(dirname(reportPath), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  total: records.length,
  verified: reports.filter(item => item.status === 'verified').length,
  unverified: reports.filter(item => item.status !== 'verified').length,
  validationErrors: errors,
  videos: reports
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Video check: ${report.verified}/${report.total} oEmbed verified; ${report.unverified} unverified; ${errors.length} validation errors.`);
if (errors.length || reports.some(item => item.status === 'mismatch')) process.exitCode = 1;
