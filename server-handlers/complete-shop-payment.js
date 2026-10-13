import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from './lib/resend.js';
import { buildPazEmailTemplate } from './lib/paz-email-template.js';
import { getProductAvailability } from './lib/productAvailability.js';

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function safeFilename(value, fallback) {
  const filename = String(value || fallback).replace(/[^a-z0-9._-]/gi, '-');
  return filename || fallback;
}

function formatMoney(value, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function getAdminEmails() {
  return [...new Set([
    process.env.ADMIN_EMAILS,
    process.env.VITE_ADMIN_EMAILS,
    'pazthrivingtribe@gmail.com'
  ]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isNigeriaIndependenceDay(date = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(date);
  const dateInfo = Object.fromEntries(dateParts.map(({ type, value }) => [type, Number(value)]));
  return dateInfo.month === 10 && dateInfo.day === 1;
}

export function buildCustomerProductEmail({
  customerName,
  orderNumber,
  itemSummary,
  isFreeOrder = false,
  date = new Date(),
  preview = false,
  hasPhysicalItems = false,
  deliveryAddress = null
}) {
  const isIndependenceOrder = isNigeriaIndependenceDay(date);
  const subject = isIndependenceOrder
    ? `Happy Independence Day! Your PAZ products are ready — #${orderNumber}`
    : `Your PAZ products are ready — #${orderNumber}`;
  const publicSiteUrl = String(process.env.VITE_APP_URL || 'https://pazthrivingtribe.org').replace(/\/+$/, '');
  const safeName = escapeHtml(customerName);
  const safeOrderNumber = escapeHtml(orderNumber);
  const orderItems = escapeHtml(itemSummary).split('\n').map((line) => `<div style="padding:7px 0;border-bottom:1px solid #edf0ec;">${line || '&nbsp;'}</div>`).join('');
  const addressLines = deliveryAddress
    ? [deliveryAddress.fullName, deliveryAddress.phone, deliveryAddress.addressLine1, deliveryAddress.addressLine2, [deliveryAddress.city, deliveryAddress.state, deliveryAddress.postalCode].filter(Boolean).join(', '), deliveryAddress.country].filter(Boolean)
    : [];
  const independenceMessage = isIndependenceOrder
    ? '<p style="margin:18px 0 0;color:#28623c;">Happy Independence Day! Thank you for choosing PAZ Thriving Tribe.</p>'
    : '';
  const deliveryMessage = preview
    ? 'This is a sample of your customer purchase email. No payment was collected and no files were delivered.'
    : hasPhysicalItems
      ? 'Your order is confirmed. The physical items will be delivered to your saved address by the vendor.'
      : isFreeOrder
        ? 'Your requested digital products are ready. The files are attached to this email.'
        : 'Your payment is confirmed and your digital products are ready. The files are attached to this email.';
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;color:#183228;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #e3ebe5;border-radius:18px;overflow:hidden;">
      <tr><td style="padding:27px 28px;background:#145c3d;color:#fff;"><div style="font-size:11px;font-weight:800;letter-spacing:2px;">PAZ THRIVING TRIBE</div><div style="margin-top:15px;font-size:25px;font-weight:800;line-height:1.25;">${isFreeOrder ? 'Your books are ready' : 'Thank you for your order'}</div></td></tr>
      <tr><td style="padding:27px 28px 12px;"><div style="font-size:16px;font-weight:700;">Hello ${safeName},</div><p style="margin:11px 0 0;color:#52645a;font-size:14px;line-height:1.7;">${deliveryMessage}</p>${independenceMessage}</td></tr>
      <tr><td style="padding:14px 28px 25px;"><div style="padding:16px;border-radius:12px;background:#f5f8f5;"><div style="color:#65756b;font-size:11px;font-weight:700;letter-spacing:1px;">ORDER REFERENCE</div><div style="margin-top:5px;color:#145c3d;font-size:16px;font-weight:800;">${safeOrderNumber}</div><div style="margin-top:16px;color:#65756b;font-size:11px;font-weight:700;letter-spacing:1px;">YOUR ITEMS</div><div style="margin-top:6px;color:#263a2f;font-size:13px;line-height:1.55;">${orderItems}</div>${hasPhysicalItems && addressLines.length ? `<div style="margin-top:16px;color:#65756b;font-size:11px;font-weight:700;letter-spacing:1px;">DELIVERY ADDRESS</div><div style="margin-top:6px;color:#263a2f;font-size:13px;line-height:1.55;">${addressLines.map(escapeHtml).join('<br>')}</div>` : ''}</div></td></tr>
      <tr><td style="padding:0 28px 28px;"><a href="${escapeHtml(publicSiteUrl)}" style="display:inline-block;padding:13px 19px;border-radius:9px;background:#145c3d;color:#fff;text-decoration:none;font-size:13px;font-weight:700;">Continue exploring PAZ</a><p style="margin:22px 0 0;color:#718078;font-size:12px;line-height:1.6;">Need help with your order? Reply to this email and our customer care team will be happy to help.</p></td></tr>
      <tr><td style="padding:17px 28px;border-top:1px solid #edf0ec;color:#829087;font-size:11px;line-height:1.6;">${preview ? 'Test preview only. No order was created or payment collected.' : 'With care, PAZ Thriving Tribe · Learn, grow, and thrive.'}</td></tr>
    </table>
  </body></html>`;
  const text = preview
    ? `TEST PREVIEW ONLY. No payment or delivery occurred. Sample order ${orderNumber}: ${itemSummary}`
    : `${isIndependenceOrder ? 'Happy Independence Day from PAZ Thriving Tribe! ' : ''}${hasPhysicalItems ? 'Your order is confirmed. Vendors will deliver physical items to your saved address.' : `${isFreeOrder ? 'Your requested free PAZ products' : 'Payment confirmed. Your selected PAZ products'} are attached to this email.`} Order: ${orderNumber}${hasPhysicalItems && addressLines.length ? `\nDelivery address: ${addressLines.join(', ')}` : ''}`;

  return { subject, html, text };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (error) {
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }
  }
  const email = cleanEmail(body.email);
  const reference = String(body.reference || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const isFreeOrder = body.free === true;
  const isMobileFreeOrder = isFreeOrder && body.source === 'paz-shop-mobile-app';
  const authorization = req.headers?.authorization || req.headers?.Authorization || '';
  const accessToken = /^Bearer\s+(.+)$/i.exec(String(authorization))?.[1] || '';

  if (!email) return sendJson(res, 400, { error: 'A valid customer email is required.' });
  if ((!isFreeOrder && !reference) || !items.length) return sendJson(res, 400, { error: isFreeOrder ? 'Order items are required.' : 'Payment reference and order items are required.' });

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey || !process.env.RESEND_API_KEY || (!isFreeOrder && !paystackSecret)) {
    return sendJson(res, 500, { error: 'Payment delivery is not configured on the server.' });
  }

  try {
    let transaction = null;
    if (!isFreeOrder) {
      const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${paystackSecret}` }
      });
      const verifyData = await verifyResponse.json().catch(() => ({}));
      transaction = verifyData?.data;
      if (!verifyResponse.ok || verifyData?.status !== true || transaction?.status !== 'success') {
        return sendJson(res, 402, { error: 'Paystack could not confirm this payment.' });
      }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const isMobilePaidOrder = !isFreeOrder && transaction?.metadata?.source === 'paz-shop-mobile-app';
    const isMobileOrder = isMobileFreeOrder || isMobilePaidOrder;
    let authenticatedCustomer = null;
    let deliveryAddress = null;
    if (isMobileOrder) {
      if (!accessToken) return sendJson(res, 401, { error: 'Sign in to your PAZ customer account to complete this order.' });
      const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
      authenticatedCustomer = authData?.user || null;
      if (authError || !authenticatedCustomer) {
        return sendJson(res, 401, { error: 'Your customer session is invalid or expired. Sign in again.' });
      }
      if (!authenticatedCustomer.email_confirmed_at
        || String(authenticatedCustomer.email || '').toLowerCase() !== email) {
        return sendJson(res, 403, { error: 'Confirm your account and use its email address for digital delivery.' });
      }
      if (isMobilePaidOrder && String(transaction?.metadata?.customer_id || '') !== authenticatedCustomer.id) {
        return sendJson(res, 403, { error: 'Sign in to the account used to make this payment.' });
      }
      const { data: customerProfile, error: profileError } = await supabase
        .from('customer_profiles')
        .select('delivery_address')
        .eq('id', authenticatedCustomer.id)
        .maybeSingle();
      if (profileError) throw profileError;
      deliveryAddress = customerProfile?.delivery_address || null;
    }
    const productIds = [...new Set(items.map((item) => String(item.id || '').trim()).filter(Boolean))];
    const { data: products, error: productsError } = await supabase
      .from('store_products')
      .select('id,title,price,currency,file_url,is_free,status,vendor_id,vendor_type,release_enabled,release_at,close_at,allow_after_close')
      .in('id', productIds);

    if (productsError) throw productsError;

    const unavailableProduct = (products || []).find(
      (product) => product.status === 'pending' || product.status === 'rejected',
    );
    if (unavailableProduct) {
      return sendJson(res, 400, { error: 'One or more products are waiting for admin approval.' });
    }

    const productMap = new Map((products || []).map((product) => [String(product.id), product]));
    const normalizedItems = items.map((item) => {
      const product = productMap.get(String(item.id || ''));
      return {
        product,
        quantity: Math.max(1, Number(item.quantity || 1))
      };
    });

    if (normalizedItems.some((item) => !item.product)) {
      return sendJson(res, 400, { error: 'One or more purchased products are no longer available.' });
    }
    const hasPhysicalItems = normalizedItems.some(({ product }) => (product.vendor_type || 'books') !== 'books');
    if (isFreeOrder && hasPhysicalItems) {
      return sendJson(res, 400, { error: 'Physical products cannot be requested through free digital delivery.' });
    }
    if (hasPhysicalItems) {
      if (!authenticatedCustomer) {
        if (!accessToken) return sendJson(res, 401, { error: 'Sign in to complete a physical product order.' });
        const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
        authenticatedCustomer = authData?.user || null;
        if (authError || !authenticatedCustomer) return sendJson(res, 401, { error: 'Your customer session is invalid or expired. Sign in again.' });
      }
      if (!authenticatedCustomer.email_confirmed_at
        || String(authenticatedCustomer.email || '').trim().toLowerCase() !== email) {
        return sendJson(res, 403, { error: 'Use the confirmed email address linked to your customer account for delivery.' });
      }
      if (!deliveryAddress) {
        const { data: customerProfile, error: profileError } = await supabase
          .from('customer_profiles')
          .select('delivery_address')
          .eq('id', authenticatedCustomer.id)
          .maybeSingle();
        if (profileError) throw profileError;
        deliveryAddress = customerProfile?.delivery_address || null;
      }
      const requiredAddressFields = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'country'];
      if (!deliveryAddress || requiredAddressFields.some((field) => !String(deliveryAddress[field] || '').trim())) {
        return sendJson(res, 400, { error: 'Save a complete delivery address in your customer account before completing this physical product order.' });
      }
      if (transaction?.metadata?.customer_id
        && String(transaction.metadata.customer_id) !== authenticatedCustomer.id) {
        return sendJson(res, 403, { error: 'Sign in to the account used to start this payment.' });
      }
    }

    const transactionCreatedAt = transaction?.created_at ? new Date(transaction.created_at) : null;
    const checkoutTime = transactionCreatedAt && !Number.isNaN(transactionCreatedAt.getTime())
      ? transactionCreatedAt
      : new Date();
    const unavailableScheduledItem = normalizedItems.find(({ product }) =>
      !getProductAvailability(product, checkoutTime).available,
    );
    if (unavailableScheduledItem) {
      const availability = getProductAvailability(unavailableScheduledItem.product, checkoutTime);
      return sendJson(res, 400, {
        error: `${unavailableScheduledItem.product.title || 'This product'}: ${availability.message}`,
      });
    }

    if (isFreeOrder && normalizedItems.some((item) => !item.product.is_free)) {
      return sendJson(res, 400, { error: 'This free delivery request includes a paid product.' });
    }

    const paidCurrencies = [...new Set(normalizedItems
      .filter((item) => !item.product.is_free)
      .map((item) => String(item.product.currency || 'NGN').toUpperCase()))];
    if (paidCurrencies.length > 1) {
      return sendJson(res, 400, { error: 'Products with different currencies must be purchased separately.' });
    }

    const orderCurrency = paidCurrencies[0] || 'NGN';
    const expectedAmount = normalizedItems.reduce((sum, item) => sum + Number(item.product.price || 0) * item.quantity, 0);
    if (!isFreeOrder && String(transaction.currency || 'NGN').toUpperCase() !== orderCurrency) {
      return sendJson(res, 402, { error: `This payment must be completed in ${orderCurrency}.` });
    }
    if (!isFreeOrder && Number(transaction.amount) !== Math.round(expectedAmount * 100)) {
      return sendJson(res, 402, { error: 'The payment amount does not match this order.' });
    }

    const orderNumber = String(body.orderNumber || `PAZ-${Date.now().toString().slice(-6)}`);
    if (!isFreeOrder) {
      const vendorSales = normalizedItems
        .filter((item) => item.product.vendor_id)
        .map((item) => {
          const grossAmount = Number(item.product.price || 0) * item.quantity;
          const platformFee = Math.round(grossAmount * 0.15 * 100) / 100;
          return {
            vendor_id: item.product.vendor_id,
            order_number: orderNumber,
            product_id: item.product.id,
            product_title: item.product.title,
            quantity: item.quantity,
            gross_amount: grossAmount,
            platform_fee: platformFee,
            vendor_amount: Math.round((grossAmount - platformFee) * 100) / 100,
            currency: orderCurrency,
            payout_status: 'pending'
          };
        });
      if (vendorSales.length) {
        const { error: vendorSalesError } = await supabase.from('vendor_sales').insert(vendorSales);
        if (vendorSalesError) console.warn('Vendor sale ledger update failed:', vendorSalesError.message);
      }
    }

    const downloadableItems = normalizedItems.filter(({ product }) => (product.vendor_type || 'books') === 'books');
    const attachments = [];
    const missingFiles = [];
    for (const item of downloadableItems) {
      const filePath = String(item.product.file_url || '').trim();
      if (!filePath) {
        missingFiles.push(item.product.title || 'Untitled product');
        continue;
      }

      let fileResponse;
      const sourceFilename = filePath.split('?')[0].split('/').pop() || '';
      const extensionMatch = sourceFilename.match(/(\.[a-z0-9]{1,8})$/i);
      const productFilename = `${safeFilename(item.product.title, 'product-file')}${extensionMatch ? extensionMatch[1].toLowerCase() : ''}`;
      if (/^https?:\/\//i.test(filePath)) {
        fileResponse = await fetch(filePath);
      } else {
        const storagePath = filePath
          .replace(/^\/storage\/v1\/object\/(?:public|authenticated|sign)\/product-files\//i, '')
          .replace(/^product-files\//i, '')
          .replace(/^\/+/, '');
        const { data: fileData, error: fileError } = await supabase.storage.from('product-files').download(storagePath);
        if (fileError) {
          console.warn(`Product file unavailable for ${item.product.title}:`, fileError.message);
          missingFiles.push(item.product.title || 'Untitled product');
          continue;
        }
        const buffer = Buffer.from(await fileData.arrayBuffer());
        attachments.push({ filename: productFilename, content: buffer.toString('base64') });
        continue;
      }

      if (fileResponse?.ok) {
        const buffer = Buffer.from(await fileResponse.arrayBuffer());
        attachments.push({ filename: productFilename, content: buffer.toString('base64') });
      } else {
        missingFiles.push(item.product.title || 'Untitled product');
      }
    }

    if (attachments.length !== downloadableItems.length) {
      const missingProductNames = [...new Set(missingFiles)].join(', ') || 'one or more selected products';
      return sendJson(res, 503, {
        error: `Payment was verified, but downloadable files are missing for: ${missingProductNames}. Upload each product file in the admin Store panel, then retry delivery from the verified order.`
      });
    }

    const customerName = String(body.customerName || 'Customer').trim();
    const { data: existingOrder, error: existingOrderError } = await supabase
      .from('shop_orders')
      .select('id,email')
      .eq('order_number', orderNumber)
      .maybeSingle();
    if (existingOrderError) throw existingOrderError;
    if (existingOrder?.email && String(existingOrder.email).toLowerCase() !== email) {
      throw new Error('The order number is already associated with another customer.');
    }

    let savedOrderId = existingOrder?.id;
    if (!savedOrderId) {
      const { data: savedOrder, error: saveOrderError } = await supabase
        .from('shop_orders')
        .insert({
          order_number: orderNumber,
          customer_name: customerName,
          email,
          customer_id: authenticatedCustomer?.id || null,
          delivery_address: deliveryAddress,
          subtotal: expectedAmount,
          total: expectedAmount,
          currency: orderCurrency,
          status: isFreeOrder ? 'completed' : 'paid',
          payment_reference: reference || null,
          payment_mode: isFreeOrder ? 'free' : 'live',
        })
        .select('id')
        .single();
      if (saveOrderError) throw saveOrderError;
      savedOrderId = savedOrder.id;
    }

    const { data: savedItems, error: savedItemsError } = await supabase
      .from('shop_order_items')
      .select('id')
      .eq('order_id', savedOrderId)
      .limit(1);
    if (savedItemsError) throw savedItemsError;
    if (!savedItems?.length) {
      const { error: saveItemsError } = await supabase
        .from('shop_order_items')
        .insert(normalizedItems.map(({ product, quantity }) => ({
          order_id: savedOrderId,
          product_id: String(product.id),
          title: String(product.title || 'PAZ product'),
          price: Number(product.price || 0),
          quantity,
        })));
      if (saveItemsError) throw saveItemsError;
    }

    const itemSummary = normalizedItems.map(({ product, quantity }) => `• ${product.title} x${quantity}`).join('\n');
    const customerEmail = buildCustomerProductEmail({
      customerName,
      orderNumber,
      itemSummary,
      isFreeOrder,
      hasPhysicalItems,
      deliveryAddress,
    });
    const { subject, html, text } = customerEmail;
    const adminRecipients = getAdminEmails();
    const physicalVendorItems = normalizedItems.filter(({ product }) =>
      (product.vendor_type || 'books') !== 'books' && product.vendor_id,
    );
    const physicalVendorIds = [...new Set(physicalVendorItems.map(({ product }) => product.vendor_id))];
    const vendorContactsById = new Map();
    if (physicalVendorIds.length) {
      const { data: vendorContacts, error: vendorContactsError } = await supabase
        .from('vendor_profiles')
        .select('id,company_name,contact_email')
        .in('id', physicalVendorIds);
      if (vendorContactsError) throw vendorContactsError;
      for (const vendor of vendorContacts || []) vendorContactsById.set(vendor.id, vendor);
    }
    const vendorNotifications = [...new Set(physicalVendorItems.map(({ product }) => product.vendor_id))]
      .map((vendorId) => {
        const vendor = vendorContactsById.get(vendorId);
        const recipient = cleanEmail(vendor?.contact_email);
        if (!recipient) return null;
        const vendorItems = physicalVendorItems
          .filter(({ product }) => product.vendor_id === vendorId)
          .map(({ product, quantity }) => `${product.title} x${quantity}`);
        const vendorSubject = `Physical order to deliver — ${orderNumber}`;
        const deliveryLines = [
          deliveryAddress.fullName,
          deliveryAddress.phone,
          deliveryAddress.addressLine1,
          deliveryAddress.addressLine2,
          [deliveryAddress.city, deliveryAddress.state, deliveryAddress.postalCode].filter(Boolean).join(', '),
          deliveryAddress.country,
        ].filter(Boolean);
        const vendorHtml = buildPazEmailTemplate({
          title: vendorSubject,
          eyebrow: 'New physical product order',
          intro: `Hello ${escapeHtml(vendor.company_name || 'vendor')},`,
          accentText: 'A customer has paid for your physical products. Please arrange delivery to the saved address.',
          bodyHtml: `<p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p><p><strong>Customer:</strong> ${escapeHtml(customerName)}</p><p><strong>Customer email:</strong> ${escapeHtml(email)}</p><p><strong>Items to deliver:</strong><br>${vendorItems.map(escapeHtml).join('<br>')}</p><p><strong>Delivery address:</strong><br>${deliveryLines.map(escapeHtml).join('<br>')}</p><p>Please contact the customer using the details above to coordinate delivery.</p>`,
          ctaLabel: 'Open vendor dashboard',
          ctaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/vendor`,
          showSecondaryCta: false,
          footerNote: 'This order notification contains customer delivery information. Keep it private.',
        });
        return sendResendEmail({
          to: recipient,
          subject: vendorSubject,
          html: vendorHtml,
          text: `${vendorSubject}. Customer: ${customerName} (${email}). Items: ${vendorItems.join(', ')}. Delivery address: ${deliveryLines.join(', ')}. Please contact the customer to coordinate delivery.`,
          attachments: [],
        });
      })
      .filter(Boolean);
    const vendorsWithoutEmail = physicalVendorIds.filter((vendorId) =>
      !cleanEmail(vendorContactsById.get(vendorId)?.contact_email),
    );
    const adminSubject = isFreeOrder ? `Free product requested — ${orderNumber}` : `Payment received — ${orderNumber}`;
    const adminHtml = buildPazEmailTemplate({
      title: adminSubject,
      eyebrow: 'Payment received',
      intro: 'Hello PAZ team,',
      accentText: isFreeOrder ? 'A free product request has been completed.' : 'A Paystack payment has been verified successfully.',
      bodyHtml: `<p><strong>${isFreeOrder ? 'Free product request completed.' : 'Payment confirmed.'}</strong> A customer has completed a ${isFreeOrder ? 'free product request' : 'purchase'} on the PAZ storefront.</p><p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p><p><strong>Customer:</strong> ${escapeHtml(customerName)}</p><p><strong>Customer email:</strong> ${escapeHtml(email)}</p><p><strong>Items:</strong><br>${escapeHtml(itemSummary).replace(/\n/g, '<br>')}</p>${hasPhysicalItems && deliveryAddress ? `<p><strong>Delivery address:</strong><br>${[deliveryAddress.fullName, deliveryAddress.phone, deliveryAddress.addressLine1, deliveryAddress.addressLine2, [deliveryAddress.city, deliveryAddress.state, deliveryAddress.postalCode].filter(Boolean).join(', '), deliveryAddress.country].filter(Boolean).map(escapeHtml).join('<br>')}</p>` : ''}${vendorsWithoutEmail.length ? `<p><strong>Vendor notification needs attention:</strong> ${vendorsWithoutEmail.length} vendor account(s) have no valid contact email.</p>` : ''}${isFreeOrder ? '' : `<p><strong>Verified amount:</strong> ${formatMoney(transaction.amount / 100, orderCurrency)}</p>`}<p>${hasPhysicalItems ? 'Vendor delivery notifications have been sent where contact emails are available.' : 'The customer has received the selected product files as email attachments.'}</p>`,
      productName: 'PAZ digital products',
      ctaLabel: 'Open admin dashboard',
      ctaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/admin`,
      showSecondaryCta: true,
      secondaryCtaLabel: 'Payment history',
      secondaryCtaUrl: `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/dashboard?view=payment-history&reference=${encodeURIComponent(reference)}`,
      footerNote: 'Internal payment notification for PAZ Thriving Tribe.'
    });
    await Promise.all([
      sendResendEmail({
        to: email,
        subject,
        html,
        text,
        attachments
      }),
      ...adminRecipients.map((recipient) => sendResendEmail({
        to: recipient,
        subject: adminSubject,
        html: adminHtml,
        text: `${isFreeOrder ? 'Free product request received' : 'Payment received and verified'}. Order: ${orderNumber}. Customer: ${customerName} (${email}). Items: ${itemSummary}.${isFreeOrder ? '' : ` Amount: ${formatMoney(transaction.amount / 100, orderCurrency)}.`}`,
        attachments: []
      })),
      ...vendorNotifications
    ]);

    const { error: fulfilledNotificationsError } = await supabase
      .from('product_release_notifications')
      .update({ status: 'purchased', next_notification_at: null })
      .eq('email', email)
      .eq('status', 'active')
      .in('product_id', productIds);
    if (fulfilledNotificationsError) {
      console.warn('Could not stop release reminders after delivery:', fulfilledNotificationsError.message);
    }

    return sendJson(res, 200, { success: true, orderNumber, attachmentCount: attachments.length });
  } catch (error) {
    console.error('Shop payment completion failed:', error);
    return sendJson(res, 500, { error: 'Payment was verified, but product delivery could not be completed.', details: error.message });
  }
}
