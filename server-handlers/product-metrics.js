import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function isCompletedLiveOrder(order) {
  return ['paid', 'free', 'completed'].includes(String(order.status || '').toLowerCase())
    && String(order.payment_mode || 'live').toLowerCase() !== 'test';
}

export function countUniqueProductViews(activity) {
  return new Set(activity.map((row) => String(row.session_id || '').trim()).filter(Boolean)).size;
}

export function countCompletedProductOrders(productOrderItems, orders) {
  const completedOrderIds = new Set(
    orders.filter(isCompletedLiveOrder).map((order) => String(order.id)),
  );
  return new Set(
    productOrderItems
      .filter((item) => item.order_id && completedOrderIds.has(String(item.order_id)))
      .map((item) => String(item.order_id)),
  ).size;
}

const normalizeSlug = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 180);

async function readAllRows(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const metricsScope = requestUrl.searchParams.get('scope');
  const productId = String(req.query?.productId || requestUrl.searchParams.get('productId') || '').trim();
  const requestedSlug = normalizeSlug(req.query?.slug || requestUrl.searchParams.get('slug'));
  const requestedRouteSlug = normalizeSlug(req.query?.routeSlug || requestUrl.searchParams.get('routeSlug'));
  const isUuid = /^[0-9a-f-]{36}$/i.test(productId);
  if (metricsScope !== 'store' && !productId && !requestedSlug && !requestedRouteSlug) {
    return sendJson(res, 400, { error: 'A valid product ID or slug is required.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: 'Product metrics are not configured.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    if (metricsScope === 'store') {
      const orderRows = await readAllRows(() => supabase
        .from('shop_orders')
        .select('status,payment_mode'));
      res.setHeader?.('Cache-Control', 'no-store');
      return sendJson(res, 200, {
        completedOrders: orderRows.filter(isCompletedLiveOrder).length
      });
    }

    let product = null;
    if (isUuid) {
      const { data, error: productError } = await supabase
        .from('store_products')
        .select('id,title,status,vendor_id,release_at')
        .eq('id', productId)
        .maybeSingle();
      if (productError) throw productError;
      product = data;
      if (!product || !(product.status === 'published' || (!product.vendor_id && product.status === 'approved'))) {
        return sendJson(res, 404, { error: 'Product not found.' });
      }
    }

    const canonicalSlug = normalizeSlug(product?.title || product?.id || requestedSlug || requestedRouteSlug);
    const validRouteSlugs = new Set([canonicalSlug, String(product?.id || '').toLowerCase()].filter(Boolean));
    const activitySlugs = new Set([canonicalSlug]);
    if (validRouteSlugs.has(requestedSlug)) activitySlugs.add(requestedSlug);
    if (validRouteSlugs.has(requestedRouteSlug)) activitySlugs.add(requestedRouteSlug);
    const productPaths = [...activitySlugs].flatMap((slug) => [`/shop/${slug}`, `/shop/${slug}/`]);
    const hasReleaseDate = Boolean(product?.release_at && Number.isFinite(Date.parse(product.release_at)));
    const [activity, productOrderItems] = await Promise.all([
      readAllRows(() => supabase
        .from('tribe_activity')
        .select('session_id,ip_address')
        .in('path', productPaths)),
      productId ? readAllRows(() => supabase
        .from('shop_order_items')
        .select('order_id')
        .eq('product_id', productId)) : Promise.resolve([])
    ]);
    const relatedOrderIds = [...new Set(productOrderItems.map((item) => String(item.order_id || '')).filter(Boolean))];
    const completedOrderRows = [];
    for (let offset = 0; offset < relatedOrderIds.length; offset += 200) {
      const orderIdBatch = relatedOrderIds.slice(offset, offset + 200);
      completedOrderRows.push(...await readAllRows(() => supabase
        .from('shop_orders')
        .select('id,status,payment_mode')
        .in('id', orderIdBatch)));
    }

    let notified = null;
    if (hasReleaseDate) {
      const { count, error: notificationError } = await supabase
        .from('product_release_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', productId);
      if (notificationError) throw notificationError;
      notified = count || 0;
    }

    const completedOrders = countCompletedProductOrders(productOrderItems, completedOrderRows);

    res.setHeader?.('Cache-Control', 'no-store');
    return sendJson(res, 200, {
      views: countUniqueProductViews(activity),
      completedOrders,
      hasReleaseDate,
      notified
    });
  } catch (error) {
    console.error('Product metrics could not be loaded:', error);
    return sendJson(res, 500, { error: 'Product metrics could not be loaded.' });
  }
}