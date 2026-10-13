import { createClient } from '@supabase/supabase-js'
import { sendResendEmail } from './lib/resend.js'
import { buildPazEmailTemplate } from './lib/paz-email-template.js'
import { decryptProductChatToken, normalizeEmail, sendProductChatEmail } from './lib/product-chat.js'
import { sendCustomerChatPush } from './lib/expo-push.js'

// Serverless admin endpoint for secure updates using the Supabase service role key.
// Requires these environment variables to be set in your deployment:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS (comma-separated list)

const getEnv = () => ({
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  adminEmails: (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || 'pazthrivingtribe@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  adminUserIds: (process.env.ADMIN_USER_IDS || process.env.VITE_ADMIN_USER_IDS || '44787dbc-03ba-475e-9d5c-86ba765d5b0a')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
})

const jsonResponse = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

export default async function handler(req, res) {
  const { supabaseUrl, serviceRoleKey, adminEmails, adminUserIds } = getEnv()
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' })
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(res, 500, { error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing' })

  let supabase
  try {
    supabase = createClient(supabaseUrl, serviceRoleKey)
  } catch (clientErr) {
    return jsonResponse(res, 500, { error: `Failed to initialize Supabase client: ${clientErr?.message || clientErr}` })
  }

  const authHeader = req.headers.authorization || req.headers['x-access-token'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse(res, 401, { error: 'Missing access token' })

  // Verify token with Supabase to retrieve the authenticated user
  try {
    let userData, userErr
    try {
      const result = await supabase.auth.getUser(token)
      userData = result.data
      userErr = result.error
    } catch (authErr) {
      return jsonResponse(res, 401, { error: `Token verification failed: ${authErr?.message || authErr}` })
    }

    if (userErr || !userData?.user) return jsonResponse(res, 401, { error: `Invalid or expired access token: ${userErr?.message || 'no user data'}` })

    const user = userData.user

    // First try server-side admin table `site_admins` (recommended).
    let isAdmin = false
    try {
      const { data: adminRows, error: adminErr } = await supabase.from('site_admins').select('email, uid').or(`email.eq.${user.email},uid.eq.${user.id}`)
      if (!adminErr && Array.isArray(adminRows) && adminRows.length > 0) {
        isAdmin = true
      }
    } catch (e) {
      // table might not exist yet — we'll fall back to env list
    }

    // Allow the configured admin email and Supabase user ID for this project.
    const normalizedEmail = (user.email || '').toLowerCase()
    if (!isAdmin && (adminEmails.includes(normalizedEmail) || adminUserIds.includes(user.id))) {
      isAdmin = true
    }

    if (!isAdmin) return jsonResponse(res, 403, { error: 'User is not authorized to perform admin updates' })

    let requestBody = req.body
    if (typeof requestBody === 'string') {
      try {
        requestBody = JSON.parse(requestBody)
      } catch (parseErr) {
        return jsonResponse(res, 400, { error: 'Invalid JSON body in request' })
      }
    }

    const { action, table, payload, match, columns = '*', bucket, path, expiresIn = 3600 } = requestBody || {}
    if (!action) return jsonResponse(res, 400, { error: 'Missing action' })

    let result
    try {
      if (action === 'delete_test_shop_orders') {
        result = await supabase.from('shop_orders').delete().eq('payment_mode', 'test')
      } else if (action === 'update_shop_order_tracking') {
        const trackingStatuses = ['order_placed', 'processing', 'dispatched', 'out_for_delivery', 'delivered', 'cancelled']
        if (!match?.id || !trackingStatuses.includes(payload?.tracking_status)) {
          return jsonResponse(res, 400, { error: 'An order ID and valid tracking status are required' })
        }
        const estimatedDeliveryAt = payload?.estimated_delivery_at
          ? new Date(payload.estimated_delivery_at)
          : null
        if (estimatedDeliveryAt && Number.isNaN(estimatedDeliveryAt.getTime())) {
          return jsonResponse(res, 400, { error: 'Estimated delivery date is invalid' })
        }
        const { data, error } = await supabase.rpc('admin_update_shop_order_tracking', {
          p_order_id: match.id,
          p_status: payload.tracking_status,
          p_note: String(payload.note || '').trim().slice(0, 500) || null,
          p_tracking_number: String(payload.tracking_number || '').trim().slice(0, 120) || null,
          p_estimated_delivery_at: estimatedDeliveryAt?.toISOString() || null,
          p_updated_by: user.id,
        })
        if (error) throw error
        return jsonResponse(res, 200, { data })
      } else if (action === 'signed_url') {
        if (bucket !== 'vendor-verification' || !path || !String(path).startsWith('vendors/')) return jsonResponse(res, 400, { error: 'Invalid vendor document path' })
        const signedUrlResult = await supabase.storage.from(bucket).createSignedUrl(path, Math.min(Number(expiresIn) || 3600, 3600))
        if (signedUrlResult.error) return jsonResponse(res, 404, { error: `Vendor document preview unavailable: ${signedUrlResult.error.message || signedUrlResult.error}` })
        return jsonResponse(res, 200, { data: signedUrlResult.data, signedUrl: signedUrlResult.data?.signedUrl || signedUrlResult.data?.signedURL || null })
      } else if (action === 'reply_support') {
        if (!['customer_support_messages', 'vendor_support_messages'].includes(table)) {
          return jsonResponse(res, 400, { error: 'Invalid support message table' })
        }
        if (!match?.id || !String(payload?.admin_reply || '').trim()) {
          return jsonResponse(res, 400, { error: 'A support message ID and reply are required' })
        }

        const reply = String(payload.admin_reply).trim()
        const { data: supportMessage, error: supportLookupError } = await supabase
          .from(table)
          .select('id,sender_email,sender_name,message')
          .eq('id', match.id)
          .maybeSingle()
        if (supportLookupError) throw supportLookupError
        if (!supportMessage) return jsonResponse(res, 404, { error: 'Support message not found' })

        const recipient = String(supportMessage.sender_email || '').trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
          return jsonResponse(res, 400, { error: 'This support message has no valid client email address' })
        }

        const clientName = String(supportMessage.sender_name || 'there').trim() || 'there'
        const originalMessage = String(supportMessage.message || '').trim()
        await sendResendEmail({
          to: recipient,
          subject: 'Reply from PAZ customer care',
          html: `<p>Hi ${escapeHtml(clientName)},</p><p>Our customer care team replied to your message:</p><blockquote>${escapeHtml(reply).replace(/\n/g, '<br>')}</blockquote><p><strong>Your original message:</strong><br>${escapeHtml(originalMessage).replace(/\n/g, '<br>')}</p><p>PAZ Thriving Tribe customer care</p>`,
          text: `Hi ${clientName},\n\nOur customer care team replied to your message:\n\n${reply}\n\nYour original message:\n${originalMessage}\n\nPAZ Thriving Tribe customer care`,
          from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org'
        })

        result = await supabase
          .from(table)
          .update({ admin_reply: reply, status: 'closed', updated_at: new Date().toISOString() })
          .match(match)
      } else if (action === 'product_chat_inbox') {
        const { data: conversations, error: conversationError } = await supabase
          .from('product_chat_conversations')
          .select('id,product_id,product_title,vendor_name,assigned_to,customer_name,customer_email,customer_phone,status,created_at,updated_at,last_message_at')
          .order('last_message_at', { ascending: false })
          .limit(250)
        if (conversationError) throw conversationError
        const conversationIds = (conversations || []).map((conversation) => conversation.id)
        let messages = []
        if (conversationIds.length) {
          const { data, error } = await supabase
            .from('product_chat_messages')
            .select('id,conversation_id,sender_role,sender_name,sender_email,message,created_at')
            .in('conversation_id', conversationIds)
            .order('created_at', { ascending: true })
          if (error) throw error
          messages = data || []
        }
        const messagesByConversation = new Map()
        for (const message of messages) {
          const thread = messagesByConversation.get(message.conversation_id) || []
          thread.push(message)
          messagesByConversation.set(message.conversation_id, thread)
        }
        return jsonResponse(res, 200, {
          data: (conversations || []).map((conversation) => ({
            ...conversation,
            messages: messagesByConversation.get(conversation.id) || []
          }))
        })
      } else if (action === 'reply_product_chat') {
        const conversationId = String(payload?.conversationId || '').trim()
        const reply = String(payload?.message || '').trim().slice(0, 4000)
        if (!conversationId || !reply) return jsonResponse(res, 400, { error: 'A conversation and reply are required.' })
        const { data: conversation, error: lookupError } = await supabase
          .from('product_chat_conversations')
          .select('id,product_id,product_title,vendor_name,assigned_to,customer_id,customer_name,customer_email,customer_phone,status,email_reply_token,access_token_ciphertext')
          .eq('id', conversationId)
          .maybeSingle()
        if (lookupError) throw lookupError
        if (!conversation) return jsonResponse(res, 404, { error: 'Product conversation not found.' })
        const recipient = normalizeEmail(conversation.customer_email)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return jsonResponse(res, 400, { error: 'This conversation has no valid customer email.' })

        const senderName = String(user.user_metadata?.full_name || 'PAZ Support').trim()
        const senderEmail = normalizeEmail(user.email) || 'pazthrivingtribe@gmail.com'
        const now = new Date().toISOString()
        const { data: savedMessage, error: insertError } = await supabase
          .from('product_chat_messages')
          .insert({ conversation_id: conversation.id, sender_role: 'admin', sender_name: senderName, sender_email: senderEmail, message: reply })
          .select('id,conversation_id,sender_role,sender_name,sender_email,message,created_at')
          .single()
        if (insertError) throw insertError
        const { error: updateError } = await supabase
          .from('product_chat_conversations')
          .update({ status: 'open', updated_at: now, last_message_at: now })
          .eq('id', conversation.id)
        if (updateError) throw updateError

        let emailSent = true
        try {
          await sendProductChatEmail({
            to: [recipient],
            subject: `Reply about ${conversation.product_title}`,
            heading: `${senderName} replied to your product question.`,
            conversation,
            senderName,
            senderEmail,
            message: reply,
            token: conversation.access_token_ciphertext ? decryptProductChatToken(conversation.access_token_ciphertext) : undefined,
            replyToken: conversation.email_reply_token
          })
        } catch (emailError) {
          emailSent = false
          console.error('Product chat admin reply email failed:', emailError?.message || emailError)
        }
        try {
          await sendCustomerChatPush(supabase, {
            customerId: conversation.customer_id,
            title: 'New reply from PAZ',
            body: `${senderName} replied about ${conversation.product_title}.`,
            conversationId: conversation.id
          })
        } catch (pushError) {
          console.error('Product chat admin push failed:', pushError?.message || pushError)
        }
        return jsonResponse(res, 200, { ok: true, emailSent, message: savedMessage })
      } else if (action === 'send_vendor_password_reset') {
        if (!match?.id) return jsonResponse(res, 400, { error: 'A vendor ID is required' })

        const { data: vendor, error: vendorLookupError } = await supabase
          .from('vendor_profiles')
          .select('id,contact_email,company_name')
          .eq('id', match.id)
          .maybeSingle()
        if (vendorLookupError) throw vendorLookupError

        const recipient = String(vendor?.contact_email || '').trim().toLowerCase()
        if (!vendor) return jsonResponse(res, 404, { error: 'Vendor profile not found' })
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
          return jsonResponse(res, 400, { error: 'This vendor has no valid contact email address' })
        }

        const configuredAppUrl = String(process.env.VITE_APP_URL || '').trim().replace(/\/$/, '')
        const requestOrigin = String(req.headers.origin || '').trim().replace(/\/$/, '')
        const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)
        const appUrl = isLocalOrigin ? requestOrigin : configuredAppUrl || 'https://pazthrivingtribe.org'
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email: recipient,
          options: { redirectTo: `${appUrl}/vendor?reset=1` },
        })
        if (linkError) throw linkError
        const recoveryLink = linkData?.properties?.action_link
        if (!recoveryLink) throw new Error('Supabase did not return a password recovery link.')

        const vendorName = String(vendor.company_name || 'there').trim() || 'there'
        await sendResendEmail({
          to: recipient,
          subject: 'Reset your PAZ vendor password',
          html: `<p>Hi ${escapeHtml(vendorName)},</p><p>An administrator requested a password reset for your PAZ vendor account.</p><p><a href="${escapeHtml(recoveryLink)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">Reset vendor password</a></p><p>If the button does not work, copy and paste this link into your browser:</p><p>${escapeHtml(recoveryLink)}</p><p>If you did not request this, you can ignore this email.</p><p>PAZ Thriving Tribe</p>`,
          text: `Hi ${vendorName},\n\nAn administrator requested a password reset for your PAZ vendor account.\n\nReset your password here:\n${recoveryLink}\n\nIf you did not request this, you can ignore this email.\n\nPAZ Thriving Tribe`,
          from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
        })

        return jsonResponse(res, 200, { ok: true, email: recipient, companyName: vendor.company_name || '' })
      } else if (action === 'product_review') {
        const reviewPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : requestBody?.product || {}
        const requestedStatus = reviewPayload.status || 'in_review'
        if (!reviewPayload.id || !['in_review', 'approved', 'rejected', 'published'].includes(requestedStatus)) {
          return jsonResponse(res, 400, { error: 'A product ID and valid review status are required' })
        }

        let { data: product, error: productLookupError } = await supabase
          .from('store_products')
          .select('id,title,status,vendor_type,name_verified,description_verified,cover_verified,attachment_verified,amount_verified,vendor_id,price,currency,description,file_url,cover')
          .eq('id', reviewPayload.id)
          .maybeSingle()
        if (productLookupError && /amount_verified.*does not exist/i.test(productLookupError.message || '')) {
          const compatibleLookup = await supabase
            .from('store_products')
            .select('id,title,status,vendor_type,name_verified,description_verified,cover_verified,attachment_verified,vendor_id,price,currency,description,file_url,cover')
            .eq('id', reviewPayload.id)
            .maybeSingle()
          product = compatibleLookup.data
          productLookupError = compatibleLookup.error
        }
        if (productLookupError) throw productLookupError
        if (!product) return jsonResponse(res, 404, { error: 'Product not found' })

        if (reviewPayload.review_again === true) {
          const reviewUpdate = {
            status: 'in_review',
            name_verified: false,
            description_verified: false,
            cover_verified: false,
            attachment_verified: false,
            amount_verified: false,
            updated_at: new Date().toISOString(),
          }
          const { data: reviewedProduct, error: reviewError } = await supabase
            .from('store_products')
            .update(reviewUpdate)
            .eq('id', product.id)
            .select('*')
            .single()
          if (reviewError) throw reviewError

          const { data: vendor, error: vendorError } = await supabase
            .from('vendor_profiles')
            .select('contact_email,company_name')
            .eq('id', product.vendor_id)
            .maybeSingle()
          if (vendorError) throw vendorError
          const recipient = String(vendor?.contact_email || '').trim().toLowerCase()
          let emailSent = false
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
            const subject = `Product review requested: ${product.title}`
            const appUrl = String(process.env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/$/, '')
            const html = buildPazEmailTemplate({
              title: subject,
              eyebrow: 'Product review requested',
              intro: `Hi ${vendor.company_name || 'there'},`,
              accentText: `${product.title} needs another review before it can be approved.`,
              bodyHtml: `<p>Our PAZ team reviewed this product and it does not yet meet the marketplace standards.</p><p><strong>Product:</strong> ${product.title}</p><p><strong>Product ID:</strong> ${product.id}</p><p>Please update the product details, cover, amount, or attachment as needed, then resubmit it for approval from your vendor dashboard.</p>`,
              ctaLabel: 'Review product',
              ctaUrl: `${appUrl}/vendor`,
              showSecondaryCta: false,
              footerNote: 'Please review and resend this product for approval when ready.'
            })
            await sendResendEmail({ to: recipient, subject, html, text: `${product.title} (ID: ${product.id}) needs another review. Please update it in your vendor dashboard and resend it for approval.`, from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org' })
            emailSent = true
          }
          return jsonResponse(res, 200, { data: reviewedProduct, emailSent })
        }

        const nextStatus = requestedStatus
        const updatePayload = { status: nextStatus, updated_at: new Date().toISOString() }
        for (const field of ['name_verified', 'description_verified', 'cover_verified', 'attachment_verified', 'amount_verified']) {
          if (typeof reviewPayload[field] === 'boolean') updatePayload[field] = reviewPayload[field]
        }
        if (typeof reviewPayload.name_verified === 'boolean') {
          updatePayload.name_verified_at = reviewPayload.name_verified ? new Date().toISOString() : null
          updatePayload.name_verified_by = reviewPayload.name_verified ? userData.user.id : null
        }
        if (nextStatus === 'published') {
          const { data: duplicateProducts, error: duplicateError } = await supabase
            .from('store_products')
            .select('id,title')
            .eq('status', 'published')
            .ilike('title', product.title)
            .neq('id', product.id)
            .limit(1)
          if (duplicateError) throw duplicateError
          if (duplicateProducts?.length) return jsonResponse(res, 409, { error: 'A product with this name is already published in the shop.' })
          const verification = ['name_verified', 'description_verified', 'cover_verified', 'amount_verified']
          if ((product.vendor_type || 'books') === 'books') verification.push('attachment_verified')
          const missingVerification = verification.find((field) => reviewPayload[field] !== true && product[field] !== true)
          if (missingVerification) return jsonResponse(res, 400, { error: `Verify the product ${missingVerification.replace('_verified', '')} before publishing it.` })
          updatePayload.published_at = new Date().toISOString()
          updatePayload.published_by = userData.user.id
        } else if (product.status === 'published') {
          updatePayload.published_at = null
          updatePayload.published_by = null
        }

        let { data: updatedProduct, error: updateError } = await supabase
          .from('store_products')
          .update(updatePayload)
          .eq('id', product.id)
          .select('*')
          .single()
        let schemaWarning = ''
        if (updateError && /amount_verified.*does not exist/i.test(updateError.message || '')) {
          const compatiblePayload = { ...updatePayload }
          delete compatiblePayload.amount_verified
          const compatibleResult = await supabase
            .from('store_products')
            .update(compatiblePayload)
            .eq('id', product.id)
            .select('*')
            .single()
          updatedProduct = compatibleResult.data
          updateError = compatibleResult.error
          schemaWarning = 'Amount verification is waiting for the Supabase migration.'
        }
        if (updateError) throw updateError

        let emailSent = false
        if (nextStatus === 'published' && product.vendor_id) {
          const { data: vendor, error: vendorError } = await supabase
            .from('vendor_profiles')
            .select('contact_email,company_name')
            .eq('id', product.vendor_id)
            .maybeSingle()
          if (vendorError) throw vendorError
          const recipient = String(vendor?.contact_email || '').trim().toLowerCase()
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
            const appUrl = String(process.env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/$/, '')
            const productSlug = encodeURIComponent(String(product.title || product.id).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
            const productUrl = `${appUrl}/shop/${productSlug}`
            const subject = `Your product is now published: ${product.title}`
            const html = buildPazEmailTemplate({
              title: subject,
              eyebrow: 'Product published',
              intro: `Hi ${vendor.company_name || 'there'},`,
              accentText: `${product.title} (ID: ${product.id}) is now visible in the PAZ shop.`,
              bodyHtml: `<p>Your product name has been verified and the product is now live.</p><p><strong>Product ID:</strong> ${product.id}</p><p><strong>Shop link:</strong> <a href="${productUrl}">${productUrl}</a></p>`,
              ctaLabel: 'Open product in shop',
              ctaUrl: productUrl,
              showSecondaryCta: false,
              footerNote: 'Share your product link on your social media platforms.'
            })
            await sendResendEmail({ to: recipient, subject, html, text: `${product.title} is now published in the PAZ shop. Product ID: ${product.id}\nShop link: ${productUrl}`, from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org' })
            emailSent = true
          }
        }
        return jsonResponse(res, 200, { data: updatedProduct, emailSent, schemaWarning })
      } else if (action === 'product_file_signed_url') {
        if (!match?.id) return jsonResponse(res, 400, { error: 'A product ID is required' })
        const { data: product, error: productError } = await supabase
          .from('store_products')
          .select('file_url')
          .eq('id', match.id)
          .maybeSingle()
        if (productError) throw productError
        if (!product?.file_url) return jsonResponse(res, 404, { error: 'This product has no book attachment' })
        const rawPath = String(product.file_url).trim()
        const storagePath = rawPath.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/(?:sign|authenticated|public)\/product-files\//i, '').replace(/^\/+/, '')
        const signedUrlResult = await supabase.storage.from('product-files').createSignedUrl(storagePath, 3600)
        if (signedUrlResult.error) return jsonResponse(res, 404, { error: `Book preview unavailable: ${signedUrlResult.error.message || signedUrlResult.error}` })
        return jsonResponse(res, 200, { signedUrl: signedUrlResult.data?.signedUrl || null })
      } else if (!table) {
        return jsonResponse(res, 400, { error: 'Missing table' })
      } else if (action === 'count') {
        let query = supabase.from(table).select('id', { count: 'exact', head: true })
        if (match && typeof match === 'object') {
          Object.entries(match).forEach(([key, value]) => { query = query.eq(key, value) })
        }
        const { count, error } = await query
        if (error) throw error
        return jsonResponse(res, 200, { count: count || 0 })
      } else if (action === 'update') {
        if (!match) return jsonResponse(res, 400, { error: 'Missing match object for update' })
        result = await supabase.from(table).update(payload).match(match)
      } else if (action === 'insert') {
        result = await supabase.from(table).insert(payload).select()
      } else if (action === 'select') {
        let query = supabase.from(table).select(columns)
        if (match && typeof match === 'object') {
          Object.entries(match).forEach(([key, value]) => { query = query.eq(key, value) })
        }
        result = await query
      } else if (action === 'delete') {
        if (!match) return jsonResponse(res, 400, { error: 'Missing match object for delete' })
        if (table === 'promotional_ads' && match.id) {
          const { data: adToDelete, error: adLookupError } = await supabase.from('promotional_ads').select('is_platform_ad').eq('id', match.id).maybeSingle()
          if (adLookupError) return jsonResponse(res, 500, { error: `Could not verify promotional ad protection: ${adLookupError.message || adLookupError}` })
          if (adToDelete?.is_platform_ad) return jsonResponse(res, 403, { error: 'Platform promotional ads cannot be deleted' })
        }
        result = await supabase.from(table).delete().match(match)
      } else {
        return jsonResponse(res, 400, { error: 'Unknown action' })
      }
    } catch (dbErr) {
      return jsonResponse(res, 500, { error: `Database operation failed: ${dbErr?.message || dbErr}` })
    }

    const { data, error } = result
    if (error) return jsonResponse(res, 500, { error: `Database error: ${error.message || error}` })
    return jsonResponse(res, 200, { data })
  } catch (err) {
    return jsonResponse(res, 500, { error: `Unexpected error: ${err?.message || err}`, stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined })
  }
}
