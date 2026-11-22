import { auth, isFirebaseConfigured } from './firebase.js';

const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const DISCLAIMER = 'This certificate shows completion of a SkillBridge learning path. It is not an accredited qualification.';
const GUEST_SESSION_KEY = 'skillbridge_guest_learning_session';

export async function certificateRequest(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (isFirebaseConfigured() && auth?.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const response = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export function getGuestLearningSessionId() {
  let sessionId = localStorage.getItem(GUEST_SESSION_KEY);
  if (!sessionId) {
    if (!globalThis.crypto?.randomUUID) throw new Error('A secure browser session ID could not be created.');
    sessionId = globalThis.crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, sessionId);
  }
  return sessionId;
}

export function certificateVerificationUrl(certId) {
  return new URL(`/verify/${encodeURIComponent(certId)}`, window.location.origin).href;
}

export async function downloadCertificateImage(certificate) {
  const canvas = await renderCertificateCanvas(certificate);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not render certificate image.')), 'image/png');
  });
  downloadBlob(blob, `${certificate.certId}.png`);
}

export async function downloadCertificatePdf(certificate) {
  const canvas = await renderCertificateCanvas(certificate);
  const png = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not render the certificate for PDF.')), 'image/png');
  });
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.create();
  const page = document.addPage([841.89, 595.28]);
  const image = await document.embedPng(await png.arrayBuffer());
  page.drawImage(image, { x: 0, y: 0, width: 841.89, height: 595.28 });
  downloadBlob(new Blob([await document.save()], { type: 'application/pdf' }), `${certificate.certId}.pdf`);
}

export async function certificatePreviewDataUrl(certificate) {
  const canvas = await renderCertificateCanvas(certificate);
  return canvas.toDataURL('image/png');
}

export function shareCertificateOnLinkedIn(certificate) {
  const issued = new Date(certificate.issuedAt);
  const query = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: `SkillBridge - ${certificate.pathTitle}`,
    organizationName: 'SkillBridge',
    issueYear: String(issued.getFullYear()),
    issueMonth: String(issued.getMonth() + 1),
    certId: certificate.certId,
    certUrl: certificateVerificationUrl(certificate.certId)
  });
  window.open(`https://www.linkedin.com/profile/add?${query}`, '_blank', 'noopener,noreferrer');
}

async function renderCertificateCanvas(certificate) {
  const canvas = document.createElement('canvas');
  canvas.width = 1754;
  canvas.height = 1240;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Certificate image rendering is unavailable in this browser.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#17324d';
  context.lineWidth = 12;
  context.strokeRect(45, 45, canvas.width - 90, canvas.height - 90);
  context.strokeStyle = '#c99d46';
  context.lineWidth = 3;
  context.strokeRect(66, 66, canvas.width - 132, canvas.height - 132);

  context.fillStyle = '#17324d';
  context.beginPath();
  context.arc(canvas.width / 2, 148, 42, Math.PI, 0);
  context.lineTo(canvas.width / 2 + 42, 155);
  context.lineTo(canvas.width / 2 - 42, 155);
  context.closePath();
  context.fill();
  context.fillStyle = '#c99d46';
  context.fillRect(canvas.width / 2 - 52, 158, 104, 8);

  context.textAlign = 'center';
  context.fillStyle = '#17324d';
  context.font = 'bold 42px system-ui, sans-serif';
  context.fillText('SKILLBRIDGE', canvas.width / 2, 226);
  context.fillStyle = '#32465a';
  context.font = 'bold 62px Georgia, serif';
  context.fillText('Certificate of Completion', canvas.width / 2, 333);
  context.fillStyle = '#526171';
  context.font = '30px system-ui, sans-serif';
  context.fillText('This certificate is awarded to', canvas.width / 2, 414);
  context.fillStyle = '#17324d';
  context.font = 'bold 58px system-ui, sans-serif';
  drawFittedText(context, certificate.recipientName, canvas.width / 2, 502, 1400);
  context.strokeStyle = '#c99d46';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(280, 532);
  context.lineTo(canvas.width - 280, 532);
  context.stroke();
  context.fillStyle = '#526171';
  context.font = '28px system-ui, sans-serif';
  context.fillText('for completing the SkillBridge learning path', canvas.width / 2, 592);
  context.fillStyle = '#17324d';
  context.font = 'bold 42px system-ui, sans-serif';
  drawFittedText(context, certificate.pathTitle, canvas.width / 2, 654, 1400);

  const issueDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(certificate.issuedAt));
  context.fillStyle = '#32465a';
  context.font = '26px system-ui, sans-serif';
  context.fillText(`Issued ${issueDate}   •   Score ${certificate.score}%   •   ${certificate.hours} learning hours`, canvas.width / 2, 731);
  context.font = '22px system-ui, sans-serif';
  context.fillText(`Certificate ID: ${certificate.certId}`, canvas.width / 2, 778);
  context.fillStyle = '#6b7280';
  context.font = '19px system-ui, sans-serif';
  context.fillText(DISCLAIMER, canvas.width / 2, 1095);
  context.fillText('Issued by SkillBridge', canvas.width / 2, 1130);

  const { default: QRCode } = await import('qrcode');
  const qrDataUrl = await QRCode.toDataURL(certificateVerificationUrl(certificate.certId), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 190,
    color: { dark: '#17324d', light: '#ffffff' }
  });
  const qr = await loadImage(qrDataUrl);
  context.drawImage(qr, canvas.width - 292, canvas.height - 292, 190, 190);
  context.textAlign = 'right';
  context.font = '16px system-ui, sans-serif';
  context.fillStyle = '#526171';
  context.fillText('Scan to verify', canvas.width - 83, canvas.height - 79);
  return canvas;
}

function drawFittedText(context, text, x, y, maxWidth) {
  const value = String(text || '');
  let fontSize = 58;
  while (fontSize > 28) {
    context.font = `bold ${fontSize}px system-ui, sans-serif`;
    if (context.measureText(value).width <= maxWidth) break;
    fontSize -= 2;
  }
  context.fillText(value, x, y, maxWidth);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not create certificate verification QR code.'));
    image.src = source;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
