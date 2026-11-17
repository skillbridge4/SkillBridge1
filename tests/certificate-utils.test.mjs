import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createCertificateId,
  createCertificateSignature,
  gradeQuiz,
  isPathComplete,
  isValidCertificateId,
  quizAttemptsAllowed,
  validatePaths,
  verifyCertificateSignature
} from '../server/certificate-utils.js';

const [paths, videos, courses] = await Promise.all([
  readFile(new URL('../data/seed/paths.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/seed/videos.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/seed/courses.json', import.meta.url), 'utf8').then(JSON.parse)
]);

test('all learning path catalog references and quiz data validate', () => {
  assert.deepEqual(validatePaths(paths, videos, courses), []);
});

test('path completion requires each required video and course declaration', () => {
  const path = paths[0];
  assert.equal(isPathComplete(path, ['prep-113'], ['crs-01']), false);
  assert.equal(isPathComplete(path, ['prep-113'], ['crs-01', 'crs-02']), true);
  assert.equal(isPathComplete(path, [], ['crs-01', 'crs-02']), false);
  assert.equal(isPathComplete(path, undefined, ['crs-01', 'crs-02']), false);
});

test('quiz grading returns score and post-attempt explanations', () => {
  const questions = [{ id: 'one', options: [{ id: 'x', text: 'Correct' }], correctOptionId: 'x', explanation: 'Reason', topicTags: ['Basics'] }];
  const result = gradeQuiz(questions, { one: 'x' });
  assert.equal(result.score, 100);
  assert.equal(result.results[0].explanation, 'Reason');
  assert.throws(() => gradeQuiz(questions, {}), /Answer every quiz question/);
  assert.throws(() => gradeQuiz(questions, { other: 'x' }), /Answer every quiz question/);
  assert.throws(() => gradeQuiz(questions, { one: 'invalid' }), /Select a valid option/);
});

test('quiz attempt limit counts only attempts in the last 24 hours', () => {
  const now = 100_000_000;
  const day = 24 * 60 * 60 * 1000;
  assert.equal(quizAttemptsAllowed([now - day - 1, now - 20, now - 10], now), true);
  assert.equal(quizAttemptsAllowed([now - 20, now - 10, now], now), false);
});

test('certificate IDs include a validated checksum', () => {
  const id = createCertificateId(2026, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  assert.match(id, /^SB-2026-[A-HJ-NP-Z2-9]{12}-[A-HJ-NP-Z2-9]{2}$/);
  assert.equal(isValidCertificateId(id), true);
  assert.equal(isValidCertificateId(`${id.slice(0, -1)}A`), false);
});

test('certificate signatures detect changes to signed fields', () => {
  const record = {
    certId: 'SB-2026-ABCDEFGH-JK', uid: 'user-id', recipientName: 'Sam',
    pathId: 'path', pathTitle: 'Path title', issuedAt: '2026-11-11T00:00:00.000Z',
    score: 80, hours: 10, issuer: 'SkillBridge', status: 'valid'
  };
  const secret = 'a-test-secret-longer-than-thirty-two-characters';
  record.signature = createCertificateSignature(record, secret);
  assert.equal(verifyCertificateSignature(record, secret), true);
  assert.equal(verifyCertificateSignature({ ...record, score: 90 }, secret), false);
  assert.throws(() => createCertificateSignature(record, 'short'), /at least 32/);
});
