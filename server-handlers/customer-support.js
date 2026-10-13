import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';

const adminEmails = () => [...new Set([process.env.ADMIN_EMAILS, process.env.VITE_ADMIN_EMAILS, 'pazthrivingtribe@gmail.com'].flatMap((value) => String(value || '').split(',')).map((value) => value.trim().toLowerCase()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
const json = (res, status, payload) => res.status(status).json(payload);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const subject = String(req.body?.subject || '').trim().slice(0, 160);
  const message = String(req.body?.message || '').trim().slice(0, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || !message) return json(res, 400, { error: 'Name, valid email, subject, and message are required.' });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY) return json(res, 500, { error: 'Support notifications are not configured.' });
  try {
    const supabase = createClient(url, key);
    const savedMessage = `Subject: ${subject}\n\n${message}`;
    const { error: insertError } = await supabase.from('customer_support_messages').insert({ sender_name: name, sender_email: email, message: savedMessage, status: 'open' });
    if (insertError) throw insertError;
    const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    await sendResendEmail({ to: adminEmails(), subject: `${subject} — ${name}`, html: `<p>A customer sent a new support message.</p><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Subject:</strong> ${escapeHtml(subject)}</p><p><strong>Message:</strong><br>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>`, text: `Customer care message from ${name} (${email})\nSubject: ${subject}\n\n${message}`, from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org' });
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Customer support notification failed:', error);
    return json(res, 500, { error: 'The support message could not be sent.' });
  }
}
