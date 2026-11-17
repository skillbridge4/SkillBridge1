import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readCatalog(name) {
  const value = JSON.parse(readFileSync(resolve(root, 'data', 'seed', name), 'utf8'));
  if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string')) {
    throw new TypeError(`The ${name} catalog must contain records with IDs.`);
  }
  return value;
}

export const catalogs = {
  courses: readCatalog('courses.json'),
  videos: readCatalog('videos.json'),
  internships: readCatalog('internships.json')
};
