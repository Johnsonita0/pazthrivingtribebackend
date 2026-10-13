import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';

function isRealProductDownloadUrl(value) {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  return !/^(https?:\/\/)?(www\.)?example\.com(\/|$)/i.test(trimmed);
}

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(payload);
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getAdminEmails() {
  const configuredEmails = [
    process.env.ADMIN_EMAILS,
    process.env.VITE_ADMIN_EMAILS,
    'pazthrivingtribe@gmail.com'
  ]
    .flatMap((value) => String(value || '').split(',').map((email) => email.trim()))
    .filter(Boolean)
    .map((email) => email.toLowerCase());

  return [...new Set(configuredEmails)];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { email, service, timestamp, message, productMessage, customMessage, attachmentName, customerName, orderNumber, itemSummary, productFileUrl, fileUrl, productName, itemName, paymentReference, reference } = body;
  const rawAttachments = Array.isArray(body?.attachments)
    ? body.attachments
    : Array.isArray(body?.productAttachments)
      ? body.productAttachments
      : [];

  if (!email || !service) {
    return sendJson(res, 400, { error: 'Missing required fields' });
  }

  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return sendJson(res, 400, { error: 'Invalid email address' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/service_notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`
          },
          body: JSON.stringify({
            email: cleanEmail,
            service,
            status: 'active',
            created_at: timestamp || new Date().toISOString()
          })
        });
      } catch (dbError) {
        console.log('Note: Could not store email in database, continuing with notification');
      }
    }

    const deliveryMessage = (productMessage || customMessage || message || '').toString().trim();
    const itemList = itemSummary ? `<p><strong>Order items:</strong><br>${String(itemSummary).replace(/\n/g, '<br>')}</p>` : '';
    const resolvedCustomerName = (customerName || '').toString().trim() || 'there';
    const orderProductDownloadUrl = [productFileUrl, fileUrl, body?.downloadUrl, body?.productUrl].find((value) => isRealProductDownloadUrl(value)) || '';
    const resolvedProductName = (productName || itemName || 'your product').toString().trim() || 'your product';
    const resolvedAttachmentName = String(attachmentName || resolvedProductName || 'product-file.pdf').trim() || 'product-file.pdf';
    const hasCompletedOrderSignal = Boolean(orderNumber) || /order|purchase|checkout|shop/i.test(String(service || ''));
    const adminRecipients = getAdminEmails();
    const customerRecipients = Array.from(new Set([cleanEmail].filter(Boolean)));
    const productAttachmentFilename = resolvedAttachmentName.includes('.') ? resolvedAttachmentName : `${resolvedProductName.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    const orderReceiptSubject = orderNumber ? `Your PAZ order has been received — #${orderNumber}` : 'Your PAZ order has been received';
    const productReadySubject = orderNumber ? `Your PAZ product is ready to download — #${orderNumber}` : 'Your PAZ product is ready to download';
    const orderNotificationSubject = orderNumber ? `PAZ payment confirmation required — #${orderNumber}` : 'PAZ payment confirmation required';

    const customerReceiptHTML = buildPazEmailTemplate({
      title: orderReceiptSubject,
      eyebrow: 'Order update',
      intro: `Hi ${resolvedCustomerName},`,
      accentText: deliveryMessage || 'Your order has been received successfully.',
      bodyHtml: `
        <p><strong>We’ve received your order.</strong></p>
        <p>${(deliveryMessage || 'Thank you for choosing PAZ Thriving Tribe.').replace(/\n/g, '<br>')}</p>
        ${itemList || '<p><strong>Order status:</strong> Your order is pending confirmation by our admin team.</p>'}
        ${orderNumber ? `<p><strong>Order number:</strong> ${orderNumber}</p>` : ''}
        <p><strong>Next step:</strong> Once payment is confirmed by our admin team, we will send your product download email with the file attached.</p>
        <p><strong>Customer email:</strong> ${cleanEmail}</p>
      `,
      productDownloadUrl: '',
      productName: resolvedProductName,
      ctaLabel: 'Book for a session',
      ctaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/book-session`,
      secondaryCtaLabel: 'Apply for a session',
      secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/teens_reg`,
      footerNote: 'Thank you for shopping with PAZ Thriving Tribe.'
    });

    const productReadyEmailHTML = buildPazEmailTemplate({
      title: productReadySubject,
      eyebrow: 'Order update',
      intro: `Hi ${resolvedCustomerName},`,
      accentText: deliveryMessage || 'Your package is ready to download.',
      bodyHtml: `
        <p><strong>Your product is ready.</strong></p>
        <p>${(deliveryMessage || 'Thank you for choosing PAZ Thriving Tribe.').replace(/\n/g, '<br>')}</p>
        ${itemList || '<p><strong>Order status:</strong> Your payment has been confirmed and your download is ready.</p>'}
        ${orderNumber ? `<p><strong>Order number:</strong> ${orderNumber}</p>` : ''}
        ${orderProductDownloadUrl ? `<p><strong>Download link:</strong> <a href="${orderProductDownloadUrl}" style="color:#123d35;font-weight:700;">Open product file</a></p>` : ''}
        ${resolvedAttachmentName ? `<p><strong>Product file:</strong> ${resolvedAttachmentName}</p>` : ''}
        <p><strong>Customer email:</strong> ${cleanEmail}</p>
      `,
      productDownloadUrl: orderProductDownloadUrl,
      productName: resolvedProductName,
      ctaLabel: orderProductDownloadUrl ? 'Download product' : 'Apply for a session',
      ctaUrl: orderProductDownloadUrl || `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/teens_reg`,
      secondaryCtaLabel: 'Book for a session',
      secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/book-session`,
      footerNote: 'Your product has been released by PAZ Thriving Tribe.'
    });

    const adminDashboardUrl = `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/admin`;
    const adminEmailHTML = buildPazEmailTemplate({
      title: orderNotificationSubject,
      eyebrow: 'Admin notification',
      intro: `Hello PAZ team,`,
      accentText: `A new order was placed and needs attention.`,
      bodyHtml: `
        <p><strong>New order alert:</strong> A customer has placed an order and payment confirmation is required.</p>
        ${itemList || '<p><strong>Order status:</strong> Customer order has been created and is awaiting admin review.</p>'}
        ${orderNumber ? `<p><strong>Order number:</strong> ${orderNumber}</p>` : ''}
        <p><strong>Customer name:</strong> ${resolvedCustomerName}</p>
        <p><strong>Customer email:</strong> ${cleanEmail}</p>
        <p><strong>Action required:</strong> Please confirm payment in the dashboard, then send the product delivery email with the downloadable file attached.</p>
      `,
      productDownloadUrl: '',
      productName: resolvedProductName,
      ctaLabel: 'View order in dashboard',
      ctaUrl: adminDashboardUrl,
      showSecondaryCta: true,
      secondaryCtaLabel: 'Payment history',
      secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/dashboard?view=payment-history${(paymentReference || reference) ? `&reference=${encodeURIComponent(paymentReference || reference)}` : ''}`,
      footerNote: 'This is an internal order notification for PAZ Thriving Tribe.'
    });

    const normalizedAttachmentList = rawAttachments
      .filter((entry) => entry && (entry.url || entry.content || entry.filename))
      .map((entry) => {
        if (entry.url && entry.filename) return { filename: entry.filename, url: entry.url };
        if (entry.content && entry.filename) return { filename: entry.filename, content: String(entry.content) };
        if (typeof entry === 'string' && isRealProductDownloadUrl(entry)) return { filename: productAttachmentFilename, url: entry };
        return null;
      })
      .filter(Boolean);

    const attachments = normalizedAttachmentList.length
      ? normalizedAttachmentList
      : isRealProductDownloadUrl(orderProductDownloadUrl)
        ? [{
            filename: productAttachmentFilename,
            url: orderProductDownloadUrl
          }]
        : [];

    if (String(service).toLowerCase().includes('product delivery') || String(service).toLowerCase().includes('delivery')) {
      await sendResendEmail({
        to: customerRecipients,
        subject: productReadySubject,
        html: productReadyEmailHTML,
        text: `Your PAZ product is ready to download. Please use the attached file or download link in the email.`,
        from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
        attachments
      });

      console.log(`✓ Product-ready email sent to: ${customerRecipients.join(', ')}`);
    } else if (hasCompletedOrderSignal && adminRecipients.length) {
      await sendResendEmail({
        to: adminRecipients,
        subject: orderNotificationSubject,
        html: adminEmailHTML,
        text: `New PAZ order received. Customer: ${cleanEmail}. Please review and confirm payment before sending the product email.`,
        from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org'
      });

      await sendResendEmail({
        to: customerRecipients,
        subject: orderReceiptSubject,
        html: customerReceiptHTML,
        text: `Your PAZ order has been received. We will send your product download email once payment is confirmed by admin.`,
        from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
        attachments: []
      });

      console.log(`✓ Admin order notification sent to: ${adminRecipients.join(', ')}`);
      console.log(`✓ Customer order confirmation sent to: ${customerRecipients.join(', ')}`);
    } else {
      if (adminRecipients.length) {
        await sendResendEmail({
          to: adminRecipients,
          subject: `New notification request — ${service}`,
          html: `<p>A visitor requested an email notification from the PAZ portal.</p><p><strong>Email:</strong> ${cleanEmail}</p><p><strong>Service:</strong> ${String(service).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
          text: `New PAZ notification request. Email: ${cleanEmail}. Service: ${service}`,
          from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org'
        });
      }
      await sendResendEmail({
        to: cleanEmail,
        subject: orderReceiptSubject,
        html: customerReceiptHTML,
        text: `PAZ Thriving Tribe\n\n${deliveryMessage || 'Thank you for choosing PAZ Thriving Tribe.'}`,
        from: process.env.RESEND_FROM_EMAIL || 'notifications@pazthrivingtribe.org',
        attachments
      });

      console.log(`✓ Receipt email sent to: ${cleanEmail}`);
    }

    return sendJson(res, 200, {
      success: true,
      subject: subjectLine,
      message: 'Thank you for subscribing! Check your email for confirmation.',
      data: {
        email: cleanEmail,
        service,
        subject: subjectLine,
        subscribedAt: timestamp || new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error processing notification:', error);
    return sendJson(res, 500, {
      error: 'The product email could not be sent.',
      details: error.message
    });
  }
}
