import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

const json = (res, status, body) => {
  if (typeof res.status === 'function') return res.status(status).json(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const requestBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const isChangeRequest = requestBody.event === 'change_requested';

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { error: 'Your vendor session has expired. Please sign in again.' });
  if (!supabaseUrl || !serviceRoleKey || !process.env.RESEND_API_KEY) {
    return json(res, 500, { error: 'Security email service is not configured.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json(res, 401, { error: 'Your vendor session has expired. Please sign in again.' });

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('contact_email,company_name')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (vendorError) throw vendorError;

    const recipient = String(vendor?.contact_email || userData.user.email || '').trim().toLowerCase();
    if (!vendor || !validEmail(recipient)) return json(res, 404, { error: 'A valid vendor email could not be found.' });

    const vendorName = String(vendor.company_name || 'there').trim() || 'there';
    const appUrl = String(process.env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/$/, '');
    const subject = isChangeRequest ? 'Confirm your PAZ vendor PIN change' : 'Your PAZ vendor PIN was changed';
    const html = buildPazEmailTemplate({
      title: subject,
      eyebrow: 'Vendor account security',
      intro: `Hi ${vendorName},`,
      accentText: isChangeRequest ? 'A request was made to change your 4-digit vendor PIN.' : 'Your 4-digit vendor PIN was successfully changed.',
      bodyHtml: isChangeRequest
        ? '<p>The PIN change screen is ready for your authenticated vendor session.</p><p>If you did not request this change, do not continue and change your account password immediately.</p>'
        : '<p>This security update was completed from your PAZ vendor settings.</p><p>Your PIN is never included in email. If you did not make this change, sign in and change your PIN again immediately.</p>',
      ctaLabel: isChangeRequest ? 'Reset vendor PIN' : 'Open vendor dashboard',
      ctaUrl: `${appUrl}/vendor${isChangeRequest ? '?reset_pin=1' : ''}`,
      showSecondaryCta: false,
      footerNote: isChangeRequest ? 'Continue only if you requested this PIN change.' : 'Keep your vendor password and PIN private.',
    });
    await sendResendEmail({
      to: recipient,
      subject,
      html,
      text: isChangeRequest
        ? `Hi ${vendorName},\n\nA request was made to change your PAZ vendor PIN. Reset it here only if you requested this change: ${appUrl}/vendor?reset_pin=1`
        : `Hi ${vendorName},\n\nYour PAZ vendor PIN was successfully changed. If you did not make this change, sign in and change your PIN again immediately.\n\nOpen your vendor dashboard: ${appUrl}/vendor`,
      from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Vendor PIN change email failed:', error);
    return json(res, 500, { error: error.message || 'The PIN change email could not be sent.' });
  }
}
