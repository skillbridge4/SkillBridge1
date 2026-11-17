import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  VIDEO_CATEGORIES,
  VIDEO_DURATION_FILTERS,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  VIDEO_TOPICS,
  filterVideos,
  getLearningPathProgress,
  getVideosForInternship
} from '../js/video-utils.js';

const videos = JSON.parse(await readFile(new URL('../data/seed/videos.json', import.meta.url), 'utf8'));

test('catalog records conform to the exposed category, topic, language, and level values', () => {
  assert.equal(videos.length, 128);
  assert.ok(videos.every(video => VIDEO_CATEGORIES.includes(video.category)));
  assert.ok(videos.every(video => VIDEO_TOPICS.includes(video.topic)));
  assert.ok(videos.every(video => VIDEO_LANGUAGES.includes(video.language)));
  assert.ok(videos.every(video => VIDEO_LEVELS.includes(video.level)));
  assert.ok(videos.every(video => Array.isArray(video.skills)));
  assert.ok(videos.every(video => ['Single video', 'Playlist', 'Full course'].includes(video.type)));
  assert.equal(new Set(videos.map(video => video.id)).size, videos.length);
  assert.equal(new Set(videos.map(video => video.title)).size, videos.length);
  assert.equal(new Set(videos.map(video => video.url)).size, videos.length);
  assert.deepEqual(VIDEO_DURATION_FILTERS, ['all', 'under-10', '10-30', 'over-30', 'varies']);
  assert.equal(videos.filter(video => video.verified).length, 48);
  assert.equal(videos.filter(video => !video.verified).length, 80);
});

test('48 new non-duplicate preparation entries cover all twelve topics', () => {
  const additions = videos.filter(video => {
    const index = Number(video.id.replace('prep-', ''));
    return index >= 81 && index <= 128;
  });
  assert.equal(additions.length, 48);
  assert.ok(additions.every(video => video.category === 'Internship Prep'));
  assert.deepEqual(new Set(additions.map(video => video.topic)), new Set(VIDEO_TOPICS));
  assert.ok(additions.every(video => video.verified === true && video.videoId));
  assert.ok(additions.every(video => video.url === `https://www.youtube.com/watch?v=${video.videoId}`));
  assert.ok(additions.every(video => video.durationLabel !== 'Varies'));
});

test('filters by category, topic, language, level, duration, and search aliases', () => {
  assert.equal(filterVideos(videos, { category: 'Internship Prep' }).length, 128);
  assert.ok(filterVideos(videos, { topic: 'Resume & CV' }).length > 0);
  assert.ok(filterVideos(videos, { language: 'Hindi' }).length > 0);
  assert.ok(filterVideos(videos, { level: 'Beginner' }).length > 0);
  assert.ok(filterVideos(videos, { level: 'Intermediate' }).length > 0);
  assert.equal(filterVideos(videos, { duration: 'varies' }).length, 80);
  assert.ok(filterVideos(videos, { duration: 'under-10' }).length > 0);
  assert.ok(filterVideos(videos, { duration: '10-30' }).length > 0);
  assert.ok(filterVideos(videos, { duration: 'over-30' }).length > 0);
  assert.ok(filterVideos(videos, { search: 'cv' }).some(video => video.topic === 'Resume & CV'));
  assert.ok(filterVideos(videos, { search: 'certificate' }).some(video => video.topic === 'Free certifications'));
  assert.ok(filterVideos(videos, { topic: 'DSA & coding tests', search: 'Java' }).length > 0);
});

test('learning-path progress handles partial, complete, and empty paths', () => {
  assert.deepEqual(getLearningPathProgress(['a', 'b', 'c'], ['b']), { completed: 1, total: 3, percent: 33 });
  assert.deepEqual(getLearningPathProgress(['a'], ['a']), { completed: 1, total: 1, percent: 100 });
  assert.deepEqual(getLearningPathProgress([], []), { completed: 0, total: 0, percent: 0 });
});

test('internship recommendations rank field and skill matches and respect limit', () => {
  const internship = { field: 'Software Engineering', skills: ['GitHub', 'README'] };
  const results = getVideosForInternship(internship, videos, 3);
  assert.ok(results.length > 0 && results.length <= 3);
  assert.ok(results.some(video => video.topic === 'GitHub & portfolio'));
});
