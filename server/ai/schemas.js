const guidanceKeys = [
  'paths', 'skillGap', 'recommendedCourses', 'recommendedVideos',
  'roadmap', 'matchingInternships', 'nextSteps'
];
const scoreWeights = {
  structure: 15,
  clarity: 15,
  skills: 15,
  projects: 15,
  impact: 15,
  formatting: 15,
  atsFriendliness: 10
};

function record(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  if (Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} has an unexpected shape.`);
  }
  return value;
}

function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${label} must be a non-empty string under ${max} characters.`);
  }
  return value.trim();
}

function textList(value, label, { min = 0, max = 20, itemMax = 300 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must contain ${min}-${max} items.`);
  }
  return value.map((item, index) => text(item, `${label}[${index}]`, itemMax));
}

function idReasonList(value, label, max = 10) {
  if (!Array.isArray(value) || value.length > max) {
    throw new TypeError(`${label} must be a list of at most ${max} items.`);
  }
  return value.map((item, index) => {
    record(item, `${label}[${index}]`, ['id', 'reason']);
    return {
      id: text(item.id, `${label}[${index}].id`, 100),
      reason: text(item.reason, `${label}[${index}].reason`)
    };
  });
}

export function validateGuidance(value) {
  record(value, 'Guidance', guidanceKeys);
  if (!Array.isArray(value.paths) || value.paths.length < 3 || value.paths.length > 5) {
    throw new TypeError('Guidance must contain 3-5 career paths.');
  }
  const paths = value.paths.map((path, index) => {
    record(path, `paths[${index}]`, ['title', 'whyItFits', 'entryRoles', 'demandNote']);
    return {
      title: text(path.title, `paths[${index}].title`, 120),
      whyItFits: text(path.whyItFits, `paths[${index}].whyItFits`),
      entryRoles: textList(path.entryRoles, `paths[${index}].entryRoles`, { min: 1, max: 6, itemMax: 120 }),
      demandNote: text(path.demandNote, `paths[${index}].demandNote`)
    };
  });
  const gap = record(value.skillGap, 'skillGap', ['pathTitle', 'skillsHave', 'skillsMissing']);
  if (!Array.isArray(gap.skillsMissing) || gap.skillsMissing.length > 30) {
    throw new TypeError('skillGap.skillsMissing must be a list of at most 30 items.');
  }
  const skillsMissing = gap.skillsMissing.map((item, index) => {
    record(item, `skillsMissing[${index}]`, ['skill', 'priority', 'why']);
    if (!['High', 'Medium', 'Low'].includes(item.priority)) {
      throw new TypeError(`skillsMissing[${index}].priority is invalid.`);
    }
    return {
      skill: text(item.skill, `skillsMissing[${index}].skill`, 100),
      priority: item.priority,
      why: text(item.why, `skillsMissing[${index}].why`)
    };
  });
  if (!Array.isArray(value.roadmap) || value.roadmap.length < 4 || value.roadmap.length > 12) {
    throw new TypeError('The roadmap must contain 4-12 weeks.');
  }
  const roadmap = value.roadmap.map((week, index) => {
    record(week, `roadmap[${index}]`, ['week', 'goal', 'catalogItems', 'task', 'checkpoint']);
    if (!Number.isInteger(week.week) || week.week < 1 || week.week > 12) {
      throw new TypeError(`roadmap[${index}].week must be between 1 and 12.`);
    }
    if (!Array.isArray(week.catalogItems) || week.catalogItems.length > 8) {
      throw new TypeError(`roadmap[${index}].catalogItems must contain at most 8 items.`);
    }
    const catalogItems = week.catalogItems.map((item, itemIndex) => {
      record(item, `roadmap[${index}].catalogItems[${itemIndex}]`, ['type', 'id']);
      if (!['course', 'video'].includes(item.type)) {
        throw new TypeError('Roadmap catalog item type must be course or video.');
      }
      return { type: item.type, id: text(item.id, 'roadmap catalog ID', 100) };
    });
    return {
      week: week.week,
      goal: text(week.goal, `roadmap[${index}].goal`),
      catalogItems,
      task: text(week.task, `roadmap[${index}].task`),
      checkpoint: text(week.checkpoint, `roadmap[${index}].checkpoint`)
    };
  });
  return {
    paths,
    skillGap: {
      pathTitle: text(gap.pathTitle, 'skillGap.pathTitle', 120),
      skillsHave: textList(gap.skillsHave, 'skillGap.skillsHave', { max: 50, itemMax: 100 }),
      skillsMissing
    },
    recommendedCourses: idReasonList(value.recommendedCourses, 'recommendedCourses', 8),
    recommendedVideos: idReasonList(value.recommendedVideos, 'recommendedVideos', 8),
    roadmap,
    matchingInternships: idReasonList(value.matchingInternships, 'matchingInternships', 8),
    nextSteps: textList(value.nextSteps, 'nextSteps', { min: 3, max: 10 })
  };
}

export function verifyGuidanceCatalogIds(guidance, catalogs) {
  const courseIds = new Set(catalogs.courses.map(item => item.id));
  const videoIds = new Set(catalogs.videos.map(item => item.id));
  const internshipIds = new Set(catalogs.internships.map(item => item.id));
  return {
    ...guidance,
    paths: guidance.paths.map(path => ({
      ...path,
      demandNote: path.demandNote.startsWith('AI suggestion:')
        ? path.demandNote
        : `AI suggestion: ${path.demandNote} Check official sources for current information.`
    })),
    recommendedCourses: guidance.recommendedCourses.filter(item => courseIds.has(item.id)),
    recommendedVideos: guidance.recommendedVideos.filter(item => videoIds.has(item.id)),
    matchingInternships: guidance.matchingInternships.filter(item => internshipIds.has(item.id)),
    roadmap: guidance.roadmap.map(week => ({
      ...week,
      catalogItems: week.catalogItems.filter(item =>
        (item.type === 'course' ? courseIds : videoIds).has(item.id))
    }))
  };
}

export function validateResume(value) {
  const top = record(value, 'Resume analysis', [
    'profile', 'skills', 'evaluation', 'roles', 'score', 'suggestions'
  ]);
  const profile = record(top.profile, 'profile', [
    'education', 'experience', 'projects', 'certifications', 'links'
  ]);
  const skills = record(top.skills, 'skills', [
    'languages', 'web', 'dataAi', 'tools', 'soft'
  ]);
  const evaluation = record(top.evaluation, 'evaluation', ['strengths', 'weaknesses']);
  if (!Array.isArray(top.roles) || top.roles.length < 3 || top.roles.length > 6) {
    throw new TypeError('roles must contain 3-6 items.');
  }
  const roleEntries = top.roles.map((item, index) => {
    record(item, `roles[${index}]`, ['title', 'fitReason']);
    return {
      title: text(item.title, `roles[${index}].title`, 120),
      fitReason: text(item.fitReason, `roles[${index}].fitReason`)
    };
  });
  const score = record(top.score, 'score', ['total', 'breakdown']);
  const breakdown = record(score.breakdown, 'score.breakdown', Object.keys(scoreWeights));
  let total = 0;
  const normalizedBreakdown = {};
  for (const [key, max] of Object.entries(scoreWeights)) {
    const item = record(breakdown[key], `score.breakdown.${key}`, ['score', 'max', 'reason']);
    if (!Number.isInteger(item.score) || item.score < 0 || item.score > max || item.max !== max) {
      throw new TypeError(`score.breakdown.${key} is outside its allowed range.`);
    }
    total += item.score;
    normalizedBreakdown[key] = {
      score: item.score,
      max,
      reason: text(item.reason, `score.breakdown.${key}.reason`)
    };
  }
  if (!Number.isInteger(score.total) || score.total !== total || total > 100) {
    throw new TypeError('The resume score total must equal its breakdown and stay under 100.');
  }
  if (!Array.isArray(top.suggestions) || top.suggestions.length < 2 || top.suggestions.length > 10) {
    throw new TypeError('Suggestions must contain 2-10 items.');
  }
  const suggestions = top.suggestions.map((item, index) => {
    record(item, `suggestions[${index}]`, ['issue', 'before', 'after', 'tips']);
    return {
      issue: text(item.issue, `suggestions[${index}].issue`),
      before: text(item.before, `suggestions[${index}].before`),
      after: text(item.after, `suggestions[${index}].after`),
      tips: textList(item.tips, `suggestions[${index}].tips`, { min: 1, max: 5 })
    };
  });
  return {
    profile: {
      education: textList(profile.education, 'profile.education', { max: 15 }),
      experience: textList(profile.experience, 'profile.experience', { max: 20 }),
      projects: textList(profile.projects, 'profile.projects', { max: 20 }),
      certifications: textList(profile.certifications, 'profile.certifications', { max: 15 }),
      links: textList(profile.links, 'profile.links', { max: 30, itemMax: 500 })
    },
    skills: {
      languages: textList(skills.languages, 'skills.languages', { max: 50, itemMax: 100 }),
      web: textList(skills.web, 'skills.web', { max: 50, itemMax: 100 }),
      dataAi: textList(skills.dataAi, 'skills.dataAi', { max: 50, itemMax: 100 }),
      tools: textList(skills.tools, 'skills.tools', { max: 50, itemMax: 100 }),
      soft: textList(skills.soft, 'skills.soft', { max: 50, itemMax: 100 })
    },
    evaluation: {
      strengths: textList(evaluation.strengths, 'evaluation.strengths', { min: 1, max: 10 }),
      weaknesses: textList(evaluation.weaknesses, 'evaluation.weaknesses', { min: 1, max: 10 })
    },
    roles: roleEntries,
    score: { total, breakdown: normalizedBreakdown },
    suggestions
  };
}

export function parseStructuredResponse(textValue, validator) {
  if (typeof textValue !== 'string' || textValue.length > 60_000) {
    throw new TypeError('The model response is empty or too large.');
  }
  const cleaned = textValue.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  return validator(JSON.parse(cleaned));
}
