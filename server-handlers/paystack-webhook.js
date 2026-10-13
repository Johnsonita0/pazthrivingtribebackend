import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  if (Buffer.isBuffer(req.body)) return req.body;
  return Buffer.from(JSON.stringify(req.body || {}));
}

function isValidSignature(req, rawBody, secret) {
  const signature = req.headers['x-paystack-signature'];
  if (!secret || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const received = Buffer.from(signature, 'utf8');
  const calculated = Buffer.from(expected, 'utf8');
  return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET;
  const rawBody = getRawBody(req);
  if (!secret || !isValidSignature(req, rawBody, secret)) {
    return sendJson(res, 401, { error: 'Invalid Paystack signature' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody.toString('utf8'));
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON payload' });
  }

  if (payload.event !== 'charge.success') return sendJson(res, 200, { received: true });

  const data = payload.data || {};
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return sendJson(res, 500, { error: 'Server database configuration is missing' });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const orderNumber = data.metadata?.orderNumber || data.metadata?.order_number || data.reference;
  const { error } = await supabase
    .from('shop_orders')
    .update({ status: 'paid', payment_reference: data.reference || null })
    .or(`order_number.eq.${orderNumber},payment_reference.eq.${data.reference}`);

  if (error) {
    console.error('Paystack webhook order update failed:', error);
    return sendJson(res, 500, { error: 'Unable to update the order' });
  }

  return sendJson(res, 200, { received: true });
}
