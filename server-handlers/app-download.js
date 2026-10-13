import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const APK_URL = 'https://expo.dev/artifacts/eas/Zet-_Qr47h8biC1v13sxDRSazgNPji-CnEhHeuaB22s.apk'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  try {
    const headers = {}
    if (req.headers.range) headers.Range = req.headers.range
    if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range']

    const response = await fetch(APK_URL, { headers, redirect: 'follow' })
    if (!response.ok || !response.body) {
      console.error(`APK download upstream failed: ${response.status}`)
      res.statusCode = response.status >= 400 ? response.status : 502
      res.end('The PAZ app download is temporarily unavailable.')
      return
    }

    res.statusCode = response.status
    res.setHeader('Content-Type', 'application/vnd.android.package-archive')
    res.setHeader('Content-Disposition', 'attachment; filename="PAZ App.apk"')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes')

    for (const name of ['content-length', 'content-range']) {
      const value = response.headers.get(name)
      if (value) res.setHeader(name, value)
    }

    await pipeline(Readable.fromWeb(response.body), res)
  } catch (error) {
    console.error('APK download proxy failed:', error)
    if (!res.headersSent) {
      res.statusCode = 502
      res.end('The PAZ app download is temporarily unavailable.')
    } else if (!res.destroyed) {
      res.destroy(error)
    }
  }
}
