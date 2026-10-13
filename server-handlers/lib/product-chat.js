import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import process from 'node:process';
import { sendResendEmail } from './resend.js';

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export function getAdminEmails() {
  return [...new Set([
    process.env.ADMIN_EMAILS,
    process.env.VITE_ADMIN_EMAILS,
    'pazthrivingtribe@gmail.com'
  ].flatMap((value) => String(value || '').split(',')).map(normalizeEmail).filter((email) => validEmail.test(email)))];
}

export function getReplyToAddress(token) {
  const domain = String(process.env.RESEND_INBOUND_DOMAIN || '').trim().replace(/^@/, '').toLowerCase();
  return domain && /^[a-z0-9.-]+$/.test(domain) ? `chat+${token}@${domain}` : undefined;
}

function tokenEncryptionKey() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Product chat token encryption is not configured.');
  return createHash('sha256').update(serviceKey).digest();
}

export function encryptProductChatToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptProductChatToken(value) {
  const [ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Product chat token is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', tokenEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

export function getProductChatUrl(productTitle, token) {
  const slug = String(productTitle || 'product').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
  const appUrl = String(process.env.VITE_APP_URL || 'https://www.pazthrivingtribe.org').replace(/\/$/, '');
  const productUrl = `${appUrl}/shop/${encodeURIComponent(slug)}`;
  return token ? `${productUrl}#chat=${encodeURIComponent(token)}` : productUrl;
}

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export async function sendProductChatEmail({ to, subject, heading, conversation, senderName, senderEmail, message, token, replyToken }) {
  const chatUrl = getProductChatUrl(conversation.product_title, token);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');
  const recipientIsCustomer = to.length === 1 && normalizeEmail(to[0]) === normalizeEmail(conversation.customer_email);
  const privacyNote = recipientIsCustomer
    ? '<p>A copy of this product conversation is visible to PAZ support so the team can help oversee the discussion.</p>'
    : '';
  return sendResendEmail({
    to,
    subject,
    replyTo: getReplyToAddress(replyToken),
    html: `<p>${escapeHtml(heading)}</p><p><strong>Product:</strong> ${escapeHtml(conversation.product_title)}</p><p><strong>From:</strong> ${escapeHtml(senderName)} (${escapeHtml(senderEmail)})</p><p><strong>Message:</strong><br>${safeMessage}</p>${privacyNote}<p><a href="${escapeHtml(chatUrl)}">${token ? 'Open this conversation' : 'View this product'}</a></p>`,
    text: `${heading}\n\nProduct: ${conversation.product_title}\nFrom: ${senderName} (${senderEmail})\n\n${message}\n\n${recipientIsCustomer ? 'A copy of this product conversation is visible to PAZ support so the team can help oversee the discussion.\n\n' : ''}${token ? 'Open this conversation' : 'View this product'}: ${chatUrl}`,
    from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
    name: 'PAZ Marketplace'
  });
}

export { validEmail };