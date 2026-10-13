import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getProductAvailability } from './lib/productAvailability.js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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

  const email = String(body.email || '').trim().toLowerCase();
  const customerName = String(body.customerName || '').trim().slice(0, 120);
  const orderNumber = String(body.orderNumber || '').trim().slice(0, 80);
  const paymentMethod = body.paymentMethod === undefined ? 'card' : String(body.paymentMethod);
  const items = Array.isArray(body.items) ? body.items : [];
  const authorization = req.headers?.authorization || req.headers?.Authorization || '';
  const accessToken = /^Bearer\s+(.+)$/i.exec(String(authorization))?.[1] || '';
  if (!['card', 'bank_transfer'].includes(paymentMethod)) {
    return sendJson(res, 400, { error: 'Choose a supported payment method.' });
  }
  if (!accessToken) return sendJson(res, 401, { error: 'Sign in to a confirmed PAZ customer account before checkout.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !customerName || !orderNumber || !items.length) {
    return sendJson(res, 400, { error: 'A valid name, email, order number, and cart are required.' });
  }

  const normalizedItems = items.map((item) => ({
    id: String(item.id || '').trim(),
    quantity: Number(item.quantity)
  }));
  if (normalizedItems.some((item) => !item.id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
    return sendJson(res, 400, { error: 'The cart contains an invalid item or quantity.' });
  }

  const env = globalThis.process?.env || {};
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const paystackSecret = env.PAYSTACK_SECRET_KEY || env.PAYSTACK_SECRET;
  if (!supabaseUrl || !serviceRoleKey || !paystackSecret) {
    return sendJson(res, 500, { error: 'Secure checkout is not configured on the server.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const customer = authData?.user;
    if (authError || !customer) return sendJson(res, 401, { error: 'Your customer session is invalid or expired. Sign in again.' });
    if (!customer.email_confirmed_at || String(customer.email || '').toLowerCase() !== email) {
      return sendJson(res, 403, { error: 'Confirm your account and use its email address for digital delivery.' });
    }
    const productIds = [...new Set(normalizedItems.map((item) => item.id))];
    const { data: products, error: productsError } = await supabase
      .from('store_products')
      .select('id,title,price,currency,is_free,status,vendor_id,in_stock,stock_count,release_enabled,release_at,close_at,allow_after_close')
      .in('id', productIds);
    if (productsError) throw productsError;

    const productsById = new Map((products || []).map((product) => [String(product.id), product]));
    const cart = normalizedItems.map((item) => ({ ...item, product: productsById.get(item.id) }));
    if (cart.some(({ product }) => !product || !(product.status === 'published' || (!product.vendor_id && product.status === 'approved')))) {
      return sendJson(res, 400, { error: 'One or more products are no longer available.' });
    }
    if (cart.some(({ product }) => product.is_free)) {
      return sendJson(res, 400, { error: 'Free products do not need payment checkout.' });
    }
    const unavailableItem = cart.find(({ product, quantity }) =>
      !getProductAvailability(product, Date.now()).available
      || product.in_stock === false
      || Number(product.stock_count || 0) < quantity
    );
    if (unavailableItem) {
      const availability = getProductAvailability(unavailableItem.product, Date.now());
      return sendJson(res, 409, { error: availability.available ? `${unavailableItem.product.title} is out of stock.` : availability.message });
    }

    const currencies = [...new Set(cart.map(({ product }) => String(product.currency || 'NGN').toUpperCase()))];
    if (currencies.length !== 1) {
      return sendJson(res, 400, { error: 'Products with different currencies must be purchased separately.' });
    }
    const currency = currencies[0];
    const amount = cart.reduce((total, { product, quantity }) => total + Number(product.price || 0) * quantity, 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, { error: 'The cart total is invalid.' });
    }

    const reference = `PAZ-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const siteUrl = String(env.VITE_APP_URL || 'https://www.pazthrivingtribe.org').replace(/\/+$/, '');
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency,
        reference,
        channels: [paymentMethod],
        callback_url: `${siteUrl}/mobile-payment-return.html`,
        metadata: {
          order_number: orderNumber,
          customer_name: customerName,
          customer_id: customer.id,
          source: 'paz-shop-mobile-app',
          custom_fields: [
            { display_name: 'Customer name', variable_name: 'customer_name', value: customerName },
            { display_name: 'Order number', variable_name: 'order_number', value: orderNumber }
          ]
        }
      })
    });
    const paystackResult = await paystackResponse.json().catch(() => ({}));
    if (!paystackResponse.ok || paystackResult.status !== true || !paystackResult.data?.authorization_url) {
      console.error('Mobile Paystack initialization failed:', paystackResult.message || paystackResponse.status);
      return sendJson(res, 502, { error: 'Secure payment could not be started. Please try again.' });
    }

    return sendJson(res, 200, {
      authorizationUrl: paystackResult.data.authorization_url,
      reference: paystackResult.data.reference || reference,
      orderNumber,
      currency,
      amount
    });
  } catch (error) {
    console.error('Mobile checkout initialization failed:', error);
    return sendJson(res, 500, { error: 'Secure checkout could not be started.' });
  }
}