import { createClient } from '@supabase/supabase-js'

const getEnv = () => {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    adminEmails: (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  }
}

const jsonResponse = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' })

  const { supabaseUrl, serviceRoleKey, adminEmails } = getEnv()
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(res, 500, { error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing' })
  }

  let requestBody = req.body
  if (typeof requestBody === 'string') {
    try {
      requestBody = JSON.parse(requestBody)
    } catch (parseErr) {
      return jsonResponse(res, 400, { error: 'Invalid JSON body in request' })
    }
  }

  const { action, email, password } = requestBody || {}
  if (action !== 'ensure-admin') return jsonResponse(res, 400, { error: 'Unsupported action' })
  if (!email || !password) return jsonResponse(res, 400, { error: 'Email and password are required' })

  const normalizedEmail = String(email).trim().toLowerCase()
  if (adminEmails.length > 0 && !adminEmails.includes(normalizedEmail)) {
    return jsonResponse(res, 403, { error: 'This email is not authorized for admin access.' })
  }

  let supabase
  try {
    supabase = createClient(supabaseUrl, serviceRoleKey)
  } catch (clientErr) {
    return jsonResponse(res, 500, { error: `Failed to initialize Supabase client: ${clientErr?.message || clientErr}` })
  }

  try {
    const { data: usersData, error: listUsersError } = await supabase.auth.admin.listUsers()
    if (listUsersError) throw listUsersError

    const existingUser = usersData?.users?.find((user) => user.email?.toLowerCase() === normalizedEmail)

    if (existingUser) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(existingUser.id, { password })
      if (updateError) throw updateError

      const { error: adminRowError } = await supabase.from('site_admins').upsert({ email: normalizedEmail }, { onConflict: 'email' })
      if (adminRowError) throw adminRowError

      return jsonResponse(res, 200, { ok: true, created: false, email: normalizedEmail })
    }

    const { data: createdData, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { role: 'admin', source: 'dashboard-provision' }
    })
    if (createError) throw createError

    const { error: adminRowError } = await supabase.from('site_admins').upsert({ email: normalizedEmail }, { onConflict: 'email' })
    if (adminRowError) throw adminRowError

    return jsonResponse(res, 200, { ok: true, created: true, userId: createdData.user?.id, email: normalizedEmail })
  } catch (err) {
    return jsonResponse(res, 500, { error: `Unable to provision the admin account: ${err?.message || err}` })
  }
}
