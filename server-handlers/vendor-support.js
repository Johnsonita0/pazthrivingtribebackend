import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';

const json = (res, status, body) => res.status(status).json(body);
const adminEmails = () => [...new Set([process.env.ADMIN_EMAILS, process.env.VITE_ADMIN_EMAILS, 'pazthrivingtribe@gmail.com'].flatMap((value) => String(value || '').split(',')).map((value) => value.trim().toLowerCase()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { error: 'Sign in to contact customer care.' });
  const message = String(req.body?.message || '').trim();
  if (!message) return json(res, 400, { error: 'A support message is required.' });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY) return json(res, 500, { error: 'Support notifications are not configured.' });
  try {
    const supabase = createClient(url, key);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json(res, 401, { error: 'Your session has expired. Please sign in again.' });
    const user = userData.user;
    const { data: vendor } = await supabase.from('vendor_profiles').select('company_name,contact_email').eq('id', user.id).maybeSingle();
    const senderEmail = String(user.email || '').toLowerCase();
    const recipients = [...new Set([...adminEmails(), vendor?.contact_email].filter(Boolean))];
    const { error: insertError } = await supabase.from('vendor_support_messages').insert({ vendor_id: user.id, sender_email: senderEmail, message, status: 'open' });
    if (insertError) throw insertError;
    await sendResendEmail({ to: recipients, subject: `Vendor support message${vendor?.company_name ? ` from ${vendor.company_name}` : ''}`, html: `<p>A new vendor support message requires attention.</p><p><strong>Vendor:</strong> ${vendor?.company_name || 'Unregistered vendor'}</p><p><strong>Email:</strong> ${senderEmail}</p><p><strong>Message:</strong><br>${message.replace(/\n/g, '<br>')}</p>`, text: `Vendor support message from ${vendor?.company_name || senderEmail}: ${message}`, from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org' });
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Vendor support notification failed:', error);
    return json(res, 500, { error: 'The support message could not be sent.' });
  }
}
