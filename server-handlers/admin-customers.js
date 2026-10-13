import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const profileColumns = 'id,email,first_name,last_name,full_name,phone,avatar_url,delivery_address,country_code,language,currency,notifications_enabled,created_at,updated_at';

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function getEnv() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    adminEmails: (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || 'pazthrivingtribe@gmail.com')
      .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
    adminUserIds: (process.env.ADMIN_USER_IDS || process.env.VITE_ADMIN_USER_IDS || '44787dbc-03ba-475e-9d5c-86ba765d5b0a')
      .split(',').map((value) => value.trim()).filter(Boolean)
  };
}

async function isAdmin(supabase, user, adminEmails, adminUserIds) {
  const { data: adminRows, error } = await supabase
    .from('site_admins')
    .select('email,uid')
    .or(`email.eq.${user.email},uid.eq.${user.id}`);
  if (!error && Array.isArray(adminRows) && adminRows.length) return true;
  return adminEmails.includes(String(user.email || '').toLowerCase()) || adminUserIds.includes(user.id);
}

function safeAddress(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const allowed = ['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'];
  const address = {};
  for (const key of allowed) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || value[key].length > 250) return undefined;
    address[key] = value[key].trim();
  }
  return address;
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
  const { supabaseUrl, serviceRoleKey, adminEmails, adminUserIds } = getEnv();
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(res, 500, { error: 'Server misconfigured: Supabase server credentials are missing.' });

  const token = String(req.headers.authorization || req.headers['x-access-token'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(res, 401, { error: 'Missing access token.' });

  let supabase;
  try {
    supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return jsonResponse(res, 401, { error: 'Invalid or expired access token.' });
    if (!(await isAdmin(supabase, data.user, adminEmails, adminUserIds))) return jsonResponse(res, 403, { error: 'User is not authorized to manage customer accounts.' });
  } catch (error) {
    console.error('Customer admin authorization failed:', error);
    return jsonResponse(res, 500, { error: 'Could not verify administrator access.' });
  }

  const body = parseBody(req.body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse(res, 400, { error: 'Invalid JSON request body.' });
  const { action } = body;

  try {
    if (action === 'list_customers') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(100, Math.max(1, Math.floor(Number(body.pageSize) || 25)));
      const search = String(body.search || '').trim().replace(/[(),.*%_\\]/g, '').slice(0, 100);
      let query = supabase.from('customer_profiles').select(profileColumns, { count: 'exact' }).order('updated_at', { ascending: false });
      if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      const start = (page - 1) * pageSize;
      const { data, count, error } = await query.range(start, start + pageSize - 1);
      if (error) throw error;
      return jsonResponse(res, 200, { customers: data || [], count: count || 0, page, pageSize });
    }

    if (action === 'save_customer') {
      const id = String(body.id || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return jsonResponse(res, 400, { error: 'A valid customer account ID is required.' });
      const input = body.profile;
      if (!input || typeof input !== 'object' || Array.isArray(input)) return jsonResponse(res, 400, { error: 'Customer profile details are required.' });
      const profile = {};
      for (const field of ['first_name', 'last_name', 'full_name', 'phone', 'country_code', 'language', 'currency']) {
        if (input[field] === undefined) continue;
        if (typeof input[field] !== 'string' || input[field].length > (field === 'full_name' ? 160 : 80)) return jsonResponse(res, 400, { error: `Invalid ${field.replace(/_/g, ' ')}.` });
        profile[field] = input[field].trim() || null;
      }
      if (input.delivery_address !== undefined) {
        const address = safeAddress(input.delivery_address);
        if (address === undefined) return jsonResponse(res, 400, { error: 'Delivery address must contain valid text fields.' });
        profile.delivery_address = address;
      }
      if (input.notifications_enabled !== undefined) {
        if (typeof input.notifications_enabled !== 'boolean') return jsonResponse(res, 400, { error: 'Notification preference must be true or false.' });
        profile.notifications_enabled = input.notifications_enabled;
      }
      if (!Object.keys(profile).length) return jsonResponse(res, 400, { error: 'No editable customer profile fields were provided.' });
      profile.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('customer_profiles').update(profile).eq('id', id).select(profileColumns).maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(res, 404, { error: 'Customer profile not found.' });
      return jsonResponse(res, 200, { customer: data });
    }

    if (action === 'send_customer_notification' || action === 'send_bulk_customer_notification') {
      const subject = String(body.subject || '').trim().replace(/[\r\n]/g, ' ').slice(0, 180);
      const message = String(body.message || '').trim().slice(0, 5000);
      if (!subject || !message) return jsonResponse(res, 400, { error: 'A subject and message are required.' });
      const authHeader = String(req.headers.authorization || req.headers['x-access-token'] || '').replace(/^Bearer\s+/i, '');
      const { data: adminData, error: adminError } = await supabase.auth.getUser(authHeader);
      if (adminError || !adminData?.user) return jsonResponse(res, 401, { error: 'Invalid or expired access token.' });

      if (action === 'send_customer_notification') {
        const id = String(body.id || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return jsonResponse(res, 400, { error: 'A valid customer account ID is required.' });
        const { data: profile, error } = await supabase.from('customer_profiles').select('id').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!profile) return jsonResponse(res, 404, { error: 'Customer profile not found.' });
        const { error: insertError } = await supabase.from('customer_notifications').insert({
          recipient_id: profile.id,
          sender_id: adminData.user.id,
          title: subject,
          message
        });
        if (insertError) throw insertError;
        return jsonResponse(res, 200, { sent: 1, failed: 0, channel: 'in_app' });
      }

      let sent = 0;
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase.from('customer_profiles')
          .select('id')
          .order('id', { ascending: true })
          .range(start, start + 499);
        if (error) throw error;
        if (data?.length) {
          const { error: insertError } = await supabase.from('customer_notifications').insert(data.map((profile) => ({
            recipient_id: profile.id,
            sender_id: adminData.user.id,
            title: subject,
            message
          })));
          if (insertError) throw insertError;
          sent += data.length;
        }
        if (!data || data.length < 500) break;
      }
      return jsonResponse(res, 200, { sent, failed: 0, total: sent, channel: 'in_app' });
    }

    return jsonResponse(res, 400, { error: 'Unsupported customer admin action.' });
  } catch (error) {
    console.error('Customer admin request failed:', error);
    return jsonResponse(res, 500, { error: error?.message || 'Customer admin request failed.' });
  }
}
