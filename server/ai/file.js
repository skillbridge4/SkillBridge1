import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

export function validateResumeFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw httpError(400, 'Choose a PDF or DOCX resume file.');
  }
  if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) {
    throw httpError(413, 'Resume files must be 2 MB or smaller.');
  }
  const extension = file.originalname?.split('.').pop()?.toLowerCase();
  const bytes = file.buffer;
  if (extension === 'pdf'
    && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (extension === 'docx'
    && bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b
    && bytes[2] === 0x03 && bytes[3] === 0x04) return 'docx';
  throw httpError(400, 'File type and file signature do not match. Choose a valid PDF or DOCX file.');
}

export async function extractResumeText(file) {
  const type = validateResumeFile(file);
  let text;
  let parser;
  let parseFailed = false;
  try {
    if (type === 'pdf') {
      parser = new PDFParse({ data: file.buffer });
      const parsed = await parser.getText();
      text = parsed.text;
    } else {
      const parsed = await mammoth.extractRawText({ buffer: file.buffer });
      text = parsed.value;
    }
  } catch {
    parseFailed = true;
  }
  if (parser) {
    try {
      await parser.destroy();
    } catch {
      parseFailed = true;
    }
  }
  if (parseFailed) throw httpError(400, 'The file could not be read. It may be encrypted, damaged, or invalid.');
  return validateResumeText(text);
}

export function validateResumeText(value) {
  if (typeof value !== 'string') throw httpError(400, 'Paste resume text or upload a valid file.');
  const text = value.replace(/\u0000/g, '').trim();
  if (text.length > MAX_TEXT_CHARS) {
    throw httpError(413, 'The extracted resume text is too long. Keep it under 20,000 characters.');
  }
  if (text.length < 20) {
    throw httpError(400, 'No selectable resume text was found. Scanned or empty files are not supported; paste readable text instead.');
  }
  return text;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
