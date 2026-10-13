import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

const reminderIntervalMs = 12 * 60 * 60 * 1000;
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function productRoute(product) {
  const slug = String(product.title || product.id || 'product')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `/shop?product=${encodeURIComponent(slug || product.id)}&app=1`;
}

function adminRecipients(env) {
  return [...new Set([
    env.ADMIN_EMAILS,
    env.VITE_ADMIN_EMAILS,
    'pazthrivingtribe@gmail.com'
  ]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

async function sendPendingAdminNotifications(supabase, env, now) {
  const staleClaimBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const { data: pendingNotifications, error } = await supabase
    .from('product_release_notifications')
    .select('id,product_id,product_title,email,customer_name,phone,release_at')
    .is('admin_notification_sent_at', null)
    .or(`admin_notification_claimed_at.is.null,admin_notification_claimed_at.lt.${staleClaimBefore}`)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  const recipients = adminRecipients(env);
  for (const notification of pendingNotifications || []) {
    const { data: claimed, error: claimError } = await supabase
      .from('product_release_notifications')
      .update({ admin_notification_claimed_at: now.toISOString() })
      .eq('id', notification.id)
      .is('admin_notification_sent_at', null)
      .or(`admin_notification_claimed_at.is.null,admin_notification_claimed_at.lt.${staleClaimBefore}`)
      .select('id')
      .maybeSingle();
    if (claimError) {
      failed += 1;
      console.error('Could not claim release signup admin notification:', claimError);
      continue;
    }
    if (!claimed) continue;

    const releaseLabel = new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(notification.release_at));
    const productUrl = `${(env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/$/, '')}${productRoute({ id: notification.product_id, title: notification.product_title })}`;
    const subject = `Release notification signup — ${notification.product_title}`;
    const html = buildPazEmailTemplate({
      title: 'A customer activated a release alert',
      eyebrow: 'New product notification',
      intro: 'Hello PAZ team,',
      accentText: 'A customer asked to be notified when a scheduled product opens for checkout.',
      bodyHtml: `<p><strong>Product:</strong> ${escapeHtml(notification.product_title)}</p><p><strong>Release time:</strong> ${escapeHtml(releaseLabel)} WAT</p><p><strong>Customer:</strong> ${escapeHtml(notification.customer_name)}</p><p><strong>Email:</strong> ${escapeHtml(notification.email)}</p><p><strong>Phone:</strong> ${escapeHtml(notification.phone || 'Not provided')}</p>`,
      productName: notification.product_title,
      ctaLabel: 'Open product',
      ctaUrl: productUrl,
      footerNote: 'This customer was added to the scheduled product release notification list.'
    });

    try {
      await sendResendEmail({
        to: recipients,
        subject,
        html,
        text: `A customer activated a release alert. Product: ${notification.product_title}. Release: ${releaseLabel} WAT. Customer: ${notification.customer_name} (${notification.email}). Phone: ${notification.phone || 'Not provided'}. Product page: ${productUrl}`
      });
      const { error: markSentError } = await supabase
        .from('product_release_notifications')
        .update({ admin_notification_sent_at: new Date().toISOString(), admin_notification_claimed_at: null })
        .eq('id', notification.id)
        .is('admin_notification_sent_at', null);
      if (markSentError) throw markSentError;
      sent += 1;
    } catch (sendError) {
      failed += 1;
      console.error('Release signup admin email failed:', sendError);
      await supabase.from('product_release_notifications')
        .update({ admin_notification_claimed_at: null })
        .eq('id', notification.id)
        .is('admin_notification_sent_at', null);
    }
  }
  return { sent, failed };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });

  const env = globalThis.process?.env || {};
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return sendJson(res, 401, { error: 'Unauthorized.' });
  }

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey || !env.RESEND_API_KEY) {
    return sendJson(res, 500, { error: 'Release email delivery is not configured.' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date();
  let adminNotifications;
  try {
    adminNotifications = await sendPendingAdminNotifications(supabase, env, now);
  } catch (error) {
    console.error('Could not load pending release signup admin notifications:', error);
    return sendJson(res, 500, { error: 'Could not load pending admin notifications.' });
  }
  const { data: dueNotifications, error: dueError } = await supabase
    .from('product_release_notifications')
    .select('id,product_id,email,customer_name,release_at,notification_count')
    .eq('status', 'active')
    .lte('next_notification_at', now.toISOString())
    .order('next_notification_at', { ascending: true })
    .limit(100);
  if (dueError) {
    console.error('Could not load due release notifications:', dueError);
    return sendJson(res, 500, { error: 'Could not load due release notifications.' });
  }

  let sent = adminNotifications.sent;
  let failed = adminNotifications.failed;
  for (const notification of dueNotifications || []) {
    const { data: product, error: productError } = await supabase
      .from('store_products')
      .select('id,title,status,vendor_id')
      .eq('id', notification.product_id)
      .maybeSingle();
    if (productError) {
      failed += 1;
      console.error('Could not load product for release notification:', productError);
      continue;
    }
    if (!product || !(product.status === 'published' || (!product.vendor_id && product.status === 'approved'))) {
      await supabase.from('product_release_notifications')
        .update({ status: 'completed', next_notification_at: null })
        .eq('id', notification.id)
        .eq('status', 'active');
      continue;
    }

    const count = Number(notification.notification_count || 0);
    if (count >= 3) {
      await supabase.from('product_release_notifications')
        .update({ status: 'completed', next_notification_at: null })
        .eq('id', notification.id)
        .eq('status', 'active');
      continue;
    }

    const nextCount = count + 1;
    const releaseTime = new Date(notification.release_at).getTime();
    const nextTime = nextCount < 3 ? new Date(releaseTime + nextCount * reminderIntervalMs).toISOString() : null;
    const { data: claimed, error: claimError } = await supabase
      .from('product_release_notifications')
      .update({
        notification_count: nextCount,
        next_notification_at: nextTime,
        status: nextCount === 3 ? 'completed' : 'active'
      })
      .eq('id', notification.id)
      .eq('status', 'active')
      .eq('notification_count', count)
      .select('id')
      .maybeSingle();
    if (claimError) {
      failed += 1;
      console.error('Could not claim release notification:', claimError);
      continue;
    }
    if (!claimed) continue;

    const productUrl = `${(env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/$/, '')}${productRoute(product)}`;
    const subject = count === 0
      ? `${product.title} is now available`
      : `${product.title} is waiting for you`;
    const message = count === 0
      ? `${product.title} is now open for checkout.`
      : `${product.title} is still available. This is your ${count === 1 ? '12-hour' : '24-hour'} reminder.`;
    const html = buildPazEmailTemplate({
      title: subject,
      eyebrow: 'Product release',
      intro: `Hello ${escapeHtml(notification.customer_name)},`,
      accentText: message,
      bodyHtml: `<p>You asked us to let you know when <strong>${escapeHtml(product.title)}</strong> became available.</p><p>Open the product page to review it and go straight to checkout.</p>`,
      productName: product.title,
      ctaLabel: 'View product and checkout',
      ctaUrl: productUrl,
      footerNote: 'You are receiving this because you activated a release notification for this product.'
    });

    try {
      await sendResendEmail({
        to: notification.email,
        subject,
        html,
        text: `${message}\n\nGo to the product and checkout: ${productUrl}`
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error('Release notification email failed:', error);
      await supabase.from('product_release_notifications')
        .update({
          notification_count: count,
          next_notification_at: new Date(releaseTime + count * reminderIntervalMs).toISOString(),
          status: 'active'
        })
        .eq('id', notification.id)
        .eq('notification_count', nextCount);
    }
  }

  return sendJson(res, failed ? 500 : 200, { sent, failed });
}