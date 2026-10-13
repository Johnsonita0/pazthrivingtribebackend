import productPreviewHandler from '../../server-handlers/product-preview.js';

export default async function handler(req, res) {
  req.query = { ...(req.query || {}), slug: req.query?.productName || '' };
  return productPreviewHandler(req, res);
}
