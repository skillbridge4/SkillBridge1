import { createRequire } from 'node:module';
import { catalogs } from './catalogs.js';
import { extractResumeText, validateResumeFile, validateResumeText } from './file.js';
import { guidancePrompt } from './prompts/guidance.js';
import { resumePrompt } from './prompts/resume.js';
import { isProviderEnabled, generateStructuredText } from './provider.js';
import {
  analyzeRoleSkills,
  buildGuidanceFallback,
  buildResumeFallback,
  computeMatchPercentage,
  extractSkills
} from '../../shared/ai-rules.js';
import { reserveAiQuota } from './quota.js';
import {
  parseStructuredResponse,
  validateGuidance,
  validateResume,
  verifyGuidanceCatalogIds
} from './schemas.js';

const require = createRequire(import.meta.url);
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 8, fieldSize: 100 * 1024 }
});

export function createAiRouter(express, dependencies) {
  const router = express.Router();
  const { optionalAuthenticate, requireFirestore } = dependencies;

  router.get('/status', (_request, response) => {
    response.json({ enabled: isProviderEnabled() });
  });

  router.post('/guidance', optionalAuthenticate, dependencies.rateLimit('ai-guidance', 12, 60_000), async (request, response) => {
    let input;
    try {
      input = validateGuidanceInput(request.body);
      requireConsent(request.body?.consent);
      if (isProviderEnabled() && !request.user) {
        response.status(401).json({ error: 'Sign in to use live AI guidance.' });
        return;
      }
      const fallback = buildGuidanceFallback(input, catalogs);
      const quota = await reserveQuota(request, requireFirestore);
      if (!quota) {
        response.status(429).json({
          error: 'Your daily AI request limit has been reached. Showing a rule-based plan instead.',
          result: withNotice(fallback, 'Daily limit reached. This plan was made with catalog and skill-matching rules.')
        });
        return;
      }
      if (!isProviderEnabled()) {
        response.json({
          result: withNotice(fallback, 'AI is not configured. This plan uses catalog and skill-matching rules.'),
          source: 'rules'
        });
        return;
      }
      try {
        const prompt = guidancePrompt(input, catalogPromptData());
        const result = await generateValidated(prompt, validateGuidance);
        response.json({
          result: verifyGuidanceCatalogIds(result, catalogs),
          source: 'ai',
          notice: 'AI suggestion. Check official sources for current demand and opportunities.'
        });
      } catch {
        response.status(503).json({
          error: 'AI guidance is unavailable right now. Showing a rule-based plan instead.',
          result: withNotice(fallback, 'The AI provider was unavailable or returned an invalid response. This plan uses local rules.')
        });
      }
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/resume', optionalAuthenticate, dependencies.rateLimit('ai-resume', 8, 60_000), (request, response) => {
    upload.single('resume')(request, response, error => {
      if (error) {
        response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: error.code === 'LIMIT_FILE_SIZE'
            ? 'Resume files must be 2 MB or smaller.'
            : 'Could not receive the resume file. Choose one PDF or DOCX file.'
        });
        return;
      }
      handleResume(request, response, { requireFirestore }).catch(() => {
        response.status(503).json({ error: 'Resume analysis is unavailable. Try again or paste readable resume text.' });
      });
    });
  });

  return router;
}

async function handleResume(request, response, dependencies) {
  try {
    const body = request.body || {};
    requireConsent(body.consent);
    if (isProviderEnabled() && !request.user) {
      response.status(401).json({ error: 'Sign in to use live AI resume analysis.' });
      return;
    }
    if (request.file) validateResumeFile(request.file);
    const resumeText = request.file
      ? await extractResumeText(request.file)
      : validateResumeText(body.resumeText);
    const selectedInternshipId = validateInternshipId(body.internshipId);
    const fallback = buildResumeFallback(resumeText, selectedInternshipId, catalogs);
    const quota = await reserveQuota(request, dependencies.requireFirestore);
    if (!quota) {
      response.status(429).json({
        error: 'Your daily AI request limit has been reached. Showing a rule-based review instead.',
        result: withNotice(fallback, 'Daily limit reached. This review uses text and catalog matching rules.')
      });
      return;
    }
    if (!isProviderEnabled()) {
      response.json({ result: withNotice(fallback, 'AI is not configured. This review uses text and catalog matching rules.'), source: 'rules' });
      return;
    }
    try {
      const prompt = resumePrompt(resumeText, catalogPromptData());
      const analysis = await generateValidated(prompt, validateResume);
      const safeAnalysis = keepResumeFacts(analysis, resumeText);
      const extractedSkills = [
        ...extractSkills(resumeText).map(item => item.name),
        ...Object.values(safeAnalysis.skills).flat()
      ];
      const matchedInternships = rankInternships(extractedSkills);
      const selected = catalogs.internships.find(item => item.id === selectedInternshipId);
      const internshipMatch = selected ? {
        id: selected.id,
        title: selected.title,
        matchPercentage: computeMatchPercentage(extractedSkills, selected.skills || []),
        matchingSkills: (selected.skills || []).filter(skill => hasSkill(extractedSkills, skill)),
        missingSkills: (selected.skills || []).filter(skill => !hasSkill(extractedSkills, skill))
      } : null;
      response.json({
        result: {
          ...safeAnalysis,
          extractedSkills: [...new Set(extractedSkills)],
          roleSkillAnalysis: analyzeRoleSkills(safeAnalysis.roles, extractedSkills, catalogs),
          matchingInternships: matchedInternships,
          internshipMatch,
          notice: 'AI suggestion based only on extracted resume text. Check all details before using them.'
        },
        source: 'ai'
      });
    } catch {
      response.status(503).json({
        error: 'AI resume analysis is unavailable. Showing a rule-based review instead.',
        result: withNotice(fallback, 'The AI provider was unavailable or returned an invalid response. This review uses text and catalog rules.')
      });
    }
  } catch (error) {
    sendError(response, error);
  }
}

async function generateValidated(prompt, validator) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = attempt === 0 ? prompt : {
      system: `${prompt.system} Your previous response did not match the required JSON shape. Return valid JSON with exactly the specified fields.`,
      user: prompt.user
    };
    const raw = await generateStructuredText(request);
    try {
      return parseStructuredResponse(raw, validator);
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error('AI response could not be validated.');
}

async function reserveQuota(request, requireFirestore) {
  let db = null;
  if (request.user) db = requireFirestore();
  return reserveAiQuota({
    uid: request.user?.uid,
    ip: request.ip || request.socket.remoteAddress,
    db
  });
}

function validateGuidanceInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'Guidance details are required.');
  }
  const stringField = (name, max) => {
    const value = body[name] ?? '';
    if (typeof value !== 'string' || value.length > max) throw httpError(400, `${name} is too long or invalid.`);
    return value.trim();
  };
  const listField = name => {
    const value = body[name] ?? [];
    if (!Array.isArray(value) || value.length > 30 || value.some(item => typeof item !== 'string' || item.length > 120)) {
      throw httpError(400, `${name} must be a short list of text values.`);
    }
    return [...new Set(value.map(item => item.trim()).filter(Boolean))];
  };
  const hours = Number(body.hoursPerWeek ?? 0);
  if (!Number.isFinite(hours) || hours < 0 || hours > 100) {
    throw httpError(400, 'Weekly study time must be between 0 and 100 hours.');
  }
  return {
    education: stringField('education', 100),
    branch: stringField('branch', 120),
    year: stringField('year', 40),
    interests: listField('interests'),
    skills: listField('skills'),
    careerGoal: stringField('careerGoal', 500),
    preferredLocation: stringField('preferredLocation', 120),
    preferredMode: stringField('preferredMode', 40),
    hoursPerWeek: hours
  };
}

function validateInternshipId(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !catalogs.internships.some(item => item.id === value)) {
    throw httpError(400, 'Choose an internship from the catalog.');
  }
  return value;
}

function catalogPromptData() {
  return {
    courses: catalogs.courses.map(({ id, name, category, skillsCovered = [] }) => ({ id, name, category, skills: skillsCovered.slice(0, 12) })),
    videos: catalogs.videos.slice(0, 140).map(({ id, title, field, skills = [] }) => ({ id, title, field, skills: skills.slice(0, 8) })),
    internships: catalogs.internships.map(({ id, title, field, skills = [] }) => ({ id, title, field, skills: skills.slice(0, 12) }))
  };
}

export function keepResumeFacts(analysis, resumeText) {
  const lower = resumeText.toLowerCase();
  const sourceLists = ['education', 'experience', 'projects', 'certifications'];
  const groundedProfile = Object.fromEntries(sourceLists.map(key => [
    key,
    analysis.profile[key].filter(value => lower.includes(value.toLowerCase()))
  ]));
  const skills = Object.fromEntries(Object.entries(analysis.skills).map(([group, values]) => [
    group,
    values.filter(value => lower.includes(value.toLowerCase()))
  ]));
  const extracted = extractSkills(resumeText);
  for (const item of extracted) {
    if (!skills[item.group].some(value => value.toLowerCase() === item.name.toLowerCase())) {
      skills[item.group].push(item.name);
    }
  }
  const linksInResume = new Set((resumeText.match(/https?:\/\/[^\s)>]+/gi) || []).map(value => value.replace(/[.,;]+$/, '')));
  return {
    ...analysis,
    profile: {
      ...analysis.profile,
      ...groundedProfile,
      links: analysis.profile.links.filter(link => linksInResume.has(link.replace(/[.,;]+$/, '')))
    },
    skills
  };
}

function rankInternships(skills) {
  return catalogs.internships.map(item => ({
    id: item.id,
    matchPercentage: computeMatchPercentage(skills, item.skills || []),
    reason: 'Match percentage is calculated by comparing extracted resume skills with skills listed in this catalog.'
  })).sort((a, b) => b.matchPercentage - a.matchPercentage).slice(0, 5);
}

function hasSkill(skills, candidate) {
  return skills.some(skill => skill.toLowerCase() === candidate.toLowerCase());
}

function requireConsent(value) {
  if (value !== true && value !== 'true') {
    throw httpError(400, 'Confirm the privacy notice before sending information for analysis.');
  }
}

function withNotice(result, notice) {
  return { ...result, notice };
}

function sendError(response, error) {
  const status = Number.isInteger(error?.status) ? error.status : 503;
  const message = status >= 500 ? 'This AI feature is temporarily unavailable.' : error.message;
  response.status(status).json({ error: message });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
