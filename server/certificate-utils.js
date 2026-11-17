import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { COURSE_LEVELS, FIELDS } from '../client/src/constants.js';

const CERT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CERT_ID_PATTERN = /^SB-\d{4}-[A-HJ-NP-Z2-9]{12}-[A-HJ-NP-Z2-9]{2}$/;
const SIGNED_FIELDS = [
  'certId', 'uid', 'recipientName', 'pathId', 'pathTitle',
  'issuedAt', 'score', 'hours', 'issuer', 'status',
  'showScorePublicly', 'revocationReason', 'publicDisplayConsent'
];

export function createCertificateId(year = new Date().getUTCFullYear(), random = randomBytes(12)) {
  if (!Buffer.isBuffer(random) || random.length < 12) {
    throw new TypeError('Certificate ID generation requires at least 60 random bits.');
  }
  let encoded = '';
  for (let index = 0; index < 12; index += 1) encoded += CERT_ID_ALPHABET[random[index] & 31];
  const prefix = `SB-${year}-${encoded}`;
  const checksum = checksumFor(prefix);
  return `${prefix}-${checksum}`;
}

export function isValidCertificateId(certId) {
  if (typeof certId !== 'string' || !CERT_ID_PATTERN.test(certId)) return false;
  const parts = certId.split('-');
  return checksumFor(parts.slice(0, 3).join('-')) === parts[3];
}

export function createCertificateSignature(record, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new TypeError('CERTIFICATE_HMAC_SECRET must contain at least 32 characters.');
  }
  const payload = SIGNED_FIELDS.map(field => `${field}:${String(record[field] ?? '')}`).join('\n');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyCertificateSignature(record, secret) {
  if (typeof record?.signature !== 'string' || !/^[a-f0-9]{64}$/.test(record.signature)) return false;
  const expected = createCertificateSignature(record, secret);
  return timingSafeEqual(Buffer.from(record.signature, 'hex'), Buffer.from(expected, 'hex'));
}

export function gradeQuiz(questions, answers) {
  if (!Array.isArray(questions) || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new TypeError('Quiz questions and submitted answers are required.');
  }
  const questionIds = new Set(questions.map(question => question.id));
  if (questionIds.size !== questions.length
    || Object.keys(answers).length !== questions.length
    || Object.keys(answers).some(questionId => !questionIds.has(questionId))) {
    throw new TypeError('Answer every quiz question exactly once.');
  }
  let correct = 0;
  const results = questions.map(question => {
    const selectedOptionId = answers[question.id];
    if (!question.options.some(option => option.id === selectedOptionId)) {
      throw new TypeError('Select a valid option for every quiz question.');
    }
    const isCorrect = selectedOptionId === question.correctOptionId;
    if (isCorrect) correct += 1;
    return {
      questionId: question.id,
      isCorrect,
      correctAnswer: question.options.find(option => option.id === question.correctOptionId)?.text || '',
      explanation: question.explanation,
      topicTags: question.topicTags
    };
  });
  const score = Math.round((correct / questions.length) * 100);
  return { score, correct, total: questions.length, results };
}

export function isPathComplete(path, watchedVideoIds, declaredCourseIds) {
  if (!path || !Array.isArray(path.items)
    || !Array.isArray(watchedVideoIds) || !Array.isArray(declaredCourseIds)) return false;
  const watched = new Set(watchedVideoIds);
  const declared = new Set(declaredCourseIds);
  return path.items.filter(item => item.required).every(item => (
    item.type === 'video' ? watched.has(item.id)
      : item.type === 'course' ? declared.has(item.id)
        : false
  ));
}

export function validatePaths(paths, videos, courses) {
  const errors = [];
  const pathIds = new Set();
  const videoIds = new Set(videos.map(item => item.id));
  const courseIds = new Set(courses.map(item => item.id));
  for (const path of paths) {
    if (pathIds.has(path.id)) errors.push(`Duplicate learning path ID: ${path.id}`);
    pathIds.add(path.id);
    if (!FIELDS.includes(path.field)) errors.push(`${path.id}: unknown field ${path.field}.`);
    if (!COURSE_LEVELS.includes(path.level)) errors.push(`${path.id}: unknown level ${path.level}.`);
    if (!Array.isArray(path.items) || path.items.length === 0) errors.push(`${path.id}: items must be a non-empty array.`);
    if (!Array.isArray(path.requiredItems)) errors.push(`${path.id}: requiredItems must be an array.`);
    const itemIds = new Set();
    for (const item of path.items || []) {
      if (itemIds.has(item.id)) errors.push(`${path.id}: duplicate item ${item.id}.`);
      itemIds.add(item.id);
      if (item.type === 'video' && !videoIds.has(item.id)) errors.push(`${path.id}: unknown video ${item.id}.`);
      else if (item.type === 'course' && !courseIds.has(item.id)) errors.push(`${path.id}: unknown course ${item.id}.`);
      else if (!['video', 'course'].includes(item.type)) errors.push(`${path.id}: unknown item type ${item.type}.`);
    }
    if (path.items?.some(item => item.required && !path.requiredItems?.includes(item.id))) {
      errors.push(`${path.id}: requiredItems does not include every required item.`);
    }
    if (path.requiredItems?.some(id => !itemIds.has(id))) errors.push(`${path.id}: requiredItems contains an unknown item.`);
    if (!Number.isInteger(path.passMark) || path.passMark < 1 || path.passMark > 100) {
      errors.push(`${path.id}: passMark must be from 1 to 100.`);
    }
    if (!Number.isInteger(path.estimatedHours) || path.estimatedHours < 1) {
      errors.push(`${path.id}: estimatedHours must be a positive integer.`);
    }
    const questions = path.quiz?.questions;
    if (!Array.isArray(questions) || questions.length < 10 || questions.length > 15) {
      errors.push(`${path.id}: quiz must contain 10-15 questions.`);
    }
    const questionIds = new Set();
    for (const question of questions || []) {
      if (questionIds.has(question.id)) errors.push(`${path.id}: duplicate question ${question.id}.`);
      questionIds.add(question.id);
      if (typeof question.prompt !== 'string' || !question.prompt.trim()
        || !Array.isArray(question.options) || question.options.length < 2
        || question.options.some(option => typeof option !== 'string' || !option.trim())
        || new Set(question.options).size !== question.options.length
        || !Number.isInteger(question.correctIndex)
        || question.correctIndex < 0 || question.correctIndex >= question.options.length) {
        errors.push(`${path.id}: invalid answer options for ${question.id}.`);
      }
      if (!question.explanation || !Array.isArray(question.topicTags) || !question.topicTags.length) {
        errors.push(`${path.id}: explanation and topicTags are required for ${question.id}.`);
      }
    }
  }
  return errors;
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function quizAttemptsAllowed(timestamps, now = Date.now(), limit = 3, windowMs = 24 * 60 * 60 * 1000) {
  if (!Array.isArray(timestamps)) return false;
  return timestamps.filter(timestamp => Number.isFinite(timestamp) && timestamp > now - windowMs).length < limit;
}

function checksumFor(prefix) {
  let checksum = 0;
  for (const character of prefix) checksum = (checksum * 31 + character.charCodeAt(0)) % (CERT_ID_ALPHABET.length ** 2);
  return CERT_ID_ALPHABET[Math.floor(checksum / CERT_ID_ALPHABET.length)]
    + CERT_ID_ALPHABET[checksum % CERT_ID_ALPHABET.length];
}
