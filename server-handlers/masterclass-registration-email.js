import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function getAdminEmails() {
  const configured = [process.env.ADMIN_EMAILS, process.env.VITE_ADMIN_EMAILS, 'pazthrivingtribe@gmail.com'];
  return [...new Set(configured.flatMap((value) => String(value || '').split(',')).map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (error) {
      return sendJson(res, 400, { error: 'Invalid JSON payload.' });
    }
  }

  const name = String(body.name || '').trim();
  const email = cleanEmail(body.email);
  const phone = String(body.phone || '').trim();
  const referenceNumber = String(body.referenceNumber || '').trim() || `PAZ-MC-${Date.now().toString().slice(-6)}`;

  if (!name || !email || !phone) {
    return sendJson(res, 400, { error: 'Name, email, and phone are required.' });
  }

  try {
    const customerHtml = buildPazEmailTemplate({
      title: 'Masterclass registration confirmed',
      eyebrow: 'Registration received',
      intro: `Hi ${name},`,
      accentText: `Your reference number is ${referenceNumber}.`,
      bodyHtml: `
        <p>Thank you for registering for the PAZ Parent Masterclass, “Getting Your Teenager to Speak to You”.</p>
        <p><strong>Reference number:</strong> ${referenceNumber}</p>
        <p><strong>Event:</strong> Parent Masterclass</p>
        <p><strong>Date:</strong> ${body.date || 'Saturday, 21 November 2026'}</p>
        <p><strong>Time:</strong> ${body.time || '10:00 AM - 11:30 AM'}</p>
        <p><strong>Venue:</strong> ${body.venue || 'Online · Google Meet'}</p>
        <p><strong>Fee:</strong> ${body.amount || '₦10,000'}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p>Kindly complete your payment and send your payment proof on WhatsApp after registering. We will contact you with the joining details.</p>
      `,
      ctaLabel: 'Open WhatsApp payment chat',
      ctaUrl: 'https://wa.me/2348037383820',
      secondaryCtaLabel: 'Visit PAZ website',
      secondaryCtaUrl: process.env.VITE_APP_URL || 'https://pazthrivingtribe.org',
      footerNote: 'Thank you for joining the PAZ community.'
    });

    const adminHtml = buildPazEmailTemplate({
      title: 'New parent masterclass registration',
      eyebrow: 'New registration',
      intro: 'Hello PAZ team,',
      accentText: `A new parent masterclass registration has come in.`,
      bodyHtml: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Reference number:</strong> ${referenceNumber}</p>
        <p><strong>Event:</strong> Parent Masterclass</p>
        <p><strong>Fee:</strong> ${body.amount || '₦10,000'}</p>
        <p><strong>Date:</strong> ${body.date || 'Saturday, 21 November 2026'}</p>
        <p><strong>Time:</strong> ${body.time || '10:00 AM - 11:30 AM'}</p>
        <p><strong>Venue:</strong> ${body.venue || 'Online · Google Meet'}</p>
      `,
      ctaLabel: 'Open admin dashboard',
      ctaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/admin`,
      secondaryCtaLabel: 'View masterclass list',
      secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/admin`,
      footerNote: 'Internal PAZ notification.'
    });

    const adminRecipients = getAdminEmails();

    await Promise.all([
      sendResendEmail({
        to: email,
        subject: `Parent Masterclass registration confirmed - ${referenceNumber} | PAZ Thriving Tribe`,
        html: customerHtml,
        text: `Hi ${name},\n\nYour parent masterclass registration is confirmed. Your reference number is ${referenceNumber}. Please keep this for payment and follow-up. Date: ${body.date || 'Saturday, 21 November 2026'} | Time: ${body.time || '10:00 AM - 11:30 AM'} | Venue: ${body.venue || 'Online · Google Meet'} | Fee: ${body.amount || '₦10,000'}.`
      }),
      ...adminRecipients.map((adminEmail) => sendResendEmail({
        to: adminEmail,
        subject: `New Parent Masterclass registration - ${referenceNumber}`,
        html: adminHtml,
        text: `New parent masterclass registration for ${name} (${email}). Reference: ${referenceNumber}. Phone: ${phone}.`
      }))
    ]);

    return sendJson(res, 200, {
      success: true,
      referenceNumber,
      message: 'Masterclass registration email sent to the registrant and admin team.'
    });
  } catch (error) {
    console.error('Masterclass registration email failed:', error);
    return sendJson(res, 500, {
      error: 'Unable to send the registration email right now.',
      details: error?.message || 'Unknown email error'
    });
  }
}
