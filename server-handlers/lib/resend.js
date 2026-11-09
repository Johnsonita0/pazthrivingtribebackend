import { buildPazEmailTemplate } from './paz-email-template.js';

let footerSettingsCache = null;
let footerSettingsCacheExpiresAt = 0;

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

  const brandedHtml = await applyFooterSettings(ensureBrandedHtml({ html, subject, text }));

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

async function applyFooterSettings(html) {
  if (!html || !html.includes('data-paz-footer-note="true"')) return html;
  const now = Date.now();
  if (footerSettingsCacheExpiresAt > now) {
    return replaceEmailFooterSettings(html, footerSettingsCache);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('Email footer settings were not loaded because Supabase server credentials are unavailable.');
    return html;
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/tribe_site_settings?setting_key=eq.footer&select=setting_value&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase returned status ${response.status}`);
    }

    const rows = await response.json();
    const value = Array.isArray(rows) ? rows[0]?.setting_value : null;
    footerSettingsCache = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    footerSettingsCacheExpiresAt = now + 30_000;
    return replaceEmailFooterSettings(html, footerSettingsCache);
  } catch (error) {
    console.error('Failed to load shared footer settings for email:', error);
    footerSettingsCache = null;
    footerSettingsCacheExpiresAt = now + 5_000;
    return html;
  }
}

function replaceEmailFooterSettings(html, settings) {
  if (!settings) return html;
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const note = typeof settings.emailFooterNote === 'string' && settings.emailFooterNote.trim()
    ? settings.emailFooterNote.trim()
    : '';
  const email = typeof settings.contactEmail === 'string' && settings.contactEmail.trim()
    ? settings.contactEmail.trim()
    : '';
  const phone = typeof settings.contactPhone === 'string' && settings.contactPhone.trim()
    ? settings.contactPhone.trim()
    : '';
  const brandName = typeof settings.brandName === 'string' && settings.brandName.trim()
    ? settings.brandName.trim()
    : '';
  let updated = html;

  if (brandName) {
    updated = updated.replace(
      /<div data-paz-footer-brand="true"[^>]*>[\s\S]*?<\/div>/,
      (match) => match.replace(/>[\s\S]*<\/div>$/, `>${escapeHtml(brandName)}</div>`)
    );
  }
  if (note) {
    updated = updated.replace(
      /<div data-paz-footer-note="true">[\s\S]*?<\/div>/,
      `<div data-paz-footer-note="true">${escapeHtml(note)}</div>`
    );
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    updated = updated.replace(
      /<div data-paz-footer-contact="true">[\s\S]*?<\/div>/,
      (match) => match.replace(/mailto:[^"]+/, `mailto:${escapeHtml(email)}`).replace(/>[^<]+<\/a>/, `>${escapeHtml(email)}</a>`)
    );
  }
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const internationalDigits = digits.startsWith('0') ? `234${digits.slice(1)}` : digits;
    if (internationalDigits) {
      updated = updated.replace(
        /<div data-paz-footer-contact="true">[\s\S]*?<\/div>/,
        (match) => match.replace(/https:\/\/wa\.me\/\d+/, `https://wa.me/${internationalDigits}`).replace(/>[^<]+<\/a><\/div>$/, `>${escapeHtml(phone)}</a></div>`)
      );
    }
  }
  return updated;
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
