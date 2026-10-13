import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Storefront service is not configured' }));
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('store_products')
    .select('*')
    .or('status.eq.published,and(vendor_id.is.null,status.eq.approved)')
    .order('created_at', { ascending: false });

  res.statusCode = error ? 500 : 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(error ? { error: error.message } : {
    data: data || [],
    storageBaseUrl: supabaseUrl.replace(/\/$/, '')
  }));
}
