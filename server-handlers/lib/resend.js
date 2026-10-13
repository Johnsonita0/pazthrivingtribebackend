import { buildPazEmailTemplate } from './paz-email-template.js';

function normalizeRecipients(recipients) {
  const list = (Array.isArray(recipients) ? recipients : [recipients])
    .filter(Boolean)
    .map((email) => String(email).trim().toLowerCase())
    .filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))

  return [...new Set(list)];
}

export async function sendResendEmail({
  to,
  subject,
  html,
  text,
  from = process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
  replyTo,
  name = 'PAZ Thriving Tribe',
  attachments = []
}) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('Resend API key is not configured.');
  }

  const recipients = normalizeRecipients(to);
  if (!recipients.length) {
    throw new Error('No valid recipients available after filtering blocked addresses.');
  }

  const brandedHtml = ensureBrandedHtml({ html, subject, text });

  const normalizedAttachments = await Promise.all((attachments || []).map(async (attachment) => {
    if (!attachment) return null;

    if (attachment.content && attachment.filename) {
      return {
        filename: attachment.filename,
        content: String(attachment.content)
      };
    }

    if (attachment.url && attachment.filename) {
      try {
        if (String(attachment.url).startsWith('data:')) {
          const [meta, encoded] = String(attachment.url).split(',', 2);
          const isBase64 = meta.includes(';base64');
          return {
            filename: attachment.filename,
            content: isBase64 ? String(encoded || '') : Buffer.from(decodeURIComponent(encoded || '')).toString('base64')
          };
        }

        const fileResponse = await fetch(attachment.url);
        if (!fileResponse.ok) {
          console.warn(`Skipping attachment because the file could not be fetched: ${attachment.url}`);
          return null;
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return {
          filename: attachment.filename,
          content: buffer.toString('base64')
        };
      } catch (fetchError) {
        console.warn(`Skipping attachment because fetching failed: ${attachment.url}`, fetchError.message || fetchError);
        return null;
      }
    }

    return null;
  }));

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: `${name} <${from}>`,
      to: recipients,
      subject,
      html: brandedHtml || undefined,
      text: text || (brandedHtml ? stripHtml(brandedHtml) : undefined),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(normalizedAttachments.length ? { attachments: normalizedAttachments.filter(Boolean) } : {})
    })
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      responseBody?.message ||
      responseBody?.error ||
      `Resend request failed with status ${response.status}`
    );
  }

  return responseBody;
}

function ensureBrandedHtml({ html, subject, text }) {
  if (!html) return '';
  const source = String(html);
  if (source.includes('max-width:640px') && source.includes('PAZ Thriving Tribe')) return source;

  return buildPazEmailTemplate({
    title: subject || 'PAZ Thriving Tribe notification',
    eyebrow: 'PAZ Thriving Tribe',
    intro: 'Hello,',
    accentText: '',
    bodyHtml: source,
    ctaLabel: 'Visit the PAZ website',
    ctaUrl: process.env.VITE_APP_URL || 'https://pazthrivingtribe.org',
    showSecondaryCta: false,
    footerNote: text ? 'This message was sent by PAZ Thriving Tribe.' : 'We are here to help your growth journey.'
  });
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
