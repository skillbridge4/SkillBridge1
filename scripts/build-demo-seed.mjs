import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const companyNames = [
  'Demo Cedar Finch Studio',
  'Demo Copper Vale Lab',
  'Demo Fern Harbor Works',
  'Demo Flint Meadow Studio',
  'Demo Golden Birch Lab',
  'Demo Harbor Quartz Works',
  'Demo Indigo Sparrow Studio',
  'Demo Juniper Moss Lab',
  'Demo Kestrel Orchard Works',
  'Demo Lantern Grove Studio',
  'Demo Maple Thistle Lab',
  'Demo Northwind Willow Works',
  'Demo Ochre Prairie Studio',
  'Demo Pebble River Lab',
  'Demo Quartz Meadow Works',
  'Demo Redwood Finch Studio',
  'Demo Saffron Hollow Lab',
  'Demo Tidal Cedar Works',
  'Demo Umber Lantern Studio',
  'Demo Willow Harbor Lab'
];
const roles = [
  { title: 'Frontend Development Intern', field: 'Software Engineering', skills: ['JavaScript', 'HTML5', 'CSS3'] },
  { title: 'Backend API Intern', field: 'Software Engineering', skills: ['Node.js', 'SQL', 'Testing'] },
  { title: 'QA Automation Intern', field: 'Software Engineering', skills: ['Playwright', 'Testing', 'Git'] },
  { title: 'Web Accessibility Intern', field: 'Software Engineering', skills: ['HTML5', 'CSS3', 'Accessibility'] },
  { title: 'Data Analysis Intern', field: 'Data & AI', skills: ['Python', 'SQL', 'Data Analysis'] },
  { title: 'Machine Learning Research Intern', field: 'Data & AI', skills: ['Python', 'Machine Learning', 'Statistics'] },
  { title: 'Product Data Intern', field: 'Product', skills: ['SQL', 'Data Analysis', 'Roadmapping'] },
  { title: 'User Research Intern', field: 'Design', skills: ['User Research', 'Communication', 'Figma'] },
  { title: 'UX Design Intern', field: 'Design', skills: ['Figma', 'Wireframing', 'Prototyping'] },
  { title: 'Content Strategy Intern', field: 'Marketing', skills: ['Content Writing', 'SEO', 'Communication'] },
  { title: 'Community Marketing Intern', field: 'Marketing', skills: ['Social Media', 'Communication', 'Content Writing'] },
  { title: 'Product Operations Intern', field: 'Product', skills: ['Agile', 'Roadmapping', 'Problem Solving'] },
  { title: 'Cloud Operations Intern', field: 'Cloud & DevOps', skills: ['Linux', 'Docker', 'CI/CD'] },
  { title: 'Security Operations Intern', field: 'Cybersecurity', skills: ['Cybersecurity', 'Networking', 'Incident Response'] },
  { title: 'Mechanical Design Intern', field: 'Mechanical Engineering', skills: ['CAD', 'Documentation', 'Problem Solving'] },
  { title: 'Civil Planning Intern', field: 'Civil Engineering', skills: ['Research', 'Documentation', 'Project Planning'] },
  { title: 'Electrical Systems Intern', field: 'Electrical Engineering', skills: ['Circuit Analysis', 'Documentation', 'Problem Solving'] },
  { title: 'Embedded Systems Intern', field: 'Electronics & Embedded', skills: ['C/C++', 'Microcontrollers', 'Testing'] },
  { title: 'Business Research Intern', field: 'Business & Finance', skills: ['Research', 'Communication', 'Data Analysis'] },
  { title: 'Science Outreach Intern', field: 'Education', skills: ['Communication', 'Public Speaking', 'Problem Solving'] }
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

async function writeJson(relativePath, records) {
  await writeFile(resolve(root, relativePath), `${JSON.stringify(records, null, 2)}\n`);
}

const companies = (await readJson('data/seed/companies.json'))
  .filter(company => !company.id.startsWith('demo-company-'))
  .map(company => {
    const sourceUrl = company.verified === true
      ? company.sourceUrl || company.website
      : company.sourceUrl || null;
    return {
      ...company,
      description: company.description || null,
      sourceUrl,
      isDemo: company.isDemo === true
    };
  });
const internships = (await readJson('data/seed/internships.json'))
  .filter(internship => !internship.id.startsWith('demo-internship-'))
  .map(internship => ({
    ...internship,
    sourceUrl: internship.sourceUrl || internship.source || null,
    isDemo: internship.isDemo === true
  }));

const demoCompanies = companyNames.map((name, index) => ({
  id: `demo-company-${String(index + 1).padStart(2, '0')}`,
  name,
  sector: 'Demo data',
  type: 'Program',
  city: null,
  state: null,
  website: null,
  careersUrl: null,
  logo: null,
  verified: false,
  lastVerified: null,
  sourceUrl: null,
  isDemo: true,
  description: 'Fictional sample organization for interface testing; not a real employer.'
}));

const demoInternships = Array.from({ length: 40 }, (_, index) => {
  const companyIndex = Math.floor(index / 2);
  const roleIndex = index % roles.length;
  const role = roles[roleIndex];
  const company = demoCompanies[companyIndex];
  const sampleNumber = String(index + 1).padStart(2, '0');
  const title = `Demo ${role.title} - Sample ${sampleNumber}`;
  return {
    id: `demo-internship-${sampleNumber}`,
    title,
    companyId: company.id,
    companyName: company.name,
    field: role.field,
    skills: role.skills,
    city: null,
    state: null,
    mode: null,
    durationMonths: null,
    stipendMin: null,
    stipendMax: null,
    isPaid: null,
    eligibility: null,
    companyType: 'Program',
    applyUrl: null,
    source: null,
    sourceUrl: null,
    verified: false,
    lastVerified: null,
    deadline: null,
    description: 'Fictional demo record for demonstrating SkillBridge filters. This is not a real opening and has no application link.',
    searchTokens: [...title.split(/\s+/), ...company.name.split(/\s+/), ...role.skills],
    isDemo: true
  };
});

await writeJson('data/seed/companies.json', [...companies, ...demoCompanies]);
await writeJson('data/seed/internships.json', [...internships, ...demoInternships]);
console.log(`Built demo seed data: ${companies.length + demoCompanies.length} companies and ${internships.length + demoInternships.length} internships.`);
