import { Buffer } from 'node:buffer';
import process from 'node:process';
import { Webhook } from 'svix';
import { createClient } from '@supabase/supabase-js';
import { decryptProductChatToken, getAdminEmails, normalizeEmail, sendProductChatEmail } from './lib/product-chat.js';
import { sendCustomerChatPush } from './lib/expo-push.js';

const json = (res, status, payload) => {
  if (typeof res.status === 'function') return res.status(status).json(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

function readRawBody(req) {
  if (typeof req.rawBody === 'string') return Promise.resolve(req.rawBody);
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function findReplyToken(addresses) {
  for (const address of addresses) {
    const match = String(address || '').match(/chat\+([A-Za-z0-9_-]{20,60})@/i);
    if (match) return match[1];
  }
  return '';
}

function emailAddress(value) {
  const match = String(value || '').match(/<([^<>]+)>/);
  return normalizeEmail(match?.[1] || value);
}

function senderDisplayName(value, fallback) {
  const display = String(value || '').match(/^\s*"?([^"<]+?)"?\s*<[^<>]+>/)?.[1]?.trim();
  return display || fallback;
}

function cleanReply(value) {
  const lines = String(value || '').replace(/\r/g, '').split('\n');
  const replyLines = [];
  for (const line of lines) {
    if (/^\s*>/.test(line) || /^On .+wrote:\s*$/i.test(line) || /^From:\s*.+$/i.test(line) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(line)) break;
    replyLines.push(line);
  }
  return replyLines.join('\n').trim().slice(0, 4000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !apiKey || !supabaseUrl || !serviceRoleKey) return json(res, 500, { error: 'Inbound product chat is not configured.' });

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = new Webhook(webhookSecret).verify(rawBody, {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature']
    });
  } catch {
    return json(res, 401, { error: 'Invalid webhook signature.' });
  }
  if (event?.type !== 'email.received') return json(res, 200, { ok: true, ignored: true });

  const emailId = String(event.data?.email_id || '').trim();
  if (!emailId) return json(res, 400, { error: 'Received email ID is missing.' });

  try {
    const emailResponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const emailPayload = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) throw new Error(emailPayload?.message || 'Could not retrieve inbound email.');
    const authentication = emailPayload.authentication || {};
    if (authentication.spf !== 'pass' && authentication.dkim !== 'pass') return json(res, 200, { ok: true, ignored: true });

    const replyToken = findReplyToken([...(emailPayload.to || []), ...(emailPayload.received_for || []), ...(event.data?.to || []), ...(event.data?.received_for || [])]);
    if (!replyToken) return json(res, 200, { ok: true, ignored: true });
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: conversation, error: conversationError } = await supabase
      .from('product_chat_conversations')
      .select('id,product_title,vendor_name,vendor_email,assigned_to,customer_id,customer_name,customer_email,email_reply_token,access_token_ciphertext')
      .eq('email_reply_token', replyToken)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return json(res, 200, { ok: true, ignored: true });

    const fromAddress = emailAddress(emailPayload.from || event.data?.from);
    const adminEmails = getAdminEmails();
    let senderRole = '';
    let senderName = '';
    if (fromAddress && fromAddress === normalizeEmail(conversation.customer_email)) {
      senderRole = 'customer';
      senderName = conversation.customer_name;
    } else if (fromAddress && fromAddress === normalizeEmail(conversation.vendor_email)) {
      senderRole = 'vendor';
      senderName = conversation.vendor_name || senderDisplayName(emailPayload.from, 'Product vendor');
    } else if (adminEmails.includes(fromAddress)) {
      senderRole = 'admin';
      senderName = senderDisplayName(emailPayload.from, 'PAZ Support');
    }
    if (!senderRole) return json(res, 200, { ok: true, ignored: true });

    const message = cleanReply(emailPayload.text || String(emailPayload.html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
    if (!message) return json(res, 200, { ok: true, ignored: true });

    const { error: insertError } = await supabase.from('product_chat_messages').insert({
      conversation_id: conversation.id,
      sender_role: senderRole,
      sender_name: senderName,
      sender_email: fromAddress,
      message,
      source_email_id: emailId
    });
    if (insertError?.code === '23505') return json(res, 200, { ok: true, duplicate: true });
    if (insertError) throw insertError;

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('product_chat_conversations')
      .update({ status: 'open', updated_at: now, last_message_at: now })
      .eq('id', conversation.id);
    if (updateError) throw updateError;

    const recipients = senderRole === 'customer'
      ? [...new Set([...(conversation.assigned_to === 'vendor' && conversation.vendor_email ? [normalizeEmail(conversation.vendor_email)] : []), ...adminEmails])]
      : senderRole === 'vendor'
        ? [...new Set([normalizeEmail(conversation.customer_email), ...adminEmails])]
        : [normalizeEmail(conversation.customer_email)];
    try {
      await sendProductChatEmail({
        to: recipients,
        subject: `New ${senderRole} reply about ${conversation.product_title}`,
        heading: `${senderName} replied to the product conversation.`,
        conversation,
        senderName,
        senderEmail: fromAddress,
        message,
        token: decryptProductChatToken(conversation.access_token_ciphertext),
        replyToken: conversation.email_reply_token
      });
    } catch (emailError) {
      console.error('Product chat email reply notification failed:', emailError?.message || emailError);
    }
    if (senderRole !== 'customer') {
      try {
        await sendCustomerChatPush(supabase, {
          customerId: conversation.customer_id,
          title: 'New reply from PAZ',
          body: `${senderName} replied about ${conversation.product_title}.`,
          conversationId: conversation.id
        });
      } catch (pushError) {
        console.error('Inbound product chat push failed:', pushError?.message || pushError);
      }
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Inbound product chat failed:', error?.message || error);
    return json(res, 500, { error: 'The inbound product reply could not be processed.' });
  }
}