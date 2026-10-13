function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload)
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const fallbackRatesToNgn = { NGN: 1, USD: 1500, GBP: 1900, EUR: 1650, GHS: 95, KES: 11, ZAR: 85 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' })

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/NGN')
    const payload = await response.json()
    if (!response.ok || payload?.result !== 'success' || !payload?.rates) throw new Error('Exchange-rate provider unavailable')

    const ratesToNgn = Object.entries(payload.rates).reduce((rates, [currency, ngnPerCurrency]) => {
      const numericRate = Number(ngnPerCurrency)
      if (Number.isFinite(numericRate) && numericRate > 0) rates[currency] = 1 / numericRate
      return rates
    }, { NGN: 1 })

    return sendJson(res, 200, { ratesToNgn, source: 'open.er-api.com', updatedAt: payload.time_last_update_utc || null })
  } catch (error) {
    return sendJson(res, 200, { ratesToNgn: fallbackRatesToNgn, source: 'fallback', updatedAt: null })
  }
}
