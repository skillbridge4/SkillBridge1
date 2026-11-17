import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { catalogs } from '../server/ai/catalogs.js';
import { extractResumeText, validateResumeFile, validateResumeText } from '../server/ai/file.js';
import { isProviderEnabled, generateStructuredText } from '../server/ai/provider.js';
import { keepResumeFacts } from '../server/ai/routes.js';
import { reserveAiQuota } from '../server/ai/quota.js';
import {
  buildGuidanceFallback,
  buildResumeFallback,
  computeMatchPercentage,
  extractSkills
} from '../shared/ai-rules.js';
import {
  parseStructuredResponse,
  validateGuidance,
  validateResume,
  verifyGuidanceCatalogIds
} from '../server/ai/schemas.js';

function guidanceFixture() {
  return {
    paths: ['Web Development', 'Data & AI', 'Design'].map(title => ({
      title,
      whyItFits: 'It connects with the skills you shared.',
      entryRoles: ['Intern', 'Assistant'],
      demandNote: 'Check current sources.'
    })),
    skillGap: {
      pathTitle: 'Web Development',
      skillsHave: ['JavaScript'],
      skillsMissing: [{ skill: 'Git', priority: 'High', why: 'It appears in the course catalog.' }]
    },
    recommendedCourses: [{ id: 'crs-01', reason: 'Build your JavaScript basics.' }],
    recommendedVideos: [{ id: 'prep-001', reason: 'Practise internship search.' }],
    roadmap: Array.from({ length: 4 }, (_, index) => ({
      week: index + 1,
      goal: `Goal ${index + 1}`,
      catalogItems: [{ type: 'course', id: 'crs-01' }],
      task: 'Practise with a small example.',
      checkpoint: 'Write down what you learned.'
    })),
    matchingInternships: [{ id: 'google-summer-of-code', reason: 'This listing is related to your goal.' }],
    nextSteps: ['Choose a path.', 'Set a learning time.', 'Check official sources.']
  };
}

function resumeFixture() {
  const maxima = {
    structure: 15,
    clarity: 15,
    skills: 15,
    projects: 15,
    impact: 15,
    formatting: 15,
    atsFriendliness: 10
  };
  const breakdown = Object.fromEntries(Object.entries(maxima).map(([name, max]) => [
    name,
    { score: 2, max, reason: 'A text-only check found room to improve.' }
  ]));
  return {
    profile: { education: [], experience: [], projects: [], certifications: [], links: [] },
    skills: { languages: ['JavaScript'], web: ['React'], dataAi: [], tools: [], soft: [] },
    evaluation: { strengths: ['Some skills were found.'], weaknesses: ['Add more project details.'] },
    roles: [
      { title: 'Web Developer Intern', fitReason: 'You listed web skills.' },
      { title: 'QA Intern', fitReason: 'Testing is a useful area to explore.' },
      { title: 'Research Assistant', fitReason: 'A starting role to consider.' }
    ],
    score: { total: 14, breakdown },
    suggestions: [
      { issue: 'Add a clear outcome.', before: 'Built an app.', after: 'Built a small app and describe a verified outcome.', tips: ['Use clear verbs.'] },
      { issue: 'Use headings.', before: 'Long paragraph.', after: 'Group details under simple headings.', tips: ['Keep bullets short.'] }
    ]
  };
}

test('guidance schema validates strict shape and catalog references are filtered', () => {
  const result = validateGuidance(guidanceFixture());
  result.recommendedCourses.push({ id: 'not-a-course', reason: 'Do not show this.' });
  result.recommendedVideos.push({ id: 'not-a-video', reason: 'Do not show this.' });
  result.matchingInternships.push({ id: 'not-an-internship', reason: 'Do not show this.' });
  result.roadmap[0].catalogItems.push({ type: 'video', id: 'not-a-video' });
  const safe = verifyGuidanceCatalogIds(result, catalogs);
  assert.deepEqual(safe.recommendedCourses.map(item => item.id), ['crs-01']);
  assert.deepEqual(safe.recommendedVideos.map(item => item.id), ['prep-001']);
  assert.deepEqual(safe.matchingInternships.map(item => item.id), ['google-summer-of-code']);
  assert.equal(safe.roadmap[0].catalogItems.length, 1);
  assert.match(safe.paths[0].demandNote, /^AI suggestion:/);
  assert.throws(() => validateGuidance({ ...guidanceFixture(), unexpected: true }), /unexpected shape/);
});

test('resume schema requires score total to match the bounded breakdown', () => {
  assert.equal(validateResume(resumeFixture()).score.total, 14);
  const invalid = resumeFixture();
  invalid.score.total = 99;
  assert.throws(() => validateResume(invalid), /equal its breakdown/);
});

test('resume summary facts and links are retained only when present in the source text', () => {
  const analysis = resumeFixture();
  analysis.profile.education = ['BSc Computer Science', 'PhD in Robotics'];
  analysis.profile.projects = ['Built a React app', 'Led a space mission'];
  analysis.profile.links = ['https://example.com', 'https://invented.example'];
  const grounded = keepResumeFacts(analysis, 'BSc Computer Science. Built a React app. https://example.com');
  assert.deepEqual(grounded.profile.education, ['BSc Computer Science']);
  assert.deepEqual(grounded.profile.projects, ['Built a React app']);
  assert.deepEqual(grounded.profile.links, ['https://example.com']);
});

test('resume skill extraction avoids substring false positives and computes catalog match percent', () => {
  const skills = extractSkills('JavaScript, Python, React, SQL and communication');
  assert.deepEqual(skills.map(item => item.name), ['JavaScript', 'Python', 'SQL', 'React', 'Communication']);
  assert.equal(skills.some(item => item.name === 'Java'), false);
  assert.equal(computeMatchPercentage(['python', 'React'], ['Python', 'React', 'SQL']), 67);
  assert.equal(computeMatchPercentage(['Python'], []), 0);
});

test('rule-based results use only catalog IDs and produce a four-week plan', () => {
  const guidance = buildGuidanceFallback({ interests: ['Software Engineering'], skills: ['JavaScript'] }, catalogs);
  const courseIds = new Set(catalogs.courses.map(item => item.id));
  const videoIds = new Set(catalogs.videos.map(item => item.id));
  const internshipIds = new Set(catalogs.internships.map(item => item.id));
  assert.equal(guidance.paths.length >= 3, true);
  assert.equal(guidance.roadmap.length, 4);
  assert.ok(guidance.recommendedCourses.every(item => courseIds.has(item.id)));
  assert.ok(guidance.recommendedVideos.every(item => videoIds.has(item.id)));
  assert.ok(guidance.matchingInternships.every(item => internshipIds.has(item.id)));

  const report = buildResumeFallback('Education\nBSc Computer Science\nProjects\nBuilt a React app using JavaScript.', '', catalogs);
  assert.ok(report.extractedSkills.includes('JavaScript'));
  assert.ok(report.roleSkillAnalysis.length >= 3);
  assert.ok(report.score.total <= 100);
  const inlineSections = buildResumeFallback(
    'Education: BSc Computer Science\nProjects: Built a React app\nSkills: JavaScript',
    '',
    catalogs
  );
  assert.deepEqual(inlineSections.profile.education, ['BSc Computer Science']);
  assert.deepEqual(inlineSections.profile.projects, ['Built a React app']);
});

test('file validation requires allowed extension, matching signature, and size limit', () => {
  assert.equal(validateResumeFile({
    originalname: 'resume.pdf',
    buffer: Buffer.from('%PDF-1.7 content'),
    size: 16
  }), 'pdf');
  assert.equal(validateResumeFile({
    originalname: 'resume.docx',
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]),
    size: 6
  }), 'docx');
  assert.throws(() => validateResumeFile({
    originalname: 'resume.pdf',
    buffer: Buffer.from('not a PDF'),
    size: 9
  }), /signature/);
  assert.throws(() => validateResumeFile({
    originalname: 'resume.docx',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    size: 2 * 1024 * 1024 + 1
  }), /2 MB/);
  assert.throws(() => validateResumeText(''), /No selectable resume text/);
});

test('server extracts readable text from a generated PDF and rejects a textless PDF', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Education: BSc Computer Science. Projects: Built a JavaScript website.', {
    x: 40,
    y: 700,
    font
  });
  const buffer = Buffer.from(await document.save());
  const text = await extractResumeText({ originalname: 'resume.pdf', buffer, size: buffer.length });
  assert.match(text, /BSc Computer Science/);

  const emptyDocument = await PDFDocument.create();
  const emptyBuffer = Buffer.from(await emptyDocument.save());
  await assert.rejects(
    extractResumeText({ originalname: 'empty.pdf', buffer: emptyBuffer, size: emptyBuffer.length }),
    /No selectable resume text/
  );
});

test('AI is disabled by default and provider requests can be mocked', async () => {
  assert.equal(isProviderEnabled({ AI_ENABLED: 'false', AI_API_KEY: '', AI_MODEL: '' }), false);
  let url;
  let authorization;
  const response = await generateStructuredText(
    { system: 'Return JSON.', user: '{"value":1}' },
    { AI_ENABLED: 'true', AI_PROVIDER: 'openai', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' },
    async (requestUrl, options) => {
      url = requestUrl;
      authorization = options.headers.Authorization;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"value":1}' } }] }) };
    }
  );
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(authorization, 'Bearer test-key');
  assert.equal(response, '{"value":1}');
});

test('per-user and per-IP daily and rolling limits are enforced', async () => {
  const now = Date.UTC(2026, 10, 13, 12);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(await reserveAiQuota({ uid: 'quota-user-a', ip: '10.0.0.1', now }), true);
  }
  assert.equal(await reserveAiQuota({ uid: 'quota-user-a', ip: '10.0.0.1', now }), false);

  for (let index = 0; index < 10; index += 1) {
    assert.equal(await reserveAiQuota({ uid: `quota-user-${index}`, ip: '10.0.0.2', now }), true);
  }
  assert.equal(await reserveAiQuota({ uid: 'quota-user-over-ip', ip: '10.0.0.2', now }), false);
});

test('prompt output parser rejects malformed JSON', () => {
  assert.throws(() => parseStructuredResponse('not JSON', validateGuidance));
});
