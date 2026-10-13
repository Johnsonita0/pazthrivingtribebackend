import { URL } from 'url'

const jsonResponse = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const getMetaTag = (html, attrName, key) => {
  const regex = new RegExp(`<meta[^>]+(?:${attrName})=[\"']${key}[\"'][^>]+content=[\"']([^\"']*)[\"']`, 'i')
  const match = html.match(regex)
  return match?.[1]?.trim() || ''
}

const getMeta = (html, keys) => {
  for (const key of keys) {
    const value = getMetaTag(html, 'property', key) || getMetaTag(html, 'name', key)
    if (value) return value
  }
  return ''
}

const normalizeYoutubeEmbed = (url) => {
  if (!url) return ''
  let normalized = url.trim()
  if (normalized.includes('youtu.be/')) {
    normalized = normalized.replace('https://youtu.be/', 'https://www.youtube.com/embed/').split('?')[0]
  } else if (normalized.includes('watch?v=')) {
    normalized = normalized.replace('watch?v=', 'embed/').split('&')[0]
  }
  return normalized
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' })
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const targetUrl = requestUrl.searchParams.get('url')
  if (!targetUrl) {
    return jsonResponse(res, 400, { error: 'Missing url parameter' })
  }

  let parsedUrl
  try {
    parsedUrl = new URL(targetUrl)
  } catch (err) {
    return jsonResponse(res, 400, { error: 'Invalid URL' })
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return jsonResponse(res, 400, { error: 'Unsupported URL protocol' })
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36'
      },
      redirect: 'follow'
    })

    if (!response.ok) {
      return jsonResponse(res, response.status, { error: `Unable to fetch URL: ${response.status}` })
    }

    const html = await response.text()
    const title = getMeta(html, ['og:title', 'twitter:title']) || (html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || '')
    const summary = getMeta(html, ['og:description', 'twitter:description', 'description'])
    const timestamp = getMeta(html, ['article:published_time', 'og:updated_time', 'date'])
    const embedUrl = normalizeYoutubeEmbed(targetUrl)

    return jsonResponse(res, 200, {
      title,
      summary,
      timestamp,
      embedUrl
    })
  } catch (err) {
    return jsonResponse(res, 500, { error: `Failed to fetch metadata: ${err?.message || err}` })
  }
}
