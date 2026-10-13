import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(payload);
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const { to, name, registrationType, programType, childrenCount, hearAboutUs, note } = req.body || {};

  if (!to) {
    return sendJson(res, 400, { error: 'Missing recipient email' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanEmail = String(to).trim().toLowerCase();
  if (!emailRegex.test(cleanEmail)) {
    return sendJson(res, 400, { error: 'Invalid recipient email address' });
  }

  try {
    const emailHTML = buildPazEmailTemplate({
      title: 'Registration received',
      eyebrow: 'Application received',
      intro: `Hi ${name || 'there'},`,
      accentText: `Thank you for submitting your registration for the ${programType || 'Paz Thriving Teens Academy'} program.`,
      bodyHtml: `
        <p>We have received your request and will review it shortly.</p>
        <p>A member of our team will contact you soon with the next steps and orientation details.</p>
        <p><strong>Registration type:</strong> ${registrationType || 'Not specified'}</p>
        <p><strong>Program:</strong> ${programType || 'Thriving Teens Academy'}</p>
        <p><strong>Children:</strong> ${childrenCount || 1}</p>
        <p><strong>Source:</strong> ${hearAboutUs || 'Website'}</p>
        <p><strong>Note:</strong> ${note || 'No additional details'}</p>
      `,
      ctaLabel: 'Apply for a section',
      ctaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/teens_reg`,
      secondaryCtaLabel: 'Book for a section',
      secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/book-session`,
      footerNote: 'We are excited to journey with you.'
    });

    await sendResendEmail({
      to: cleanEmail,
      subject: 'Your registration request has been received - PAZ Thriving Tribe',
      html: emailHTML,
      text: `Hi ${name || 'there'},\n\nThank you for submitting your registration...`,
      from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org'
    });

    console.log(`✓ Resend registration confirmation sent to: ${cleanEmail}`);

    return sendJson(res, 200, {
      success: true,
      message: 'Registration confirmation email sent successfully.',
      data: {
        email: cleanEmail,
        sentAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Registration email sending failed:', error);
    return sendJson(res, 500, {
      error: 'Unable to send the confirmation email right now.',
      details: error.message || 'Unknown email error'
    });
  }
}
