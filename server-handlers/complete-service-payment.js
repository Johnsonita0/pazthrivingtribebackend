import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

const ADMIN_EMAIL = 'pazthrivingtribe@gmail.com';
const SERVICE_PRICE_NGN = 30000;

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function getDetails(type, details = {}) {
  return {
    registration_type: details.registration_type || '', parent_or_guardian_name: details.parent_or_guardian_name || '',
    full_name: details.full_name || details.parent_or_guardian_name || '', email: details.email,
    phone: details.phone || '', home_address: details.home_address || '', children_count: Number(details.children_count || 1),
    source: details.source || 'Website registration', children_details: details.children_details || [],
    notes: details.notes || '', track: details.track || '', payment_reference: details.payment_reference,
    payment_status: 'paid'
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'Invalid JSON body.' }); }
  }

  const type = body.type === 'registration' ? 'registration' : '';
  const email = cleanEmail(body.email || body.details?.email);
  const reference = String(body.reference || '').trim();
  if (!type || !email || !reference) return sendJson(res, 400, { error: 'A service type, valid email, and Paystack reference are required.' });

  const secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabaseUrl || !serviceRoleKey || !process.env.RESEND_API_KEY) {
    return sendJson(res, 500, { error: 'Service payment is not configured on the server.' });
  }

  try {
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const verifyData = await verifyResponse.json().catch(() => ({}));
    const transaction = verifyData?.data;
    if (!verifyResponse.ok || verifyData?.status !== true || transaction?.status !== 'success') return sendJson(res, 402, { error: 'Paystack could not confirm this payment.' });
    if (Number(transaction.amount) !== SERVICE_PRICE_NGN * 100 || transaction.currency !== 'NGN') return sendJson(res, 402, { error: 'The PTTA onboarding payment amount must be exactly ₦30,000.' });

    const details = getDetails(type, { ...(body.details || {}), email, payment_reference: reference });
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: saved, error } = await supabase.from('tribe_applicants').insert(details).select('id').single();
    if (error) throw error;

    const serviceName = 'PTTA Onboarding';
    const name = details.parent_or_guardian_name || details.full_name || 'Customer';
    const html = buildPazEmailTemplate({ title: `${serviceName} payment confirmed`, eyebrow: 'Payment confirmed', intro: `Hi ${name},`, accentText: `Your ${serviceName.toLowerCase()} payment of ₦${SERVICE_PRICE_NGN.toLocaleString('en-NG')} was received successfully.`, bodyHtml: `<p>Your onboarding registration has been submitted and our team will contact you with the next steps.</p><p><strong>Paystack reference:</strong> ${reference}</p><p><strong>Service:</strong> ${serviceName}</p>`, ctaLabel: 'Visit PAZ Thriving Tribe', ctaUrl: process.env.VITE_APP_URL || 'https://pazthrivingtribe.org', footerNote: 'Thank you for choosing PAZ Thriving Tribe.' });
    const adminHtml = buildPazEmailTemplate({ title: `${serviceName} payment received`, eyebrow: 'New paid service request', intro: 'Hello PAZ team,', accentText: `A ${serviceName.toLowerCase()} request has been paid.`, bodyHtml: `<p><strong>Customer:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Amount:</strong> ₦${SERVICE_PRICE_NGN.toLocaleString('en-NG')}</p><p><strong>Reference:</strong> ${reference}</p>`, ctaLabel: 'Open admin dashboard', ctaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/admin`, showSecondaryCta: true, secondaryCtaLabel: 'Payment history', secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/dashboard?view=payment-history&reference=${encodeURIComponent(reference)}`, footerNote: 'Internal notification for PAZ Thriving Tribe.' });
    await Promise.all([
      sendResendEmail({ to: email, subject: `${serviceName} payment confirmed - PAZ Thriving Tribe`, html, text: `Your ${serviceName.toLowerCase()} payment of ₦${SERVICE_PRICE_NGN.toLocaleString('en-NG')} was received. Reference: ${reference}` }),
      sendResendEmail({ to: ADMIN_EMAIL, subject: `${serviceName} paid - ${name}`, html: adminHtml, text: `${serviceName} paid by ${name} (${email}). Reference: ${reference}` })
    ]);
    return sendJson(res, 200, { success: true, id: saved?.id, paymentReference: reference, amount: SERVICE_PRICE_NGN });
  } catch (error) {
    console.error('Service payment completion failed:', error);
    return sendJson(res, 500, { error: 'Payment was verified, but the service request could not be completed.', details: error.message });
  }
}