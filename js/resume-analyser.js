import { COURSES, INTERNSHIPS } from './data.js';
import { buildResumeFallback, computeMatchPercentage } from '../shared/ai-rules.js';
import {
  deleteAiDocuments,
  escapeAiHtml,
  getAiStatus,
  loadAiDocument,
  requestAi,
  saveAiDocument
} from '../client/src/services/ai.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;
let callbacks = {};
let currentReport = null;
let currentSource = 'rules';
let currentFile = null;
let controller = null;
let loadedForUser = null;

export function initResumeAnalyser(options) {
  callbacks = options;
  const form = document.getElementById('resume-form');
  if (!form) return;
  const selector = document.getElementById('resume-internship');
  selector.innerHTML = '<option value="">Choose an internship (optional)</option>'
    + INTERNSHIPS.map(item => `<option value="${escapeAiHtml(item.id)}">${escapeAiHtml(item.title)}</option>`).join('');
  form.addEventListener('submit', analyzeResume);
  document.getElementById('resume-cancel')?.addEventListener('click', () => controller?.abort());
  document.getElementById('resume-compare')?.addEventListener('click', compareInternship);
  document.getElementById('resume-save-report')?.addEventListener('click', saveReport);
  document.getElementById('resume-delete-data')?.addEventListener('click', deleteSavedData);
  document.getElementById('resume-download-pdf')?.addEventListener('click', downloadReportPdf);
  document.getElementById('resume-print')?.addEventListener('click', () => window.print());
  document.getElementById('resume-results')?.addEventListener('click', handleResultAction);
  const fileInput = document.getElementById('resume-file');
  fileInput?.addEventListener('change', () => {
    currentFile = fileInput.files?.[0] || null;
    if (currentFile) document.getElementById('resume-text').value = '';
  });
  document.getElementById('resume-text')?.addEventListener('input', event => {
    if (event.currentTarget.value) {
      currentFile = null;
      if (fileInput) fileInput.value = '';
    }
  });
}

export async function renderResumeAnalyser(user = null) {
  const status = await getAiStatus();
  const statusElement = document.getElementById('resume-service-status');
  if (statusElement) {
    statusElement.textContent = status.offline
      ? 'Offline mode: pasted text can use local review rules. File extraction needs a connection.'
      : status.enabled
        ? 'AI review is available after you agree to the privacy notice.'
        : 'AI is not configured. Rule-based resume review is ready to use.';
  }
  const userKey = user?.uid || 'guest';
  if (loadedForUser === userKey) return;
  loadedForUser = userKey;
  currentReport = null;
  currentSource = 'rules';
  document.getElementById('resume-results')?.replaceChildren();
  try {
    const saved = await loadAiDocument(user, 'resumeReport');
    if (saved?.result) {
      currentReport = saved.result;
      currentSource = saved.source || 'rules';
      renderReport(saved.notice || saved.result.notice || '');
      showResumeMessage('A report you chose to save is shown below.', 'info');
    }
  } catch {
    showResumeMessage('A saved report could not be loaded. You can still analyse a resume.', 'warning');
  }
}

async function analyzeResume(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const file = currentFile || document.getElementById('resume-file').files?.[0] || null;
  const text = document.getElementById('resume-text').value.trim();
  if (file && text) return showResumeMessage('Choose either a file or pasted text, not both.', 'danger');
  if (!file && text.length < 20) return showResumeMessage('Paste at least 20 readable characters or choose a resume file.', 'warning');
  if (text.length > MAX_TEXT_CHARS) return showResumeMessage('Keep pasted text under 20,000 characters.', 'danger');
  if (file) {
    try {
      await validateResumeFile(file);
    } catch (error) {
      return showResumeMessage(error.message, 'danger');
    }
  }
  await submitResume({
    file,
    text,
    internshipId: document.getElementById('resume-internship').value,
    consent: form.elements.consent.checked
  });
}

async function submitResume({ file, text, internshipId, consent }) {
  if (!consent) return showResumeMessage('Please agree to the privacy notice before continuing.', 'warning');
  controller?.abort();
  controller = new AbortController();
  setLoading(true);
  const results = document.getElementById('resume-results');
  results.setAttribute('aria-busy', 'true');
  results.innerHTML = '<div class="ai-skeleton" aria-label="Reviewing the resume"><span></span><span></span><span></span></div>';
  showResumeMessage(file ? 'Extracting readable text from your file…' : 'Reviewing your resume text…');
  currentFile = file;
  try {
    const response = await requestAi('resume', {
      body: { resumeText: text, internshipId, consent: true },
      file,
      signal: controller.signal
    });
    currentReport = response.result;
    currentSource = response.source || 'ai';
    renderReport(response.notice || response.result.notice || '');
    showResumeMessage('Your review is ready. Check each suggestion against your real experience.', 'success');
  } catch (error) {
    if (error.name === 'AbortError') {
      results.replaceChildren();
      showResumeMessage('Resume analysis canceled.');
      return;
    }
    if (file) {
      results.replaceChildren();
      showResumeMessage('The server could not analyse this file. Connect to the server or paste readable resume text to use the offline review.', 'warning');
      return;
    }
    currentReport = buildResumeFallback(text, internshipId, {
      internships: INTERNSHIPS,
      courses: COURSES,
      videos: []
    });
    currentSource = 'rules';
    renderReport('Offline or server unavailable. This review uses local text and catalog matching rules.');
    showResumeMessage('A local rule-based review is ready. It cannot verify claims or assess visual formatting.', 'info');
  } finally {
    results.setAttribute('aria-busy', 'false');
    setLoading(false);
    controller = null;
  }
}

function renderReport(notice = '') {
  if (!currentReport) return;
  const report = currentReport;
  const skills = report.extractedSkills || Object.values(report.skills || {}).flat();
  const selectedInternship = INTERNSHIPS.find(item => item.id === report.internshipMatch?.id);
  const matchingInternships = (report.matchingInternships || []).map(item => {
    const internship = INTERNSHIPS.find(record => record.id === item.id);
    if (!internship) return '';
    return `<article class="ai-subcard"><h3>${escapeAiHtml(internship.title)}</h3><p>${escapeAiHtml(item.reason)}</p><p><strong>Skill match:</strong> ${Number(item.matchPercentage) || 0}%</p><button type="button" class="btn btn-outline btn-sm" data-compare-internship="${escapeAiHtml(item.id)}">Compare with this internship</button></article>`;
  }).join('');
  const groups = [
    ['Languages', 'languages'], ['Web', 'web'], ['Data & AI', 'dataAi'],
    ['Tools', 'tools'], ['Soft skills', 'soft']
  ];
  document.getElementById('resume-results').innerHTML = `
    <div class="ai-results-header">
      <div><span class="ai-badge">${currentSource === 'ai' ? 'AI suggestion' : 'Rule-based fallback'}</span><p class="ai-notice">${escapeAiHtml(notice)}</p></div>
      <span class="resume-score" aria-label="Resume score ${report.score.total} out of 100">${report.score.total}<small>/100</small></span>
    </div>
    <div class="ai-card-grid">
      <section class="ai-card"><h2>Detected profile summary</h2>
        ${renderListGroup('Education', report.profile.education)}
        ${renderListGroup('Experience', report.profile.experience)}
        ${renderListGroup('Projects', report.profile.projects)}
        ${renderListGroup('Certifications', report.profile.certifications)}
        ${renderListGroup('Links found in resume', report.profile.links)}
      </section>
      <section class="ai-card"><h2>Skills found</h2>
        ${groups.map(([label, key]) => renderListGroup(label, report.skills[key])).join('')}
        <fieldset class="ai-confirm-skills"><legend>Confirm skills to add to your profile</legend>
          ${skills.length ? skills.map(skill => `<label class="ai-choice"><input type="checkbox" value="${escapeAiHtml(skill)}" data-confirm-skill><span>${escapeAiHtml(skill)}</span></label>`).join('') : '<p>No known catalog skills were detected.</p>'}
          <button type="button" class="btn btn-secondary btn-sm" data-add-confirmed-skills ${skills.length ? '' : 'disabled'}>Add selected skills</button>
        </fieldset>
        <button type="button" class="btn btn-outline btn-sm" data-feed-guidance>Use these skills in AI Guidance</button>
      </section>
      <section class="ai-card"><h2>Qualifications and experience</h2>
        ${renderListGroup('Strengths', report.evaluation.strengths)}
        ${renderListGroup('Areas to improve', report.evaluation.weaknesses)}
      </section>
      <section class="ai-card"><h2>Score breakdown</h2>
        <ul class="ai-list">${Object.entries(report.score.breakdown).map(([name, item]) => `<li><strong>${escapeAiHtml(scoreLabel(name))}:</strong> ${item.score}/${item.max} — ${escapeAiHtml(item.reason)}</li>`).join('')}</ul>
      </section>
      <section class="ai-card"><h2>Suitable job roles</h2>
        <ul class="ai-list">${report.roles.map(role => `<li><strong>${escapeAiHtml(role.title)}</strong> — ${escapeAiHtml(role.fitReason)}</li>`).join('')}</ul>
      </section>
      <section class="ai-card"><h2>Relevant and missing skills by role</h2>
        ${(report.roleSkillAnalysis || []).map(item => `<article class="ai-subcard"><h3>${escapeAiHtml(item.role)}</h3>${renderListGroup('Skills found in the resume', item.relevantSkills)}${renderListGroup('Skills to explore from catalog requirements', item.missingSkills)}<p class="text-muted">${escapeAiHtml(item.note)}</p></article>`).join('') || '<p>No related skill lists are available in the catalog.</p>'}
      </section>
      <section class="ai-card"><h2>Matching internships from the catalog</h2>
        ${selectedInternship ? `<article class="ai-subcard"><h3>Selected: ${escapeAiHtml(selectedInternship.title)}</h3><p>${report.internshipMatch.matchPercentage}% skill match</p><p>Matches: ${report.internshipMatch.matchingSkills.map(escapeAiHtml).join(', ') || 'None listed'}</p><p>Skills to explore: ${report.internshipMatch.missingSkills.map(escapeAiHtml).join(', ') || 'None listed'}</p></article>` : ''}
        ${matchingInternships || '<p>No matching catalog listings were found.</p>'}
      </section>
      <section class="ai-card"><h2>Specific improvements</h2>
        ${report.suggestions.map(item => `<article class="ai-subcard"><h3>${escapeAiHtml(item.issue)}</h3><p><strong>Before:</strong> ${escapeAiHtml(item.before)}</p><p><strong>After:</strong> ${escapeAiHtml(item.after)}</p><ul class="ai-list">${item.tips.map(tip => `<li>${escapeAiHtml(tip)}</li>`).join('')}</ul></article>`).join('')}
        <h3>ATS tips</h3><p>Use clear headings, simple formatting, and accurate keywords. Review the original document because text extraction cannot confirm its layout.</p>
      </section>
      <section class="ai-card"><h2>Next actions</h2><p>These are suggestions, not a guarantee of hiring. Keep every statement accurate and check official opportunity details.</p></section>
    </div>
  `;
}

function renderListGroup(title, values = []) {
  if (!Array.isArray(values) || !values.length) return `<div class="ai-list-group"><h3>${escapeAiHtml(title)}</h3><p class="text-muted">No clear details detected.</p></div>`;
  return `<div class="ai-list-group"><h3>${escapeAiHtml(title)}</h3><ul class="ai-list">${values.map(item => `<li>${escapeAiHtml(item)}</li>`).join('')}</ul></div>`;
}

async function handleResultAction(event) {
  const addButton = event.target.closest('[data-add-confirmed-skills]');
  if (addButton) {
    const selected = [...document.querySelectorAll('#resume-results [data-confirm-skill]:checked')].map(item => item.value);
    if (!selected.length) return showResumeMessage('Select the skills you confirm before adding them.', 'warning');
    try {
      await callbacks.onAddSkills?.(selected);
      showResumeMessage(`${selected.length} confirmed skill${selected.length === 1 ? '' : 's'} added to your profile.`, 'success');
    } catch {
      showResumeMessage('The selected skills could not be saved to your profile.', 'danger');
    }
    return;
  }
  if (event.target.closest('[data-feed-guidance]')) {
    callbacks.onFeedSkills?.(currentReport?.extractedSkills || Object.values(currentReport?.skills || {}).flat());
    return;
  }
  const compareButton = event.target.closest('[data-compare-internship]');
  if (compareButton) {
    const selector = document.getElementById('resume-internship');
    selector.value = compareButton.dataset.compareInternship;
    compareInternship();
  }
}

function compareInternship() {
  if (!currentReport) return showResumeMessage('Analyse a resume first.', 'warning');
  const internship = INTERNSHIPS.find(item => item.id === document.getElementById('resume-internship').value);
  if (!internship) return showResumeMessage('Choose an internship from the catalog first.', 'warning');
  const skills = currentReport.extractedSkills || Object.values(currentReport.skills || {}).flat();
  currentReport.internshipMatch = {
    id: internship.id,
    matchPercentage: computeMatchPercentage(skills, internship.skills || []),
    matchingSkills: (internship.skills || []).filter(skill => skills.some(item => item.toLowerCase() === skill.toLowerCase())),
    missingSkills: (internship.skills || []).filter(skill => !skills.some(item => item.toLowerCase() === skill.toLowerCase()))
  };
  renderReport(currentReport.notice || '');
  showResumeMessage(`Compared your extracted skills with ${internship.title}.`, 'success');
}

async function saveReport() {
  if (!currentReport) return showResumeMessage('Analyse a resume before saving a report.', 'warning');
  try {
    await saveAiDocument(callbacks.getUser?.(), 'resumeReport', {
      result: currentReport,
      source: currentSource,
      notice: currentReport.notice || ''
    });
    showResumeMessage('Your report was saved. The uploaded file and resume text were not saved.', 'success');
  } catch {
    showResumeMessage('The report could not be saved. Check your connection and try again.', 'danger');
  }
}

async function deleteSavedData() {
  try {
    await deleteAiDocuments(callbacks.getUser?.());
    currentReport = null;
    document.getElementById('resume-results').replaceChildren();
    showResumeMessage('Saved AI guidance and resume reports were deleted. The uploaded file was never stored.', 'success');
  } catch {
    showResumeMessage('Saved AI data could not be deleted. Please try again.', 'danger');
  }
}

async function downloadReportPdf() {
  if (!currentReport) return showResumeMessage('Analyse a resume before downloading a report.', 'warning');
  try {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    let page = document.addPage([612, 792]);
    let y = 742;
    const lines = reportLines(currentReport);
    for (const rawLine of lines) {
      const line = rawLine.replace(/[^\x20-\x7E]/g, ' ').slice(0, 110);
      const wrapped = line.match(/.{1,95}(\s|$)/g) || [line];
      for (const text of wrapped) {
        if (y < 48) {
          page = document.addPage([612, 792]);
          y = 742;
        }
        page.drawText(text.trim(), { x: 48, y, size: 10, font });
        y -= 15;
      }
    }
    const bytes = await document.save();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'skillbridge-resume-analysis.pdf';
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    showResumeMessage('The PDF could not be created. Use Print and choose Save as PDF instead.', 'warning');
  }
}

function reportLines(report) {
  const lines = ['SkillBridge Resume Analysis', `Score: ${report.score.total}/100`, '', 'Profile summary'];
  for (const [heading, key] of [['Education', 'education'], ['Experience', 'experience'], ['Projects', 'projects'], ['Certifications', 'certifications']]) {
    lines.push(`${heading}: ${(report.profile[key] || []).join('; ') || 'No clear details detected.'}`);
  }
  lines.push('', 'Skills');
  Object.entries(report.skills).forEach(([group, values]) => lines.push(`${group}: ${values.join(', ')}`));
  lines.push('', 'Score breakdown');
  Object.entries(report.score.breakdown).forEach(([group, item]) => lines.push(`${scoreLabel(group)} ${item.score}/${item.max}: ${item.reason}`));
  lines.push('', 'Roles');
  report.roles.forEach(role => lines.push(`${role.title}: ${role.fitReason}`));
  lines.push('', 'Suggestions');
  report.suggestions.forEach(item => lines.push(`${item.issue}; Before: ${item.before}; After: ${item.after}`));
  lines.push('', 'AI suggestions are advice, not a guarantee of hiring.');
  return lines;
}

async function validateResumeFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Resume files must be 2 MB or smaller.');
  const extension = file.name.split('.').pop().toLowerCase();
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pdf = extension === 'pdf'
    && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  const docx = extension === 'docx'
    && bytes[0] === 0x50 && bytes[1] === 0x4b
    && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!pdf && !docx) throw new Error('Choose a valid PDF or DOCX file whose signature matches its file extension.');
}

function scoreLabel(value) {
  return value.replace(/[A-Z]/g, letter => ` ${letter}`).replace(/^./, letter => letter.toUpperCase());
}

function setLoading(loading) {
  document.getElementById('resume-analyze').disabled = loading;
  document.getElementById('resume-cancel').hidden = !loading;
}

function showResumeMessage(message, type = 'info') {
  const status = document.getElementById('resume-status');
  status.textContent = message;
  status.dataset.state = type;
}
