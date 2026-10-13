import { createClient } from '@supabase/supabase-js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function isConfiguredAdmin(user) {
  const emails = [process.env.ADMIN_EMAILS, process.env.VITE_ADMIN_EMAILS]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const userIds = [process.env.ADMIN_USER_IDS, process.env.VITE_ADMIN_USER_IDS]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return emails.includes(String(user.email || '').toLowerCase()) || userIds.includes(user.id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const body = parseBody(req.body);
  if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

  const authorization = req.headers.authorization || req.headers.Authorization || '';
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(res, 401, { error: 'Sign in to generate a product description.' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return sendJson(res, 500, { error: 'Product writing is not configured on the server.' });

  const title = String(body.title || '').trim();
  const category = String(body.category || '').trim().slice(0, 80);
  const perspective = String(body.perspective || '').trim();
  const facts = String(body.facts || '').trim();
  const currentDescription = String(body.currentDescription || '').trim();
  if (!title || title.length > 160) return sendJson(res, 400, { error: 'Enter a product title under 160 characters.' });
  if (!perspective || perspective.length > 400) return sendJson(res, 400, { error: 'Enter a perspective under 400 characters.' });
  if (facts.length > 700 || currentDescription.length > 2400) return sendJson(res, 400, { error: 'Product details are too long. Shorten them and try again.' });

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return sendJson(res, 401, { error: 'Your session expired. Sign in again and retry.' });

    let isAdmin = isConfiguredAdmin(user);
    if (!isAdmin) {
      const email = String(user.email || '').toLowerCase();
      const { data: adminByEmail } = email
        ? await supabase.from('site_admins').select('id').eq('email', email).maybeSingle()
        : { data: null };
      const { data: adminById } = adminByEmail
        ? { data: adminByEmail }
        : await supabase.from('site_admins').select('id').eq('uid', user.id).maybeSingle();
      isAdmin = Boolean(adminById);
    }

    if (!isAdmin) {
      const { data: vendor, error: vendorError } = await supabase
        .from('vendor_profiles')
        .select('status')
        .eq('id', user.id)
        .maybeSingle();
      if (vendorError || vendor?.status !== 'approved') {
        return sendJson(res, 403, { error: 'Only approved vendors and administrators can use product writing.' });
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return sendJson(res, 503, { error: 'AI writing is not configured yet. Ask the administrator to add OPENAI_API_KEY to the server environment.' });

    const providerResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.55,
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: 'Write accurate, appealing plain-text descriptions for digital products sold by PAZ Thriving Tribe. Follow the requested audience and perspective. Use only facts supplied by the user; do not invent contents, credentials, guarantees, health outcomes, or financial results. Write one concise paragraph of 2 to 4 sentences without a heading or bullet list. If details are sparse, stay general and avoid unsupported claims.',
          },
          {
            role: 'user',
            content: JSON.stringify({ title, category, perspective, productFacts: facts, existingDescription: currentDescription }),
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const providerPayload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) {
      console.warn('Product description provider request failed:', providerResponse.status, providerPayload?.error?.code || 'unknown');
      if (providerResponse.status === 429) return sendJson(res, 503, { error: 'AI writing is busy right now. Please try again shortly.' });
      return sendJson(res, 502, { error: 'AI writing could not generate a draft right now. Please try again.' });
    }

    const description = String(providerPayload?.choices?.[0]?.message?.content || '').trim();
    if (!description) return sendJson(res, 502, { error: 'AI writing returned an empty draft. Please try again.' });
    return sendJson(res, 200, { description: description.slice(0, 2400) });
  } catch (error) {
    console.error('Product description generation failed:', error?.message || error);
    return sendJson(res, 500, { error: 'Product writing failed unexpectedly. Please try again.' });
  }
}