import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterInternships, matchesSearch, normalizeSearchText, sortInternships } from '../client/src/services/search.js';

const catalog = JSON.parse(await readFile(new URL('../data/seed/internships.json', import.meta.url), 'utf8'));
const fixtures = [
  { id: 'a', title: 'Machine Learning Engineer Intern', companyName: 'Zoho', field: 'Data & AI', skills: ['Python', 'ML'], city: 'Chennai', state: 'Tamil Nadu', mode: 'Hybrid', durationMonths: 3, stipendMin: 15000, stipendMax: 20000, isPaid: true, companyType: 'Startup', eligibility: 'Undergraduate', verified: true, deadline: '2026-11-14', lastVerified: '2026-11-09', searchTokens: ['machine', 'learning', 'zoho', 'chennai'] },
  { id: 'b', title: 'Frontend Web Developer', companyName: 'Freshworks', field: 'Software Engineering', skills: ['JavaScript'], city: 'Chennai', state: 'Tamil Nadu', mode: 'Remote', durationMonths: 6, stipendMin: null, stipendMax: null, isPaid: null, companyType: 'Startup', eligibility: 'Any student', verified: false, deadline: null, lastVerified: null, searchTokens: ['frontend', 'web', 'developer', 'freshworks'] },
  { id: 'c', title: 'Software Development Engineer', companyName: 'TCS', field: 'Software Engineering', skills: ['Java', 'SQL'], city: 'Mumbai', state: 'Maharashtra', mode: 'On-site', durationMonths: 2, stipendMin: 5000, stipendMax: 8000, isPaid: false, companyType: 'MNC', eligibility: 'Graduate', verified: true, deadline: '2026-11-30', lastVerified: '2026-11-08', searchTokens: ['software', 'development', 'engineer', 'tcs', 'mumbai'] },
  { id: 'd', title: 'Cloud Operations Intern', companyName: 'Cisco India', field: 'Cloud & DevOps', skills: ['Linux'], city: 'Bengaluru', state: 'Karnataka', mode: 'Hybrid', durationMonths: 4, stipendMin: 30000, stipendMax: 40000, isPaid: true, companyType: 'MNC', eligibility: 'Undergraduate', verified: false, deadline: '2026-11-12', lastVerified: '2026-11-10', searchTokens: ['cloud', 'operations', 'cisco', 'bengaluru'] },
  { id: 'e', title: 'Research Assistant', companyName: 'IISc', field: 'Research', skills: ['Python'], city: 'Bengaluru', state: 'Karnataka', mode: 'On-site', durationMonths: null, stipendMin: 25000, stipendMax: null, isPaid: true, companyType: 'Research', eligibility: 'Graduate', verified: false, deadline: '2026-12-01', lastVerified: '2026-11-05', searchTokens: ['research', 'assistant', 'iisc'] }
];
const aliasFixtures = [
  { title: 'Embedded systems intern', field: 'Electronics & Embedded', skills: ['Embedded Systems'] },
  { title: 'Civil engineering intern', field: 'Civil Engineering', skills: [] },
  { title: 'Core engineering intern', field: 'Core Engineering', skills: [] },
  { title: 'Research intern', field: 'Research', skills: [] }
];

const cases = [];
function test(name, assertion) {
  try {
    assertion();
    cases.push({ name, passed: true });
  } catch (error) {
    cases.push({ name, passed: false, error });
  }
}

for (const [query, expected] of [
  [' ML ', 'a'], ['ai', 'a'], ['blr', 'd'], ['bangalore', 'd'],
  ['hyd', null], ['gurgaon', null], ['bombay', 'c'], ['web dev', 'b'],
  ['sde', 'c'], ['govt', null], ['psu', null], ['frontend', 'b'],
  ['devops', 'd'], ['ncr', null], ['ZoHo', 'a'], ['cisco!', 'd']
]) {
  test(`alias/search: ${query}`, () => {
    const matches = fixtures.filter(record => matchesSearch(record, query));
    if (expected) assert.ok(matches.some(record => record.id === expected));
    else assert.equal(matches.length, 0);
  });
}

for (const [query, record] of [
  ['embedded', aliasFixtures[0]],
  ['civil', aliasFixtures[1]],
  ['core', aliasFixtures[2]],
  ['research', aliasFixtures[3]]
]) {
  test(`alias/search: ${query}`, () => assert.ok(matchesSearch(record, query)));
}

const filters = [
  ['field', { field: 'Data & AI' }, ['a']],
  ['state', { state: 'Tamil Nadu' }, ['a', 'b']],
  ['city', { city: 'Mumbai' }, ['c']],
  ['mode', { mode: 'Remote' }, ['b']],
  ['duration', { duration: 2 }, ['c']],
  ['paid', { paid: 'paid' }, ['a', 'd', 'e']],
  ['unpaid', { paid: 'unpaid' }, ['c']],
  ['unknown pay', { paid: 'unknown' }, ['b']],
  ['company type', { companyType: 'MNC' }, ['c', 'd']],
  ['eligibility', { eligibility: 'Graduate' }, ['c', 'e']],
  ['verified only', { verifiedOnly: true }, ['a', 'c']],
  ['deadline soon', { deadlineSoon: true }, ['a', 'd']],
  ['stipend range', { stipendRange: '10000-25000' }, ['a', 'e']],
  ['unmatched filter', { state: 'Kerala' }, []],
  ['AND filters', { state: 'Tamil Nadu', mode: 'Remote' }, ['b']],
  ['company and field', { companyType: 'MNC', field: 'Cloud & DevOps' }, ['d']],
  ['empty query', { q: '' }, ['a', 'b', 'c', 'd', 'e']],
  ['non-matching query', { q: 'no such result' }, []]
];

for (const [name, filter, expected] of filters) {
  test(`filter: ${name}`, () => {
    assert.deepEqual(filterInternships(fixtures, filter, new Date('2026-11-10T12:00:00')).map(item => item.id).sort(), [...expected].sort());
  });
}

for (const [value, expected] of [
  ['Hello, WORLD!', 'hello world'], [' ML ', 'ml'], ['New Delhi / India', 'new delhi india'],
  ['Zoho & Freshworks', 'zoho freshworks'], ['Café', 'cafe'], ['', '']
]) {
  test(`normalization: ${value}`, () => assert.equal(normalizeSearchText(value), expected));
}

test('null stipend, deadline, and verified values do not crash filters', () => {
  assert.deepEqual(filterInternships(fixtures, { stipendRange: 'over-25000' }).map(item => item.id), ['d']);
  assert.deepEqual(filterInternships(fixtures, { deadlineSoon: true }, new Date('2026-11-10')).map(item => item.id), ['a', 'd']);
  assert.equal(filterInternships(fixtures, { verifiedOnly: true }).length, 2);
});

test('sorting keeps unknown values last', () => {
  assert.deepEqual(sortInternships(fixtures, 'stipend').map(item => item.id), ['d', 'e', 'a', 'c', 'b']);
  assert.deepEqual(sortInternships(fixtures, 'deadline').map(item => item.id), ['d', 'a', 'c', 'e', 'b']);
  assert.ok(sortInternships(fixtures, 'relevance', 'machine learning')[0].id === 'a');
});

for (let index = 0; index < 12; index += 1) {
  test(`empty data handling ${index + 1}`, () => {
    assert.deepEqual(filterInternships([], { field: 'Data & AI', q: 'ml' }), []);
  });
}

for (const record of catalog) {
  const recordId = record.id;
  const recordResult = (filters = {}) => filterInternships(catalog, filters).some(item => item.id === recordId);
  test(`catalog title search: ${record.id}`, () => assert.ok(matchesSearch(record, record.title)));
  test(`catalog company search: ${record.id}`, () => assert.ok(matchesSearch(record, record.companyName)));
  for (const word of normalizeSearchText(record.title).split(' ')) {
    test(`catalog title token ${word}: ${record.id}`, () => assert.ok(matchesSearch(record, word)));
  }
  if (record.field) {
    test(`catalog field search: ${record.id}`, () => assert.ok(matchesSearch(record, record.field)));
    test(`catalog field filter: ${record.id}`, () => assert.ok(recordResult({ field: record.field })));
  }
  if (record.skills.length) {
    test(`catalog skill search: ${record.id}`, () => assert.ok(matchesSearch(record, record.skills[0])));
  }
  test(`catalog company type search: ${record.id}`, () => assert.ok(matchesSearch(record, record.companyType)));
  test(`catalog company type filter: ${record.id}`, () => assert.ok(recordResult({ companyType: record.companyType })));
  test(`catalog work mode filter: ${record.id}`, () => {
    if (record.mode) assert.ok(recordResult({ mode: record.mode }));
    else assert.equal(recordResult({ mode: 'Remote' }), record.mode === 'Remote');
  });
  test(`catalog paid status filter: ${record.id}`, () => {
    const paidFilter = record.isPaid === true ? 'paid' : record.isPaid === false ? 'unpaid' : 'unknown';
    assert.ok(recordResult({ paid: paidFilter }));
  });
  test(`catalog verified-only filter: ${record.id}`, () => {
    assert.equal(recordResult({ verifiedOnly: true }), record.verified === true);
  });
  test(`catalog deadline filter: ${record.id}`, () => {
    if (record.deadline == null) assert.equal(recordResult({ deadlineSoon: true }), false);
  });
  test(`catalog stipend filter: ${record.id}`, () => {
    if (record.stipendMin == null && record.stipendMax == null) {
      assert.equal(recordResult({ stipendRange: 'under-10000' }), false);
    }
  });
}

for (const [query, expectedId] of [['govt', 'pm-internship-scheme'], ['psu', 'pm-internship-scheme'], ['sde', 'google-summer-of-code']]) {
  test(`catalog alias ${query}`, () => assert.ok(catalog.some(record => record.id === expectedId && matchesSearch(record, query))));
}

const failed = cases.filter(item => !item.passed);
for (const item of cases) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${cases.length - failed.length}/${cases.length} passed; ${failed.length} failed.`);
if (failed.length) process.exitCode = 1;
