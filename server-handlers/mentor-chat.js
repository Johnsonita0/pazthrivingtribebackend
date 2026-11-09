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

const getTokenIssuerOrigin = (token) => {
  try {
    const payload = token.split('.')[1]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof claims.iss === 'string' ? new URL(claims.iss).origin : null
  } catch {
    return null
  }
}

const systemPrompt = [
  'You are Mentor Charles, a warm, non-judgmental parenting support guide for PAZ World, a welcoming space for parents and caregivers raising pre-teens and teenagers.',
  'Parents may arrive feeling worried, ashamed, blamed, overwhelmed, or afraid they have failed. Never blame, shame, lecture, or label a parent or young person as a failure. Acknowledge their care and courage in asking for help, while staying honest and not offering empty reassurance.',
  'Listen to what happened before offering advice. Help the parent understand the young person’s perspective and needs without excusing harmful behavior. Offer calm, practical, age-aware steps that build trust, respectful communication, clear boundaries, accountability, and repair after conflict.',
  'Do not assume one parenting style, family structure, culture, or faith. Do not recommend humiliation, physical punishment, threats, coercive control, or violating a young person’s privacy as a routine solution. Encourage a calm pause and a safe, respectful conversation.',
  'Be supportive of Christian faith when the parent welcomes it; Bible references or prayer may be offered gently, never imposed. Do not invent Bible quotations or references; if uncertain, say so.',
  'You are an AI support guide, not a human, therapist, doctor, lawyer, or emergency service. Do not diagnose a parent or teenager, promise outcomes, or recommend changing medication. Encourage qualified local professional support when challenges are persistent, severe, or beyond general guidance.',
  'If someone describes immediate danger, abuse, or risk of self-harm, respond with compassion, prioritize immediate safety, and encourage contacting local emergency services, a trusted safe adult, and appropriate professional support now. Do not leave them with only parenting or spiritual advice.',
  'Keep replies warm, clear, concise, and practical. Avoid jargon and blame. Ask at most one gentle clarifying question when needed, and offer one or two realistic next steps.',
].join(' ')

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' })

  const body = parseBody(req.body)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, { error: 'Send a valid chat message.' })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message || message.length > 2000) {
    return sendJson(res, 400, { error: 'Your message must be between 1 and 2,000 characters.' })
  }

  const token = String(req.headers.authorization || req.headers.Authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  if (!token) return sendJson(res, 401, { error: 'Sign in to chat with Mentor Charles.' })

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Mentor Charles chat is missing its Supabase server configuration.')
    return sendJson(res, 503, { error: 'Chat is temporarily unavailable. Please try again later.' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('Mentor Charles chat is missing OPENAI_API_KEY.')
    return sendJson(res, 503, {
      error: process.env.NODE_ENV === 'production'
        ? 'Chat is temporarily unavailable. Please try again later.'
        : 'Mentor Charles is not configured locally. Add OPENAI_API_KEY to backend/.env.local or backend/.env and restart the API server.',
    })
  }

  const tokenIssuerOrigin = getTokenIssuerOrigin(token)
  let configuredSupabaseOrigin
  try {
    configuredSupabaseOrigin = new URL(supabaseUrl).origin
  } catch {
    console.error('Mentor Charles chat has an invalid Supabase URL.')
    return sendJson(res, 503, { error: 'Chat is temporarily unavailable. Please contact PAZ support.' })
  }

  if (tokenIssuerOrigin && tokenIssuerOrigin !== configuredSupabaseOrigin) {
    console.error('Mentor Charles token issuer does not match the configured Supabase project.')
    return sendJson(res, 503, {
      error: 'Mentor Charles is connected to a different account service. Please contact PAZ support; signing in again will not fix this.',
    })
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      console.warn('Mentor Charles could not verify the account session:', userError?.status || 'unknown', userError?.code || 'unknown')
      return sendJson(res, 401, {
        error: 'PAZ could not verify this account session. Check that the backend Supabase URL and service-role key match the project used by PAZ World.',
      })
    }

    const history = Array.isArray(body.history)
      ? body.history.slice(-8)
        .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
        .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 2000) }))
        .filter((item) => item.content)
      : []

    const providerResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 550,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: message },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })

    const providerPayload = await providerResponse.json().catch(() => ({}))
    if (!providerResponse.ok) {
      console.warn('Mentor Charles OpenAI request failed:', providerResponse.status, providerPayload?.error?.code || 'unknown')
      if (providerResponse.status === 429) {
        return sendJson(res, 503, { error: 'Mentor Charles is busy right now. Please try again shortly.' })
      }
      if (providerResponse.status === 401) {
        console.error('OpenAI rejected the configured API key for Mentor Charles.')
        return sendJson(res, 503, { error: 'Chat is temporarily unavailable. Please contact PAZ support.' })
      }
      return sendJson(res, 502, { error: 'Mentor Charles could not reply right now. Please try again.' })
    }

    const reply = providerPayload?.choices?.[0]?.message?.content
    if (typeof reply !== 'string' || !reply.trim()) {
      console.warn('Mentor Charles received an empty OpenAI response.')
      return sendJson(res, 502, { error: 'Mentor Charles could not create a reply. Please try again.' })
    }

    return sendJson(res, 200, { message: reply.trim().slice(0, 4000) })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return sendJson(res, 504, { error: 'Mentor Charles is taking too long to reply. Please try again.' })
    }
    console.error('Mentor Charles chat failed:', error?.message || error)
    return sendJson(res, 502, { error: 'Mentor Charles could not reply right now. Please try again.' })
  }
}
