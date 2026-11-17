import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(root, 'data/seed/internships.json');
const aliasesPath = resolve(root, 'client/src/constants.js');
const internships = JSON.parse(await readFile(catalogPath, 'utf8'));
await readFile(aliasesPath, 'utf8');

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

for (const internship of internships) {
  internship.searchTokens = [...new Set([
    internship.title,
    internship.companyName,
    internship.field,
    internship.city,
    internship.state,
    ...(internship.skills || [])
  ].flatMap(value => normalize(value).split(' ').filter(Boolean)))];
}

await writeFile(catalogPath, `${JSON.stringify(internships, null, 2)}\n`);
console.log(`Generated search tokens for ${internships.length} internships.`);
