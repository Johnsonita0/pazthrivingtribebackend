import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Resend-Signature');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const signatureHeader = req.headers['x-resend-signature'] || req.headers['X-Resend-Signature'] || '';
  const authHeader = req.headers.authorization || '';

  if (webhookSecret) {
    const isBearerAuthorized = authHeader === `Bearer ${webhookSecret}`;
    const isSignatureAuthorized = typeof signatureHeader === 'string' && signatureHeader.trim() !== '' && signatureHeader.trim() === webhookSecret;

    if (!isBearerAuthorized && !isSignatureAuthorized) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized webhook request' }));
      return;
    }
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      return;
    }
  }

  const events = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray(payload.data) ? payload.data : [payload];

  const sanitizedEvents = events.map((event, index) => {
    const eventData = event && typeof event === 'object' ? event : { raw: event };
    return {
      index,
      type: eventData.type || eventData.event || eventData.event_type || 'unknown',
      id: eventData.id || eventData.message_id || eventData.messageId || null,
      email: eventData.email || eventData.recipient || null,
      status: eventData.status || eventData.state || null,
      created_at: eventData.created_at || eventData.createdAt || new Date().toISOString(),
      raw: eventData
    };
  });

  console.log('Resend webhook received:', JSON.stringify(sanitizedEvents, null, 2));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    received: sanitizedEvents.length,
    events: sanitizedEvents
  }));
}
