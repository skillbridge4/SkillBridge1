import { FIELDS } from '../client/src/constants.js';
import { ALL_SKILLS, COURSES, INTERNSHIPS } from './data.js';
import videos from '../data/seed/videos.json' with { type: 'json' };
import { buildGuidanceFallback } from '../shared/ai-rules.js';
import {
  deleteAiDocuments,
  escapeAiHtml,
  getAiStatus,
  loadAiDocument,
  requestAi,
  saveAiDocument
} from '../client/src/services/ai.js';

const catalogs = { courses: COURSES, videos, internships: INTERNSHIPS };
const suggestions = [...new Set([
  ...ALL_SKILLS,
  ...COURSES.flatMap(course => course.skillsCovered || []),
  ...INTERNSHIPS.flatMap(internship => internship.skills || [])
])].sort((a, b) => a.localeCompare(b));

let options = {};
let currentResult = null;
let currentSource = 'rules';
let completedWeeks = [];
let loadingController = null;
let loadedForUser = null;

export function initAiGuidance(callbacks) {
  options = callbacks;
  const form = document.getElementById('guidance-form');
  if (!form) return;

  const interests = document.getElementById('guidance-interests');
  interests.innerHTML = FIELDS.map(field => `
    <label class="ai-choice">
      <input type="checkbox" name="interest" value="${escapeAiHtml(field)}">
      <span>${escapeAiHtml(field)}</span>
    </label>
  `).join('');
  const datalist = document.getElementById('guidance-skill-suggestions');
  datalist.innerHTML = suggestions.map(skill => `<option value="${escapeAiHtml(skill)}"></option>`).join('');

  form.addEventListener('submit', generateGuidance);
  const input = document.getElementById('guidance-skill-input');
  document.getElementById('guidance-add-skill')?.addEventListener('click', () => addSkill(input.value));
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addSkill(input.value);
    }
  });
  document.getElementById('guidance-skills')?.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-guidance-skill]');
    if (button) button.closest('.ai-tag')?.remove();
  });
  document.getElementById('guidance-cancel')?.addEventListener('click', () => loadingController?.abort());
  document.getElementById('guidance-save-roadmap')?.addEventListener('click', saveRoadmap);
  document.getElementById('guidance-delete-data')?.addEventListener('click', deleteSavedData);
  document.getElementById('guidance-results')?.addEventListener('click', handleResultAction);
}

export async function renderAiGuidance(profile = {}, user = null) {
  const userKey = user?.uid || 'guest';
  prefillGuidanceForm(profile, userKey);
  const status = await getAiStatus();
  const statusElement = document.getElementById('guidance-service-status');
  if (statusElement) {
    statusElement.textContent = status.offline
      ? 'Offline mode: the local guidance rules are available.'
      : status.enabled
        ? 'AI suggestions are available after you agree to the privacy notice.'
        : 'AI is not configured. Rule-based guidance is ready to use.';
  }
  if (loadedForUser !== userKey) {
    loadedForUser = userKey;
    currentResult = null;
    currentSource = 'rules';
    completedWeeks = [];
    document.getElementById('guidance-results')?.replaceChildren();
    try {
      const saved = await loadAiDocument(user, 'roadmap');
      if (saved?.result) {
        currentResult = saved.result;
        currentSource = saved.source || 'rules';
        completedWeeks = Array.isArray(saved.completedWeeks) ? saved.completedWeeks : [];
        renderResult(saved.notice || saved.result.notice || '');
      }
    } catch {
      setGuidanceMessage('A saved roadmap could not be loaded. You can still create a new one.', 'warning');
    }
  }

}

export function setGuidanceSkills(skills) {
  const tags = document.getElementById('guidance-skills');
  if (!tags) return;
  tags.replaceChildren();
  (Array.isArray(skills) ? skills : []).forEach(addSkill);
}

function prefillGuidanceForm(profile, userKey) {
  const form = document.getElementById('guidance-form');
  if (!form || form.dataset.profileSource === userKey) return;
  form.querySelectorAll('input[name="interest"]').forEach(input => {
    input.checked = false;
  });
  document.getElementById('guidance-skills')?.replaceChildren();
  form.elements.education.value = profile.education || '';
  form.elements.branch.value = profile.branch || '';
  form.elements.year.value = profile.year || '';
  form.elements.careerGoal.value = profile.careerGoal || '';
  form.elements.preferredLocation.value = profile.preferredLocation || profile.location || '';
  form.elements.preferredMode.value = profile.preferredMode || '';
  form.elements.hoursPerWeek.value = profile.hoursPerWeek || '';
  const selectedInterests = new Set(Array.isArray(profile.interests) ? profile.interests : []);
  document.querySelectorAll('#guidance-interests input[name="interest"]').forEach(input => {
    input.checked = selectedInterests.has(input.value);
  });
  form.elements.customInterests.value = [...selectedInterests]
    .filter(interest => !FIELDS.includes(interest))
    .join(', ');
  if (Array.isArray(profile.skills)) profile.skills.forEach(addSkill);
  form.dataset.profileSource = userKey;
}

function addSkill(value) {
  const input = document.getElementById('guidance-skill-input');
  const cleaned = String(value || '').trim().replace(/,$/, '').slice(0, 100);
  if (!cleaned) return;
  const existing = [...document.querySelectorAll('#guidance-skills [data-skill]')]
    .some(node => node.dataset.skill.toLowerCase() === cleaned.toLowerCase());
  if (!existing) {
    const tag = document.createElement('span');
    tag.className = 'ai-tag';
    tag.dataset.skill = cleaned;
    tag.innerHTML = `${escapeAiHtml(cleaned)} <button type="button" class="ai-tag-remove" data-remove-guidance-skill aria-label="Remove ${escapeAiHtml(cleaned)}">×</button>`;
    document.getElementById('guidance-skills').append(tag);
  }
  if (input) input.value = '';
}

async function generateGuidance(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const input = {
    education: form.elements.education.value.trim(),
    branch: form.elements.branch.value.trim(),
    year: form.elements.year.value.trim(),
    interests: [
      ...[...form.querySelectorAll('input[name="interest"]:checked')].map(item => item.value),
      ...form.elements.customInterests.value.split(',').map(item => item.trim()).filter(Boolean)
    ].slice(0, 30),
    skills: [...document.querySelectorAll('#guidance-skills [data-skill]')].map(item => item.dataset.skill),
    careerGoal: form.elements.careerGoal.value.trim(),
    preferredLocation: form.elements.preferredLocation.value.trim(),
    preferredMode: form.elements.preferredMode.value,
    hoursPerWeek: Number(form.elements.hoursPerWeek.value || 0),
    consent: form.elements.consent.checked
  };
  await runGuidance(input);
}

async function runGuidance(input) {
  loadingController?.abort();
  loadingController = new AbortController();
  setGuidanceLoading(true);
  const resultElement = document.getElementById('guidance-results');
  resultElement.setAttribute('aria-busy', 'true');
  resultElement.innerHTML = '<div class="ai-skeleton" aria-label="Building your guidance"><span></span><span></span><span></span></div>';
  setGuidanceMessage('Reviewing your interests and catalog matches…');
  try {
    const response = await requestAi('guidance', { body: input, signal: loadingController.signal });
    currentResult = response.result;
    currentSource = response.source || 'ai';
    completedWeeks = [];
    renderResult(response.notice || response.result.notice || '');
  } catch (error) {
    if (error.name === 'AbortError') {
      resultElement.replaceChildren();
      setGuidanceMessage('Guidance request canceled.');
      return;
    }
    currentResult = buildGuidanceFallback(input, catalogs);
    currentSource = 'rules';
    completedWeeks = [];
    renderResult('You are offline or the server is unavailable. This guidance was made with local catalog and skill-matching rules.');
  } finally {
    resultElement.setAttribute('aria-busy', 'false');
    setGuidanceLoading(false);
    loadingController = null;
  }
}

function renderResult(notice = '') {
  if (!currentResult) return;
  const result = currentResult;
  const badge = sourceBadge(currentSource);
  const missing = result.skillGap.skillsMissing || [];
  const courses = new Map(COURSES.map(item => [item.id, item]));
  const videoMap = new Map(videos.map(item => [item.id, item]));
  const internships = new Map(INTERNSHIPS.map(item => [item.id, item]));
  document.getElementById('guidance-results').innerHTML = `
    <div class="ai-results-header">
      <div><span class="ai-badge">${badge}</span><p class="ai-notice">${escapeAiHtml(notice)}</p></div>
      <div class="ai-actions">
        <button type="button" class="btn btn-outline btn-sm" data-feedback="up" aria-label="This guidance was helpful">👍 Helpful</button>
        <button type="button" class="btn btn-outline btn-sm" data-feedback="down" aria-label="This guidance was not helpful">👎 Not helpful</button>
      </div>
    </div>
    <div class="ai-card-grid">
      <section class="ai-card"><h2>Career paths</h2>
        ${result.paths.map(path => `<article class="ai-subcard"><h3>${escapeAiHtml(path.title)}</h3><p>${escapeAiHtml(path.whyItFits)}</p><p><strong>Entry roles:</strong> ${path.entryRoles.map(escapeAiHtml).join(', ')}</p><p class="ai-suggestion">${escapeAiHtml(path.demandNote)}</p></article>`).join('')}
      </section>
      <section class="ai-card"><h2>Skill gap for ${escapeAiHtml(result.skillGap.pathTitle)}</h2>
        <p><strong>Skills you listed:</strong> ${result.skillGap.skillsHave.length ? result.skillGap.skillsHave.map(escapeAiHtml).join(', ') : 'None yet'}</p>
        ${missing.length ? `<ul class="ai-list">${missing.map(item => `<li><span class="badge badge-primary">${escapeAiHtml(item.priority)}</span> <strong>${escapeAiHtml(item.skill)}</strong> — ${escapeAiHtml(item.why)}</li>`).join('')}</ul>` : '<p>Your listed skills cover the suggested gap for now.</p>'}
        <button type="button" class="btn btn-secondary btn-sm" data-take-gap>Take missing skills to Skill Matcher</button>
      </section>
      <section class="ai-card"><h2>Recommended courses</h2>
        ${result.recommendedCourses.length ? result.recommendedCourses.map(item => {
          const course = courses.get(item.id);
          return course ? `<article class="ai-subcard"><h3>${escapeAiHtml(course.name)}</h3><p>${escapeAiHtml(item.reason)}</p><button type="button" class="btn btn-outline btn-sm" data-open-course="${escapeAiHtml(course.id)}">Open course</button></article>` : '';
        }).join('') : '<p>No matching catalog courses were found.</p>'}
      </section>
      <section class="ai-card"><h2>Recommended videos</h2>
        ${result.recommendedVideos.length ? result.recommendedVideos.map(item => {
          const video = videoMap.get(item.id);
          return video ? `<article class="ai-subcard"><h3>${escapeAiHtml(video.title)}</h3><p>${escapeAiHtml(item.reason)}</p><button type="button" class="btn btn-outline btn-sm" data-open-video="${escapeAiHtml(video.id)}">Open video</button></article>` : '';
        }).join('') : '<p>No matching catalog videos were found.</p>'}
      </section>
      <section class="ai-card ai-roadmap"><h2>Learning roadmap</h2>
        <div class="ai-progress" role="progressbar" aria-label="Roadmap progress" aria-valuemin="0" aria-valuemax="${result.roadmap.length}" aria-valuenow="${completedWeeks.length}">
          <span style="width:${Math.round((completedWeeks.length / result.roadmap.length) * 100)}%"></span>
        </div><p>${completedWeeks.length} of ${result.roadmap.length} weeks complete</p>
        ${result.roadmap.map(week => `<article class="ai-subcard"><label class="ai-week-check"><input type="checkbox" data-roadmap-done="${week.week}" ${completedWeeks.includes(week.week) ? 'checked' : ''}> Week ${week.week}: ${escapeAiHtml(week.goal)}</label><p><strong>Practice:</strong> ${escapeAiHtml(week.task)}</p><p><strong>Checkpoint:</strong> ${escapeAiHtml(week.checkpoint)}</p><div>${week.catalogItems.map(item => {
          const record = item.type === 'course' ? courses.get(item.id) : videoMap.get(item.id);
          return record ? `<button type="button" class="btn btn-ghost btn-sm" ${item.type === 'course' ? `data-open-course="${escapeAiHtml(item.id)}"` : `data-open-video="${escapeAiHtml(item.id)}"`}>Open ${item.type}: ${escapeAiHtml(record.name || record.title)}</button>` : '';
        }).join('')}</div></article>`).join('')}
      </section>
      <section class="ai-card"><h2>Matching internships</h2>
        ${result.matchingInternships.length ? result.matchingInternships.map(item => {
          const internship = internships.get(item.id);
          return internship ? `<article class="ai-subcard"><h3>${escapeAiHtml(internship.title)}</h3><p>${escapeAiHtml(item.reason)}</p><button type="button" class="btn btn-outline btn-sm" data-open-internship="${escapeAiHtml(internship.id)}">View internship</button></article>` : '';
        }).join('') : '<p>No matching listings were found in the catalog.</p>'}
      </section>
      <section class="ai-card"><h2>Next steps</h2><ol class="ai-list">${result.nextSteps.map(item => `<li>${escapeAiHtml(item)}</li>`).join('')}</ol></section>
    </div>
  `;
}

async function handleResultAction(event) {
  const feedback = event.target.closest('[data-feedback]');
  if (feedback) {
    localStorage.setItem('skillbridge_ai_guidance_feedback', feedback.dataset.feedback);
    setGuidanceMessage('Thanks for sharing your feedback.');
    return;
  }
  const check = event.target.closest('[data-roadmap-done]');
  if (check) {
    const week = Number(check.dataset.roadmapDone);
    completedWeeks = check.checked
      ? [...new Set([...completedWeeks, week])]
      : completedWeeks.filter(item => item !== week);
    renderResult(currentResult.notice || '');
    persistProgress().catch(() => setGuidanceMessage('Progress changed, but could not be saved.', 'warning'));
    return;
  }
  if (event.target.closest('[data-take-gap]')) {
    options.onTakeMissing?.(currentResult.skillGap.skillsMissing || [], currentResult.skillGap.skillsHave || []);
    return;
  }
  const courseButton = event.target.closest('[data-open-course]');
  if (courseButton) return options.onOpenCourse?.(courseButton.dataset.openCourse);
  const videoButton = event.target.closest('[data-open-video]');
  if (videoButton) return options.onOpenVideo?.(videoButton.dataset.openVideo);
  const internshipButton = event.target.closest('[data-open-internship]');
  if (internshipButton) options.onOpenInternship?.(internshipButton.dataset.openInternship, internshipButton);
}

async function saveRoadmap() {
  if (!currentResult) return setGuidanceMessage('Generate a roadmap before saving it.', 'warning');
  try {
    const user = options.getUser?.();
    await saveAiDocument(user, 'roadmap', {
      result: currentResult,
      source: currentSource,
      completedWeeks,
      notice: currentResult.notice || ''
    });
    if (user) {
      setGuidanceMessage('Your roadmap was saved to your profile.');
    } else {
      setGuidanceMessage('Your roadmap was saved in this browser. Sign in to sync it with your account.', 'warning');
      options.onRequireAuth?.('saved roadmaps');
    }
  } catch {
    setGuidanceMessage('The roadmap could not be saved. Check your connection and try again.', 'danger');
  }
}

async function persistProgress() {
  if (!currentResult) return;
  await saveAiDocument(options.getUser?.(), 'roadmap', {
    result: currentResult,
    source: currentSource,
    completedWeeks,
    notice: currentResult.notice || ''
  });
}

async function deleteSavedData() {
  try {
    await deleteAiDocuments(options.getUser?.());
    currentResult = null;
    completedWeeks = [];
    document.getElementById('guidance-results').replaceChildren();
    setGuidanceMessage('Saved AI guidance and resume reports were deleted.');
  } catch {
    setGuidanceMessage('Saved AI data could not be deleted. Please try again.', 'danger');
  }
}

function setGuidanceLoading(loading) {
  document.getElementById('guidance-generate').disabled = loading;
  document.getElementById('guidance-cancel').hidden = !loading;
}

function setGuidanceMessage(message, type = 'info') {
  const element = document.getElementById('guidance-status');
  element.textContent = message;
  element.dataset.state = type;
}

function sourceBadge(source) {
  return source === 'ai' ? 'AI suggestion' : 'Rule-based fallback';
}
