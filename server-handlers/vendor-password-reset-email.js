import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

const json = (res, status, body) => res.status(status).json(body);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { error: 'Your vendor session has expired. Please sign in again.' });
  if (!supabaseUrl || !serviceRoleKey || !process.env.RESEND_API_KEY) {
    return json(res, 500, { error: 'Password email service is not configured.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json(res, 401, { error: 'Your vendor session has expired. Please sign in again.' });

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id,contact_email,company_name')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (vendorError) throw vendorError;

    const recipient = String(vendor?.contact_email || userData.user.email || '').trim().toLowerCase();
    if (!vendor || !validEmail(recipient)) return json(res, 404, { error: 'A valid vendor email could not be found.' });

    const appUrl = String(process.env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/$/, '');
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: recipient,
      options: { redirectTo: `${appUrl}/vendor?reset=1` },
    });
    if (linkError) throw linkError;

    const recoveryLink = linkData?.properties?.action_link;
    if (!recoveryLink) throw new Error('Supabase did not return a password recovery link.');

    const vendorName = String(vendor.company_name || 'there').trim() || 'there';
    const subject = 'Reset your PAZ vendor password';
    const html = buildPazEmailTemplate({
      title: subject,
      eyebrow: 'Vendor account security',
      intro: `Hi ${vendorName},`,
      accentText: 'Use the secure button below to choose a new password for your vendor account.',
      bodyHtml: '<p>This password reset link was requested from your PAZ vendor settings. It can only be used to update your own vendor account.</p><p>If you did not request this change, you can safely ignore this email.</p>',
      ctaLabel: 'Reset vendor password',
      ctaUrl: recoveryLink,
      showSecondaryCta: false,
      footerNote: 'This secure link will take you back to your PAZ vendor account.',
    });
    await sendResendEmail({
      to: recipient,
      subject,
      html,
      text: `Hi ${vendorName},\n\nReset your PAZ vendor password here:\n${recoveryLink}\n\nIf you did not request this change, you can ignore this email.`,
      from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Vendor password reset email failed:', error);
    return json(res, 500, { error: error.message || 'The password reset email could not be sent. kindly contact admin' });
  }
}
