import { createClient } from '@supabase/supabase-js';
import { getProductAvailability } from './lib/productAvailability.js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: 'Invalid request body.' });
    }
  }

  const productId = String(body.productId || '').trim();
  const email = cleanEmail(body.email);
  const name = String(body.name || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  if (!productId || !email || !name) {
    return sendJson(res, 400, { error: 'A valid name, email, and product are required.' });
  }

  const env = globalThis.process?.env || {};
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: 'Release notifications are not configured on the server.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: product, error: productError } = await supabase
      .from('store_products')
      .select('id,title,status,vendor_id,release_enabled,release_at')
      .eq('id', productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || !(product.status === 'published' || (!product.vendor_id && product.status === 'approved'))) {
      return sendJson(res, 404, { error: 'This product is no longer available.' });
    }
    if (!product.release_enabled || !product.release_at || getProductAvailability(product).reason !== 'not-released') {
      return sendJson(res, 409, { error: 'This product is already available or does not have a scheduled release.' });
    }

    const { error: insertError } = await supabase
      .from('product_release_notifications')
      .upsert({
        product_id: product.id,
        product_title: product.title,
        email,
        customer_name: name,
        phone,
        release_at: product.release_at,
        next_notification_at: product.release_at,
        notification_count: 0,
        status: 'active'
      }, { onConflict: 'product_id,email', ignoreDuplicates: true });
    if (insertError) throw insertError;

    return sendJson(res, 200, { success: true });
  } catch (error) {
    console.error('Product release notification signup failed:', error);
    return sendJson(res, 500, { error: 'Your notification could not be saved. Please try again.' });
  }
}