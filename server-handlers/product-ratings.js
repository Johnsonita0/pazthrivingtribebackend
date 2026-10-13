import { createClient } from '@supabase/supabase-js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let body = req.body || {};
  if (req.method === 'POST' && typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: 'Invalid request body.' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const productId = String(req.method === 'GET'
    ? req.query?.productId || requestUrl.searchParams.get('productId') || ''
    : body.productId || '').trim();
  if (!productId || productId.length > 150) {
    return sendJson(res, 400, { error: 'A valid product ID is required.' });
  }

  const env = globalThis.process?.env || {};
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: 'Product ratings are not configured.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('product_ratings')
        .select('id,product_id,reviewer_name,rating,comment,created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      res.setHeader?.('Cache-Control', 'no-store');
      return sendJson(res, 200, { data: data || [] });
    }

    const reviewerName = String(body.reviewerName || '').trim().slice(0, 120);
    const reviewerEmail = String(body.reviewerEmail || '').trim().toLowerCase().slice(0, 254);
    const rating = Number(body.rating);
    const comment = String(body.comment || '').trim().slice(0, 3000);
    if (!reviewerName || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return sendJson(res, 400, { error: 'A name and a rating from 1 to 5 are required.' });
    }
    if (reviewerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewerEmail)) {
      return sendJson(res, 400, { error: 'Enter a valid email address.' });
    }

    const { data: product, error: productError } = await supabase
      .from('store_products')
      .select('id,status,vendor_id')
      .eq('id', productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || !(product.status === 'published' || (!product.vendor_id && product.status === 'approved'))) {
      return sendJson(res, 404, { error: 'Product not found.' });
    }

    const { data, error } = await supabase
      .from('product_ratings')
      .insert({
        product_id: productId,
        reviewer_name: reviewerName,
        reviewer_email: reviewerEmail || null,
        rating,
        comment: comment || null
      })
      .select('id,product_id,reviewer_name,rating,comment,created_at')
      .single();
    if (error) throw error;
    return sendJson(res, 201, { data });
  } catch (error) {
    console.error('Product ratings request failed:', error);
    return sendJson(res, 500, { error: 'Product ratings could not be processed.' });
  }
}