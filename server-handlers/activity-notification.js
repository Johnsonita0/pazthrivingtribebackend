import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const adminEmails = () => [...new Set([globalThis.process?.env?.ADMIN_EMAILS, globalThis.process?.env?.VITE_ADMIN_EMAILS, 'pazthrivingtribe@gmail.com']
  .flatMap((value) => String(value || '').split(','))
  .map((value) => value.trim().toLowerCase())
  .filter((value) => emailPattern.test(value)))];
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const json = (res, status, payload) => res.status(status).json(payload);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const type = String(req.body?.type || '').trim();
  const title = String(req.body?.title || '').trim();
  const details = req.body?.details && typeof req.body.details === 'object' ? req.body.details : {};
  if (!type || !title) return json(res, 400, { error: 'Activity type and title are required.' });

  const detailRows = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
    .join('');
  try {
    const emailHtml = buildPazEmailTemplate({
      title,
      eyebrow: 'Portal activity alert',
      intro: 'Hello PAZ team,',
      accentText: 'A new activity was submitted on the PAZ website.',
      bodyHtml: `<p><strong>Activity:</strong> ${escapeHtml(type)}</p>${detailRows}`,
      ctaLabel: 'Open admin dashboard',
      ctaUrl: `${globalThis.process?.env?.VITE_APP_URL || 'https://pazthrivingtribe.org'}/admin`,
      showSecondaryCta: false,
      footerNote: 'Internal activity notification for PAZ Thriving Tribe.'
    });
    await sendResendEmail({
      to: adminEmails(),
      subject: `PAZ activity: ${title}`,
      html: emailHtml,
      text: `A new PAZ website activity was submitted.\n\nActivity: ${type}\n${Object.entries(details).map(([label, value]) => `${label}: ${value}`).join('\n')}`,
      from: globalThis.process?.env?.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org'
    });
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Activity notification failed:', error);
    return json(res, 500, { error: 'The admin activity notification could not be sent.' });
  }
}