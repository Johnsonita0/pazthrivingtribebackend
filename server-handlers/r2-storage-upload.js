import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createR2UploadUrl, isR2Configured } from './lib/r2-storage.js';

const jsonResponse = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const safeFilename = (value) => String(value || 'product-file')
  .replace(/[/\\]/g, '-')
  .replace(/[^a-z0-9._-]/gi, '-')
  .replace(/-+/g, '-')
  .slice(-120) || 'product-file';

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });
  if (!isR2Configured()) return jsonResponse(res, 503, { error: 'Product file storage is not configured yet.' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(res, 503, { error: 'Authentication service is not configured.' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(res, 401, { error: 'Sign in before uploading a product file.' });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return jsonResponse(res, 401, { error: 'Your session has expired. Sign in again.' });

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: 'Invalid request body.' });
    }
  }

  const { scope, filename, size } = body || {};
  if (!['vendor', 'admin'].includes(scope)) return jsonResponse(res, 400, { error: 'Invalid upload scope.' });
  if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > 100 * 1024 * 1024) {
    return jsonResponse(res, 400, { error: 'Product files must be smaller than 100 MB.' });
  }

  const cleanName = safeFilename(filename);
  const extension = cleanName.split('.').pop()?.toLowerCase();
  if (!['pdf', 'zip'].includes(extension)) return jsonResponse(res, 400, { error: 'Only PDF and ZIP product files are supported.' });
  const contentType = extension === 'pdf' ? 'application/pdf' : 'application/zip';

  let isAdmin = false;
  const adminEmails = String(process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || 'pazthrivingtribe@gmail.com')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  const adminUserIds = String(process.env.ADMIN_USER_IDS || process.env.VITE_ADMIN_USER_IDS || '44787dbc-03ba-475e-9d5c-86ba765d5b0a')
    .split(',').map((id) => id.trim()).filter(Boolean);
  const normalizedEmail = String(user.email || '').toLowerCase();
  if (adminEmails.includes(normalizedEmail) || adminUserIds.includes(user.id)) isAdmin = true;

  if (!isAdmin) {
    const [{ data: adminById }, { data: adminByEmail }] = await Promise.all([
      supabase.from('site_admins').select('uid').eq('uid', user.id).maybeSingle(),
      normalizedEmail
        ? supabase.from('site_admins').select('uid').eq('email', normalizedEmail).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    isAdmin = Boolean(adminById || adminByEmail);
  }

  let keyPrefix;
  if (scope === 'admin') {
    if (!isAdmin) return jsonResponse(res, 403, { error: 'Admin access is required for this upload.' });
    keyPrefix = 'products';
  } else {
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (vendorError || !vendor) return jsonResponse(res, 403, { error: 'A vendor profile is required to upload product files.' });
    keyPrefix = `vendors/${user.id}/products`;
  }

  const key = `${keyPrefix}/${randomUUID()}-${cleanName}`;
  try {
    const uploadUrl = await createR2UploadUrl(key, contentType);
    return jsonResponse(res, 200, {
      uploadUrl,
      headers: { 'Content-Type': contentType },
      fileUrl: `r2://${key}`,
    });
  } catch (error) {
    console.error('R2 upload URL creation failed:', error);
    return jsonResponse(res, 503, { error: 'Could not prepare the product file upload.' });
  }
}