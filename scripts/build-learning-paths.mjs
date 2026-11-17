import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePaths } from '../server/certificate-utils.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [paths, videos, courses] = await Promise.all([
  readFile(resolve(root, 'data/seed/paths.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'data/seed/videos.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'data/seed/courses.json'), 'utf8').then(JSON.parse)
]);
const errors = validatePaths(paths, videos, courses);
if (errors.length) {
  console.error(`Learning path generation failed (${errors.length} errors):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  const publicPaths = paths.map(({ quiz, ...path }) => ({
    ...path,
    questionCount: quiz.questions.length
  }));
  await writeFile(
    resolve(root, 'public/learning-paths.json'),
    `${JSON.stringify(publicPaths, null, 2)}\n`
  );
  console.log(`Generated answer-free metadata for ${publicPaths.length} learning paths.`);
}
