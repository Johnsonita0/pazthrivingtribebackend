import { createClient } from '@supabase/supabase-js'

const getEnv = () => ({
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    supabaseUrlVite: process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeySource: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ? 'VITE_SUPABASE_SERVICE_ROLE_KEY' : null,
    adminEmails: process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || '',
    adminEmailsVite: process.env.VITE_ADMIN_EMAILS || ''
})

const jsonResponse = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
    const { supabaseUrl, supabaseUrlVite, serviceRoleKey, serviceRoleKeySource, adminEmails, adminEmailsVite } = getEnv()
    if (req.method !== 'GET') {
        return jsonResponse(res, 405, { status: 'error', error: 'Method not allowed', allowed: ['GET'] })
    }

    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse(res, 500, {
            status: 'error',
            error: 'Missing required environment variables',
            missing: {
                SUPABASE_URL: !process.env.SUPABASE_URL,
                VITE_SUPABASE_URL: !process.env.VITE_SUPABASE_URL,
                SUPABASE_SERVICE_ROLE_KEY: !process.env.SUPABASE_SERVICE_ROLE_KEY,
                VITE_SUPABASE_SERVICE_ROLE_KEY: !process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
                ADMIN_EMAILS: !process.env.ADMIN_EMAILS,
                VITE_ADMIN_EMAILS: !process.env.VITE_ADMIN_EMAILS
            },
            resolved: {
                activeSupabaseUrl: Boolean(supabaseUrl),
                activeServiceRoleKey: Boolean(serviceRoleKey),
                serviceRoleKeySource
            }
        })
    }

    let supabase
    try {
        supabase = createClient(supabaseUrl, serviceRoleKey)
    } catch (err) {
        return jsonResponse(res, 500, {
            status: 'error',
            error: `Failed to initialize Supabase client: ${err?.message || err}`
        })
    }

    try {
        const { data, error } = await supabase.from('site_admins').select('id').limit(1)
        if (error) {
            return jsonResponse(res, 500, {
                status: 'error',
                error: `Supabase query failed: ${error.message || error}`
            })
        }

        return jsonResponse(res, 200, {
            status: 'ok',
            env: {
                SUPABASE_URL: Boolean(supabaseUrl),
                SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceRoleKey),
                ADMIN_EMAILS: adminEmails
            },
            site_admins_test: Array.isArray(data) ? data.length : null
        })
    } catch (err) {
        return jsonResponse(res, 500, {
            status: 'error',
            error: `Unexpected server error: ${err?.message || err}`
        })
    }
}
