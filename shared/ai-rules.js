// Pure deterministic analysis shared by server fallbacks and offline browser mode.
const SKILL_TERMS = [
  { name: 'JavaScript', group: 'languages', terms: ['javascript', 'js', 'ecmascript'] },
  { name: 'TypeScript', group: 'languages', terms: ['typescript', 'ts'] },
  { name: 'Python', group: 'languages', terms: ['python'] },
  { name: 'Java', group: 'languages', terms: ['java'] },
  { name: 'C/C++', group: 'languages', terms: ['c++', 'c/c++', ' c ', ' c,'] },
  { name: 'SQL', group: 'dataAi', terms: ['sql', 'mysql', 'postgresql', 'sqlite'] },
  { name: 'HTML', group: 'web', terms: ['html', 'html5'] },
  { name: 'CSS', group: 'web', terms: ['css', 'css3'] },
  { name: 'React', group: 'web', terms: ['react'] },
  { name: 'Next.js', group: 'web', terms: ['next.js', 'nextjs'] },
  { name: 'Node.js', group: 'web', terms: ['node.js', 'nodejs'] },
  { name: 'Express', group: 'web', terms: ['express.js', 'express'] },
  { name: 'Figma', group: 'tools', terms: ['figma'] },
  { name: 'Git', group: 'tools', terms: ['git', 'github'] },
  { name: 'Docker', group: 'tools', terms: ['docker'] },
  { name: 'Kubernetes', group: 'tools', terms: ['kubernetes', 'k8s'] },
  { name: 'AWS', group: 'tools', terms: ['aws', 'amazon web services'] },
  { name: 'Azure', group: 'tools', terms: ['azure'] },
  { name: 'Linux', group: 'tools', terms: ['linux'] },
  { name: 'Excel', group: 'tools', terms: ['excel', 'spreadsheets'] },
  { name: 'Pandas', group: 'dataAi', terms: ['pandas'] },
  { name: 'NumPy', group: 'dataAi', terms: ['numpy'] },
  { name: 'TensorFlow', group: 'dataAi', terms: ['tensorflow'] },
  { name: 'PyTorch', group: 'dataAi', terms: ['pytorch'] },
  { name: 'Machine Learning', group: 'dataAi', terms: ['machine learning', ' ml '] },
  { name: 'Data Analysis', group: 'dataAi', terms: ['data analysis', 'data analytics'] },
  { name: 'Tableau', group: 'dataAi', terms: ['tableau'] },
  { name: 'Power BI', group: 'dataAi', terms: ['power bi'] },
  { name: 'Communication', group: 'soft', terms: ['communication', 'communicated'] },
  { name: 'Teamwork', group: 'soft', terms: ['teamwork', 'collaboration'] },
  { name: 'Leadership', group: 'soft', terms: ['leadership', 'led a team'] },
  { name: 'Problem Solving', group: 'soft', terms: ['problem solving', 'problem-solving'] },
  { name: 'Time Management', group: 'soft', terms: ['time management'] },
  { name: 'Research', group: 'soft', terms: ['research'] },
  { name: 'Agile', group: 'tools', terms: ['agile', 'scrum'] },
  { name: 'REST APIs', group: 'web', terms: ['rest api', 'restful api'] },
  { name: 'Testing', group: 'tools', terms: ['testing', 'test automation', 'playwright'] },
  { name: 'Cybersecurity', group: 'tools', terms: ['cybersecurity', 'information security'] }
];

const FIELD_ROLES = {
  'Software Engineering': ['Junior Software Developer', 'Frontend Developer', 'QA Engineer'],
  'Data & AI': ['Data Analyst', 'Junior Data Scientist', 'AI Research Assistant'],
  Design: ['UI Designer', 'UX Research Assistant', 'Product Designer'],
  Marketing: ['Content Marketing Intern', 'SEO Associate', 'Social Media Coordinator'],
  Product: ['Product Analyst', 'Associate Product Manager', 'Product Operations Intern'],
  'Cloud & DevOps': ['Cloud Support Associate', 'Junior DevOps Engineer', 'Site Reliability Intern'],
  Cybersecurity: ['Security Analyst Intern', 'SOC Analyst', 'IT Security Assistant'],
  'Core Engineering': ['Engineering Intern', 'Research Assistant', 'Quality Engineer'],
  Research: ['Research Assistant', 'Laboratory Intern', 'Research Analyst']
};

const match = (skills, candidate) => skills.some(skill => skill.toLowerCase() === candidate.toLowerCase());
const unique = values => [...new Set(values.filter(Boolean))];

export function extractSkills(resumeText) {
  const text = ` ${resumeText.toLowerCase().replace(/[^a-z0-9.+/#-]+/g, ' ')} `;
  return SKILL_TERMS
    .filter(skill => skill.terms.some(term => {
      const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
    }))
    .map(({ name, group }) => ({ name, group }));
}

export function computeMatchPercentage(extractedSkills, requiredSkills = []) {
  const requirements = unique(requiredSkills.map(skill => String(skill).trim().toLowerCase()));
  if (!requirements.length) return 0;
  const available = new Set(extractedSkills.map(skill => String(skill).trim().toLowerCase()));
  const matches = requirements.filter(skill => available.has(skill)).length;
  return Math.round((matches / requirements.length) * 100);
}

export function analyzeRoleSkills(roles, extractedSkills, catalogs) {
  return roles.map(role => {
    const title = role.title.toLowerCase();
    const keywords = title.includes('data') || title.includes('analyst') || title.includes('ai')
      ? ['data', 'analytics', 'data science', 'machine learning']
      : title.includes('design') || title.includes('ux')
        ? ['design', 'ui/ux', 'product design']
        : title.includes('market') || title.includes('content')
          ? ['marketing', 'seo', 'content']
          : title.includes('cloud') || title.includes('devops')
            ? ['cloud', 'devops', 'infrastructure']
            : title.includes('research') || title.includes('scientist')
              ? ['research', 'data science', 'computer science']
              : ['frontend', 'web', 'software engineering', 'programming'];
    const relatedInternships = catalogs.internships.filter(item =>
      keywords.some(keyword => `${item.title || ''} ${item.field || ''}`.toLowerCase().includes(keyword)));
    const relatedCourses = rankCatalog(catalogs.courses, [], keywords).slice(0, 3);
    const catalogSkills = unique([
      ...relatedInternships.flatMap(item => item.skills || []),
      ...relatedCourses.flatMap(item => item.skillsCovered || [])
    ]).slice(0, 20);
    return {
      role: role.title,
      relevantSkills: catalogSkills.filter(skill => match(extractedSkills, skill)),
      missingSkills: catalogSkills.filter(skill => !match(extractedSkills, skill)),
      note: catalogSkills.length
        ? 'Skills are listed in related SkillBridge course or internship catalog entries.'
        : 'No specific skill list for this role was available in the current catalogs.'
    };
  });
}

function rankCatalog(items, inputSkills, interests = []) {
  const skillSet = new Set(inputSkills.map(item => String(item).toLowerCase()));
  const interestSet = new Set(interests.map(item => String(item).toLowerCase()));
  return items.map(item => {
    const itemSkills = item.skillsCovered || item.skills || [];
    const overlap = itemSkills.filter(skill => skillSet.has(String(skill).toLowerCase())).length;
    const categoryMatch = [...interestSet].some(value =>
      `${item.category || ''} ${item.field || ''}`.toLowerCase().includes(value));
    return { item, score: overlap * 2 + Number(categoryMatch) };
  }).sort((a, b) => b.score - a.score).map(entry => entry.item);
}

export function buildGuidanceFallback(input, catalogs) {
  const skills = unique(input.skills || []);
  const interests = unique(input.interests || []);
  const requestedFields = interests.filter(value => value.length <= 80);
  const fields = unique([...requestedFields, ...[
    'Software Engineering', 'Data & AI', 'Design', 'Product'
  ]]).slice(0, 5);
  const courses = rankCatalog(catalogs.courses, skills, interests);
  const videos = rankCatalog(catalogs.videos, skills, interests);
  const internships = rankCatalog(catalogs.internships, skills, interests);
  const selectedCourses = courses.slice(0, 3);
  const selectedVideos = videos.slice(0, 3);
  const desiredSkills = unique([
    ...selectedCourses.flatMap(item => item.skillsCovered || []),
    ...selectedVideos.flatMap(item => item.skills || [])
  ]);
  const skillsMissing = desiredSkills.filter(skill => !match(skills, skill)).slice(0, 8);
  const topField = fields[0];
  const pathRoles = FIELD_ROLES[topField] || ['Program Assistant', 'Operations Intern', 'Research Assistant'];
  return {
    paths: fields.slice(0, 5).map((field, index) => ({
      title: field,
      whyItFits: interests.includes(field)
        ? `This path matches your interest in ${field}.`
        : `This path is a practical option to explore based on your current skills.`,
      entryRoles: FIELD_ROLES[field] || ['Program Assistant', 'Operations Intern', 'Research Assistant'],
      demandNote: 'AI suggestion: check current openings and official sources before making a decision.'
    })),
    skillGap: {
      pathTitle: topField,
      skillsHave: skills.slice(0, 30),
      skillsMissing: skillsMissing.map((skill, index) => ({
        skill,
        priority: index < 2 ? 'High' : index < 5 ? 'Medium' : 'Low',
        why: `This skill appears in learning items related to ${topField}.`
      }))
    },
    recommendedCourses: selectedCourses.map(item => ({
      id: item.id,
      reason: `Build relevant skills through ${item.name}.`
    })),
    recommendedVideos: selectedVideos.map(item => ({
      id: item.id,
      reason: `Use this catalog video as a short practice resource.`
    })),
    roadmap: Array.from({ length: 4 }, (_, index) => {
      const course = selectedCourses[index % Math.max(1, selectedCourses.length)];
      const video = selectedVideos[index % Math.max(1, selectedVideos.length)];
      const catalogItems = [];
      if (course) catalogItems.push({ type: 'course', id: course.id });
      if (video) catalogItems.push({ type: 'video', id: video.id });
      return {
        week: index + 1,
        goal: [`Review your starting point`, `Practice a core skill`, `Build a small example`, `Review and plan next steps`][index],
        catalogItems,
        task: `Spend a small, realistic block of time practising ${skillsMissing[index] || topField}.`,
        checkpoint: 'Write down what you completed and one question to explore next.'
      };
    }),
    matchingInternships: internships.slice(0, 5).map(item => ({
      id: item.id,
      reason: `This catalog listing is related to ${item.field || item.companyName || 'your interests'}.`
    })),
    nextSteps: [
      'Choose one path to explore first.',
      'Set aside a weekly learning time that fits your schedule.',
      'Check course and internship details on their official pages.'
    ]
  };
}

function sectionLines(text, labels) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const heading = new RegExp(`^(?:${labels.join('|')})\\s*[:\\-]?\\s*(.*)$`, 'i');
  const anyHeading = /^(education|experience|work history|projects?|certifications?|skills|summary|profile|achievements?)(?:\s*[:\-].*|\s*)$/i;
  const index = lines.findIndex(line => heading.test(line));
  if (index < 0) return [];
  const firstLine = lines[index].match(heading)?.[1].trim();
  const result = firstLine ? [firstLine.slice(0, 300)] : [];
  for (let cursor = index + 1; cursor < lines.length && result.length < 8; cursor += 1) {
    if (anyHeading.test(lines[cursor])) break;
    result.push(lines[cursor].slice(0, 300));
  }
  return result;
}

function scoreResume(text, skills, profile) {
  const headings = ['education', 'experience', 'project', 'skill', 'certification']
    .filter(label => new RegExp(`\\b${label}`, 'i').test(text)).length;
  const metricLines = text.split(/\r?\n/).filter(line => /\b\d+(?:\.\d+)?%?\b/.test(line)).length;
  const projectScore = Math.min(15, profile.projects.length * 5);
  const metricsScore = Math.min(15, metricLines * 3);
  const breakdown = {
    structure: { score: Math.min(15, headings * 3), max: 15, reason: `${headings} common resume sections were found in the extracted text.` },
    clarity: { score: text.length > 500 ? 12 : 7, max: 15, reason: 'A text-only check can estimate content length but cannot judge visual readability.' },
    skills: { score: Math.min(15, skills.length * 2), max: 15, reason: `${skills.length} skills from the built-in keyword list were found.` },
    projects: { score: projectScore, max: 15, reason: `${profile.projects.length} project section entries were found.` },
    impact: { score: metricsScore, max: 15, reason: `${metricLines} lines contain a number that may describe a measurable result.` },
    formatting: { score: 8, max: 15, reason: 'Text extraction cannot verify the visual layout, so this score is conservative.' },
    atsFriendliness: { score: Math.min(10, headings * 2), max: 10, reason: 'Recognizable section headings can help parsing; verify the original file visually.' }
  };
  return {
    total: Object.values(breakdown).reduce((total, item) => total + item.score, 0),
    breakdown
  };
}

export function buildResumeFallback(resumeText, selectedInternshipId, catalogs) {
  const extracted = extractSkills(resumeText);
  const skills = extracted.map(item => item.name);
  const grouped = { languages: [], web: [], dataAi: [], tools: [], soft: [] };
  extracted.forEach(item => grouped[item.group].push(item.name));
  const profile = {
    education: sectionLines(resumeText, ['education', 'education background']),
    experience: sectionLines(resumeText, ['experience', 'work history', 'employment']),
    projects: sectionLines(resumeText, ['projects?', 'academic projects']),
    certifications: sectionLines(resumeText, ['certifications?', 'certificates']),
    links: unique(resumeText.match(/https?:\/\/[^\s)>]+/gi) || []).slice(0, 20)
  };
  const allText = resumeText.toLowerCase();
  const roles = [
    { title: skills.includes('JavaScript') || skills.includes('React') ? 'Junior Web Developer' : 'Software Intern', fitReason: 'Based on the skills and terms found in the resume text.' },
    { title: skills.includes('Data Analysis') || skills.includes('Python') ? 'Data Analyst Intern' : 'Research Assistant', fitReason: 'A starting role to explore based on the extracted profile.' },
    { title: skills.includes('Figma') ? 'UI/UX Design Intern' : 'Project or Operations Intern', fitReason: 'Compare the role requirements with your interests and experience.' }
  ];
  const internships = catalogs.internships.map(item => ({
    item,
    matchPercentage: computeMatchPercentage(skills, item.skills || [])
  })).sort((a, b) => b.matchPercentage - a.matchPercentage).slice(0, 5);
  const selected = catalogs.internships.find(item => item.id === selectedInternshipId);
  const internshipMatch = selected ? {
    id: selected.id,
    title: selected.title,
    matchPercentage: computeMatchPercentage(skills, selected.skills || []),
    matchingSkills: (selected.skills || []).filter(skill => match(skills, skill)),
    missingSkills: (selected.skills || []).filter(skill => !match(skills, skill))
  } : null;
  const score = scoreResume(resumeText, skills, profile);
  return {
    profile,
    skills: grouped,
    evaluation: {
      strengths: [
        `${skills.length} known skills were detected in the resume text.`,
        `${profile.projects.length} project entries were detected.`
      ],
      weaknesses: [
        profile.experience.length ? 'Review each experience bullet for clear actions and outcomes.' : 'No clearly labelled experience section was detected.',
        'The rule-based review cannot assess visual formatting or verify claims.'
      ]
    },
    roles,
    score,
    suggestions: [
      {
        issue: 'Show the outcome of your work where you can support it with evidence.',
        before: profile.projects[0] || 'Worked on a project.',
        after: 'Built a project using the tools listed, and describe a measurable result only when you can verify it.',
        tips: ['Use action verbs.', 'Keep each bullet accurate and specific.']
      },
      {
        issue: 'Make sections easy to scan.',
        before: 'Information grouped in long paragraphs.',
        after: 'Use clear headings and short bullets for education, projects, and skills.',
        tips: ['Use a simple layout.', 'Proofread dates and links.']
      }
    ],
    matchingInternships: internships.map(({ item, matchPercentage }) => ({
      id: item.id,
      matchPercentage,
      reason: 'Match percentage is calculated from resume keywords and this catalog listing’s listed skills.'
    })),
    internshipMatch,
    roleSkillAnalysis: analyzeRoleSkills(roles, skills, catalogs),
    extractedSkills: skills,
    notice: allText.includes('ignore previous instructions')
      ? 'Resume text was treated as untrusted data. Review this rule-based report carefully.'
      : 'Rule-based review from extracted text. It cannot verify claims or assess the original layout.'
  };
}
