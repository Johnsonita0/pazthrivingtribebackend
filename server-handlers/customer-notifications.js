import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(res, 500, { error: 'Server is not configured for customer notifications.' });

  const token = String(req.headers.authorization || req.headers['x-access-token'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(res, 401, { error: 'Missing access token.' });

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return jsonResponse(res, 401, { error: 'Invalid or expired access token.' });

    const userId = authData.user.id;
    const { data: customer, error: customerError } = await supabase
      .from('customer_profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return jsonResponse(res, 403, { error: 'Customer account required.' });

    const body = parseBody(req.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse(res, 400, { error: 'Invalid JSON request body.' });

    if (body.action === 'mark_read') {
      let query = supabase.from('customer_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', userId)
        .is('read_at', null);
      if (body.id) {
        const id = String(body.id);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return jsonResponse(res, 400, { error: 'A valid notification ID is required.' });
        }
        query = query.eq('id', id);
      }
      const { error } = await query;
      if (error) throw error;
      return jsonResponse(res, 200, { updated: true });
    }

    if (body.action === 'list' || body.action === 'unread_count') {
      const { count, error: countError } = await supabase.from('customer_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .is('read_at', null);
      if (countError) throw countError;
      if (body.action === 'unread_count') return jsonResponse(res, 200, { unreadCount: count || 0 });

      const { data, error } = await supabase.from('customer_notifications')
        .select('id,title,message,created_at,read_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return jsonResponse(res, 200, { notifications: data || [], unreadCount: count || 0 });
    }

    return jsonResponse(res, 400, { error: 'Unsupported customer notification action.' });
  } catch (error) {
    console.error('Customer notification request failed:', error);
    return jsonResponse(res, 500, { error: 'Customer notifications could not be loaded.' });
  }
}
