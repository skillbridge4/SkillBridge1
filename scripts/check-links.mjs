import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = resolve(root, 'reports/link-report.json');
const inputs = [
  'data/seed/companies.json',
  'data/seed/internships.json',
  'data/seed/courses.json',
  'data/seed/videos.json'
];
const urls = new Set();
for (const file of inputs) {
  const records = JSON.parse(await readFile(resolve(root, file), 'utf8'));
  for (const record of records) {
    for (const value of Object.values(record)) {
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) continue;
      try {
        new URL(value);
        urls.add(value);
      } catch {
        urls.add(value);
      }
    }
  }
}

const targets = [...urls];
const results = new Array(targets.length);
let nextIndex = 0;

async function requestUrl(url) {
  let reason = 'request failed';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      let response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'SkillBridge-LinkChecker/1.0' }
      });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'user-agent': 'SkillBridge-LinkChecker/1.0', range: 'bytes=0-0' }
        });
      }
      const status = response.status >= 400 ? `${response.status >= 500 ? '5xx' : '4xx'}` : response.redirected ? 'redirect' : 'OK';
      return { url, status, statusCode: response.status, finalUrl: response.url };
    } catch (error) {
      reason = error.name === 'AbortError' ? 'timeout' : error.message;
      if (error.name === 'AbortError') return { url, status: 'timeout', reason };
      if (attempt < 2) await new Promise(resolveDelay => setTimeout(resolveDelay, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  return { url, status: 'error', reason };
}

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= targets.length) return;
    results[index] = await requestUrl(targets[index]);
  }
}

await Promise.all(Array.from({ length: Math.min(6, targets.length) }, () => worker()));
await mkdir(dirname(reportPath), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  counts: Object.fromEntries(['OK', 'redirect', '4xx', '5xx', 'timeout', 'error']
    .map(status => [status, results.filter(result => result.status === status).length])),
  links: results
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Link check: ${report.total} unique URLs; ${JSON.stringify(report.counts)}.`);
