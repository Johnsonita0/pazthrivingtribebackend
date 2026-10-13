import { createClient } from '@supabase/supabase-js'

const sendJson = (res, status, payload) => {
  if (typeof res.status === 'function') return res.status(status).json(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

const parseBody = (body) => {
  if (typeof body !== 'string') return body || {}
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' })

  const body = parseBody(req.body)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, { error: 'Invalid JSON body.' })
  }

  const token = String(req.headers.authorization || req.headers.Authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return sendJson(res, 401, { error: 'Sign in to order with Mentor Charles.' })

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return sendJson(res, 500, { error: 'Mentor Charles ordering is not configured on the server.' })

  const message = String(body.message || '').trim()
  if (!message || message.length > 600) {
    return sendJson(res, 400, { error: 'Enter a message of 1 to 600 characters.' })
  }
  if (!Array.isArray(body.products) || body.products.length > 80) {
    return sendJson(res, 400, { error: 'The product catalogue is invalid. Refresh the shop and try again.' })
  }

  const products = body.products
    .filter((product) => product && typeof product.id === 'string' && typeof product.title === 'string')
    .map((product) => ({
      id: product.id.slice(0, 120),
      title: product.title.slice(0, 180),
      category: String(product.category || '').slice(0, 80),
      description: String(product.description || '').slice(0, 400),
      price: Number(product.price) || 0,
      currency: String(product.currency || 'NGN').slice(0, 8),
      isFree: product.isFree === true,
      available: product.available === true,
      stockCount: Math.max(0, Math.min(100, Math.floor(Number(product.stockCount) || 0))),
    }))
  const availableIds = new Set(products.filter((product) => product.available).map((product) => product.id))
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).filter((item) => item && ['user', 'assistant'].includes(item.role))
      .map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 600) }))
    : []

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) return sendJson(res, 401, { error: 'Your session expired. Sign in again and retry.' })

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return sendJson(res, 503, { error: 'Mentor Charles AI ordering is not configured yet. Ask the administrator to add OPENAI_API_KEY to the server environment.' })
    }

    const providerResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.25,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are Mentor Charles, the friendly PAZ Thriving Tribe shop ordering assistant.',
              'Help customers find products using only the supplied catalogue. Never invent products, prices, stock, features, delivery promises, or policies.',
              'Recommend only products whose available field is true and use their exact product IDs. If nothing suitable is available, say so and ask a brief clarifying question when useful.',
              'Do not place or pay for orders. The customer must tap to add recommendations and confirm at secure checkout.',
              'Return a JSON object with exactly: message (a concise, helpful string) and recommendations (an array of objects with productId and quantity). Recommend at most 3 products. Quantity must be from 1 to 10 and no more than stockCount.',
            ].join(' '),
          },
          ...history,
          {
            role: 'user',
            content: JSON.stringify({ request: message, availableCatalogue: products }),
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })
    const providerPayload = await providerResponse.json().catch(() => ({}))
    if (!providerResponse.ok) {
      console.warn('Mentor Charles provider request failed:', providerResponse.status, providerPayload?.error?.code || 'unknown')
      if (providerResponse.status === 429) return sendJson(res, 503, { error: 'Mentor Charles is busy right now. Please try again shortly.' })
      return sendJson(res, 502, { error: 'Mentor Charles could not reply right now. Please try again.' })
    }

    const content = String(providerPayload?.choices?.[0]?.message?.content || '').trim()
    let assistantReply
    try {
      assistantReply = JSON.parse(content)
    } catch {
      return sendJson(res, 502, { error: 'Mentor Charles returned an unreadable reply. Please try again.' })
    }
    const replyText = String(assistantReply?.message || '').trim().slice(0, 1000)
    if (!replyText || !Array.isArray(assistantReply?.recommendations)) {
      return sendJson(res, 502, { error: 'Mentor Charles returned an incomplete reply. Please try again.' })
    }

    const recommendations = assistantReply.recommendations
      .filter((item) => item && availableIds.has(String(item.productId)))
      .slice(0, 3)
      .map((item) => {
        const product = products.find((entry) => entry.id === String(item.productId))
        return {
          productId: product.id,
          quantity: Math.max(1, Math.min(10, product.stockCount, Math.floor(Number(item.quantity) || 1))),
        }
      })

    return sendJson(res, 200, { message: replyText, recommendations })
  } catch (error) {
    console.error('Mentor Charles shop ordering failed:', error?.message || error)
    return sendJson(res, 500, { error: 'Mentor Charles could not complete that request. Please try again.' })
  }
}
