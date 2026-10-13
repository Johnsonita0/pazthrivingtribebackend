import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { decryptProductChatToken, getAdminEmails, normalizeEmail, sendProductChatEmail } from './lib/product-chat.js';
import { sendCustomerChatPush } from './lib/expo-push.js';

const json = (res, status, payload) => {
  if (typeof res.status === 'function') return res.status(status).json(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const authToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json(res, 401, { error: 'Sign in to access product conversations.' });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY) return json(res, 500, { error: 'Vendor product chat is not configured.' });

  try {
    const supabase = createClient(url, key);
    const { data: userData, error: userError } = await supabase.auth.getUser(authToken);
    if (userError || !userData?.user) return json(res, 401, { error: 'Your session has expired. Please sign in again.' });
    const user = userData.user;
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id,company_name,contact_email,status')
      .eq('id', user.id)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor || vendor.status !== 'approved') return json(res, 403, { error: 'An approved vendor account is required.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (body.action === 'list') {
      const { data: conversations, error: conversationError } = await supabase
        .from('product_chat_conversations')
        .select('id,product_id,product_title,vendor_name,assigned_to,customer_name,customer_email,customer_phone,status,created_at,updated_at,last_message_at')
        .eq('vendor_id', user.id)
        .eq('assigned_to', 'vendor')
        .order('last_message_at', { ascending: false })
        .limit(200);
      if (conversationError) throw conversationError;
      const ids = (conversations || []).map((conversation) => conversation.id);
      let messages = [];
      if (ids.length) {
        const { data, error } = await supabase
          .from('product_chat_messages')
          .select('id,conversation_id,sender_role,sender_name,sender_email,message,created_at')
          .in('conversation_id', ids)
          .order('created_at', { ascending: true });
        if (error) throw error;
        messages = data || [];
      }
      const byConversation = new Map();
      for (const message of messages) {
        const thread = byConversation.get(message.conversation_id) || [];
        thread.push(message);
        byConversation.set(message.conversation_id, thread);
      }
      return json(res, 200, { data: (conversations || []).map((conversation) => ({ ...conversation, messages: byConversation.get(conversation.id) || [] })) });
    }

    if (body.action === 'reply') {
      const conversationId = String(body.conversationId || '').trim();
      const message = String(body.message || '').trim().slice(0, 4000);
      if (!conversationId || !message) return json(res, 400, { error: 'A conversation and reply are required.' });
      const { data: conversation, error: conversationError } = await supabase
        .from('product_chat_conversations')
        .select('id,product_title,vendor_name,vendor_email,assigned_to,customer_id,customer_name,customer_email,customer_phone,email_reply_token,access_token_ciphertext')
        .eq('id', conversationId)
        .eq('vendor_id', user.id)
        .eq('assigned_to', 'vendor')
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return json(res, 404, { error: 'This vendor conversation was not found.' });

      const senderName = vendor.company_name || conversation.vendor_name || 'Product vendor';
      const senderEmail = normalizeEmail(conversation.vendor_email || vendor.contact_email || user.email);
      const now = new Date().toISOString();
      const { data: savedMessage, error: insertError } = await supabase
        .from('product_chat_messages')
        .insert({ conversation_id: conversation.id, sender_role: 'vendor', sender_name: senderName, sender_email: senderEmail, message })
        .select('id,conversation_id,sender_role,sender_name,sender_email,message,created_at')
        .single();
      if (insertError) throw insertError;
      const { error: updateError } = await supabase
        .from('product_chat_conversations')
        .update({ status: 'open', updated_at: now, last_message_at: now })
        .eq('id', conversation.id);
      if (updateError) throw updateError;

      let emailSent = true;
      try {
        await sendProductChatEmail({
          to: [...new Set([normalizeEmail(conversation.customer_email), ...getAdminEmails()])],
          subject: `Reply about ${conversation.product_title}`,
          heading: `${senderName} replied to your product question.`,
          conversation,
          senderName,
          senderEmail,
          message,
          token: conversation.access_token_ciphertext ? decryptProductChatToken(conversation.access_token_ciphertext) : undefined,
          replyToken: conversation.email_reply_token
        });
      } catch (emailError) {
        emailSent = false;
        console.error('Vendor product chat reply email failed:', emailError?.message || emailError);
      }
      try {
        await sendCustomerChatPush(supabase, {
          customerId: conversation.customer_id,
          title: 'New reply from PAZ',
          body: `${senderName} replied about ${conversation.product_title}.`,
          conversationId: conversation.id
        });
      } catch (pushError) {
        console.error('Vendor product chat push failed:', pushError?.message || pushError);
      }
      return json(res, 200, { ok: true, emailSent, message: savedMessage });
    }

    return json(res, 400, { error: 'Unknown vendor product chat action.' });
  } catch (error) {
    console.error('Vendor product chat request failed:', error?.message || error);
    return json(res, 500, { error: 'Vendor product chat could not be processed.' });
  }
}