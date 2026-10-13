import { createClient } from '@supabase/supabase-js'

const getEnv = () => ({
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  adminEmails: (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || 'pazthrivingtribe@gmail.com')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  adminUserIds: (process.env.ADMIN_USER_IDS || process.env.VITE_ADMIN_USER_IDS || '44787dbc-03ba-475e-9d5c-86ba765d5b0a')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
})

const jsonResponse = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'Method not allowed' })

  const { supabaseUrl, serviceRoleKey, adminEmails, adminUserIds } = getEnv()
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(res, 500, { error: 'Server misconfigured' })

  const authHeader = req.headers.authorization || req.headers['x-access-token'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse(res, 401, { isAdmin: false, error: 'Missing access token' })

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return jsonResponse(res, 401, { isAdmin: false, error: 'Invalid or expired access token' })

    const user = data.user
    let isAdmin = false
    const { data: adminRows, error: adminError } = await supabase
      .from('site_admins')
      .select('email, uid')
      .or(`email.eq.${user.email},uid.eq.${user.id}`)

    if (!adminError && Array.isArray(adminRows) && adminRows.length > 0) isAdmin = true
    if (!isAdmin && adminEmails.includes(String(user.email || '').toLowerCase())) isAdmin = true
    if (!isAdmin && adminUserIds.includes(user.id)) isAdmin = true

    return jsonResponse(res, 200, { isAdmin })
  } catch (error) {
    return jsonResponse(res, 500, { isAdmin: false, error: error?.message || 'Admin access check failed' })
  }
}
