import {
  VIDEO_CATEGORIES,
  VIDEO_DURATION_FILTERS,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  VIDEO_TOPICS
} from '../client/src/constants.js';
import { matchesSearch } from '../client/src/services/search.js';

export { VIDEO_CATEGORIES, VIDEO_DURATION_FILTERS, VIDEO_LANGUAGES, VIDEO_LEVELS, VIDEO_TOPICS };

export const VIDEO_LEARNING_PATH = [
  'prep-001',
  'prep-005',
  'prep-011',
  'prep-013',
  'prep-016',
  'prep-018',
  'prep-008',
  'prep-004'
];

export function normalizeVideoLanguage(language) {
  if (language === 'English' || language === 'Hindi') return language;
  return 'Other';
}

export function matchesVideoSearch(video, search) {
  return matchesSearch({
    title: video.title,
    companyName: video.channel,
    field: video.field,
    skills: [video.topic, video.language, video.description, ...(video.skills || [])],
    searchTokens: [video.category, video.type]
  }, search);
}

function getDurationSeconds(durationLabel) {
  if (typeof durationLabel !== 'string' || durationLabel === 'Varies') return null;
  const parts = durationLabel.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

function matchesVideoDuration(video, filter) {
  if (!filter || filter === 'all') return true;
  const seconds = getDurationSeconds(video.durationLabel);
  if (filter === 'varies') return seconds === null;
  if (seconds === null) return false;
  if (filter === 'under-10') return seconds < 10 * 60;
  if (filter === '10-30') return seconds >= 10 * 60 && seconds <= 30 * 60;
  if (filter === 'over-30') return seconds > 30 * 60;
  return false;
}

export function filterVideos(videos, filters = {}) {
  return videos.filter(video => {
    if (filters.category && filters.category !== 'all'
      && video.category !== filters.category) return false;
    if (filters.topic && filters.topic !== 'all'
      && video.topic !== filters.topic) return false;
    if (filters.language && filters.language !== 'all'
      && normalizeVideoLanguage(video.language) !== filters.language) return false;
    if (filters.level && filters.level !== 'all'
      && video.level !== filters.level) return false;
    if (!matchesVideoDuration(video, filters.duration)) return false;
    return matchesVideoSearch(video, filters.search || '');
  });
}

export function getLearningPathProgress(pathIds, watchedIds) {
  const watched = new Set(watchedIds);
  const completed = pathIds.filter(id => watched.has(id)).length;
  return {
    completed,
    total: pathIds.length,
    percent: pathIds.length ? Math.round((completed / pathIds.length) * 100) : 0
  };
}

export function getVideosForInternship(internship, videos, limit = 3) {
  const skills = new Set((internship.skills || []).map(skill => skill.toLowerCase()));
  const field = (internship.field || '').toLowerCase();
  return videos
    .filter(video => video.category === 'Internship Prep')
    .map(video => {
      const videoSkills = (video.skills || []).map(skill => skill.toLowerCase());
      const skillMatch = videoSkills.some(skill => skills.has(skill));
      const fieldMatch = field && (video.field || '').toLowerCase() === field;
      return { video, score: (fieldMatch ? 2 : 0) + (skillMatch ? 1 : 0) };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id))
    .slice(0, limit)
    .map(item => item.video);
}
