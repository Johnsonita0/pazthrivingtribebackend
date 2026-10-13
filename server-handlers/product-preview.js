import { createClient } from '@supabase/supabase-js';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const coverUrl = (cover) => {
  const value = String(cover || '').trim();
  if (!value || /(?:^|\/)logo[^/]*\.(?:png|jpe?g|webp|svg)(?:[?#].*)?$/i.test(value)) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const storagePath = value.replace(/^\/+/, '').replace(/^storage\/v1\/object\/public\//, '');
  if (supabaseUrl && (storagePath.startsWith('products/') || value.includes('/storage/v1/object/public/'))) {
    const path = storagePath.startsWith('products/') ? `prof-upload/${storagePath}` : storagePath;
    return `${supabaseUrl}/storage/v1/object/public/${path}`;
  }
  return `https://pazthrivingtribe.org/${value.replace(/^\/+/, '')}`;
};

const productCover = (product) => {
  const candidates = [product?.cover, product?.cover_url, product?.cover_image, product?.image, product?.image_url, product?.imageUrl];
  return candidates.find((value) => typeof value === 'string' && value.trim() && coverUrl(value)) || '';
};

const addPreviewVersion = (value, version) => {
  try {
    const url = new URL(value);
    url.searchParams.set('v', version);
    return url.toString();
  } catch {
    return value;
  }
};

const sendHtml = (res, html) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'User-Agent');
  res.end(html);
};

const redirectToProduct = (res, location) => {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

const isSocialCrawler = (userAgent = '') => /facebookexternalhit|facebot|whatsapp|twitterbot|linkedinbot|pinterest|slackbot|discordbot|telegrambot/i.test(userAgent);

const isInAppBrowser = (userAgent = '') => /fb_iab|fbav|fban|messenger|instagram/i.test(userAgent);

export default async function handler(req, res) {
  const requestedSlug = slugify(req.query?.slug || req.query?.product || '');
  let product = null;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey && requestedSlug) {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data } = await supabase.from('store_products').select('*').order('updated_at', { ascending: false }).limit(500);
    product = (data || []).find((item) => slugify(item.title || item.id) === requestedSlug || String(item.id || '').toLowerCase() === requestedSlug) || null;
  }

  const title = product?.title || 'Paz Thriving Tribe';
  const description = product?.description || 'Digital resources from Paz Thriving Tribe.';
  const cover = coverUrl(productCover(product));
  if (req.query?.image === '1') {
    if (!cover) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Product cover unavailable');
      return;
    }

    try {
      const { default: sharp } = await import('sharp');
      const coverUrl = new URL(cover);
      const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : '';
      const allowedHosts = new Set(['pazthrivingtribe.org', 'www.pazthrivingtribe.org', supabaseHost]);
      if (coverUrl.protocol !== 'https:' || !allowedHosts.has(coverUrl.hostname)) {
        throw new Error('Cover host is not allowed');
      }

      const coverResponse = await fetch(cover, { redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!coverResponse.ok) throw new Error(`Cover request failed: ${coverResponse.status}`);
      if (!coverResponse.headers.get('content-type')?.startsWith('image/')) {
        throw new Error('Cover response is not an image');
      }
      const contentLength = Number(coverResponse.headers.get('content-length') || 0);
      if (contentLength > 15_000_000) throw new Error('Cover image is too large');
      const source = Buffer.from(await coverResponse.arrayBuffer());
      const fittedCover = await sharp(source)
        .rotate()
        .resize(1080, 1080, { fit: 'contain', background: '#ffffff' })
        .png()
        .toBuffer();
      const image = await sharp({
        create: { width: 1200, height: 1200, channels: 3, background: '#ffffff' },
      })
        .composite([{ input: fittedCover, gravity: 'center' }])
        .jpeg({ quality: 90, progressive: true })
        .toBuffer();

      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(image.length));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(image);
    } catch (error) {
      console.error('Product share image generation failed:', error);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Product cover could not be rendered');
    }
    return;
  }

  const previewVersion = [
    String(req.query?.v || product?.updated_at || product?.cover || product?.id || '1').trim(),
    String(req.query?.share || '').trim(),
  ].filter(Boolean).join('-').slice(0, 320);
  const previewImageUrl = cover
    ? `https://www.pazthrivingtribe.org/api/product-preview/${encodeURIComponent(requestedSlug)}?image=1`
    : '';
  const previewCover = previewImageUrl ? addPreviewVersion(previewImageUrl, previewVersion) : '';
  const previewImageTags = previewCover
    ? `<meta property="og:image" content="${escapeHtml(previewCover)}"><meta property="og:image:secure_url" content="${escapeHtml(previewCover)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="1200"><meta property="og:image:alt" content="${escapeHtml(title)} full cover"><meta name="twitter:image" content="${escapeHtml(previewCover)}"><meta name="twitter:image:alt" content="${escapeHtml(title)} full cover">`
    : '';
  const browserProductUrl = new URL('https://www.pazthrivingtribe.org/shop');
  browserProductUrl.searchParams.set('product', requestedSlug);
  browserProductUrl.searchParams.set('app', '1');
  if (req.query?.v) browserProductUrl.searchParams.set('v', String(req.query.v).slice(0, 240));
  if (req.query?.share) browserProductUrl.searchParams.set('share', String(req.query.share).slice(0, 80));
  if (req.query?.independencePreview === '1') {
    browserProductUrl.searchParams.set('independencePreview', '1');
  }
  const browserUrl = browserProductUrl.toString();
  const canonicalUrl = new URL(`https://www.pazthrivingtribe.org/shop/${encodeURIComponent(requestedSlug)}`);
  canonicalUrl.searchParams.set('v', previewVersion);
  if (req.query?.share) canonicalUrl.searchParams.set('share', String(req.query.share).slice(0, 80));

  const userAgent = req.headers?.['user-agent'] || req.headers?.['User-Agent'] || '';
  if (isInAppBrowser(userAgent) || (!isSocialCrawler(userAgent) && !req.query?.share)) {
    return redirectToProduct(res, browserUrl);
  }

  sendHtml(res, `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="product"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">${previewImageTags}<meta property="og:url" content="${escapeHtml(canonicalUrl.toString())}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta http-equiv="refresh" content="0;url=${escapeHtml(browserUrl)}"></head><body><p>Opening ${escapeHtml(title)}...</p><p><a href="${escapeHtml(browserUrl)}">Continue to product</a></p></body></html>`);
}
