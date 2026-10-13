import adminAuthHandler from '../server-handlers/admin-auth.js';
import adminAccessHandler from '../server-handlers/admin-access.js';
import adminHealthHandler from '../server-handlers/admin-health.js';
import adminUpdateHandler from '../server-handlers/admin-update.js';
import adminCustomersHandler from '../server-handlers/admin-customers.js';
import customerNotificationsHandler from '../server-handlers/customer-notifications.js';
import completeShopPaymentHandler from '../server-handlers/complete-shop-payment.js';
import initializeShopPaymentHandler from '../server-handlers/initialize-shop-payment.js';
import currencyRatesHandler from '../server-handlers/currency-rates.js';
import fetchMetaHandler from '../server-handlers/fetch-meta.js';
import paystackWebhookHandler from '../server-handlers/paystack-webhook.js';
import resendWebhookHandler from '../server-handlers/resend-webhook.js';
import sendNotificationEmailHandler from '../server-handlers/send-notification-email.js';
import sendRegistrationEmailHandler from '../server-handlers/send-registration-email.js';
import trackVisitorHandler from '../server-handlers/track-visitor.js';
import completeServicePaymentHandler from '../server-handlers/complete-service-payment.js';
import productPreviewHandler from '../server-handlers/product-preview.js';
import vendorSupportHandler from '../server-handlers/vendor-support.js';
import customerSupportHandler from '../server-handlers/customer-support.js';
import resolveBankAccountHandler from '../server-handlers/resolve-bank-account.js';
import storeProductsPublicHandler from '../server-handlers/store-products-public.js';
import vendorPasswordResetEmailHandler from '../server-handlers/vendor-password-reset-email.js';
import vendorPinChangedEmailHandler from '../server-handlers/vendor-pin-changed-email.js';
import activityNotificationHandler from '../server-handlers/activity-notification.js';
import testimonialSubmissionHandler from '../server-handlers/testimonial-submission.js';
import generateProductDescriptionHandler from '../server-handlers/generate-product-description.js';
import mentorShopOrderHandler from '../server-handlers/mentor-shop-order.js';
import productReleaseNotificationHandler from '../server-handlers/product-release-notification.js';
import productMetricsHandler from '../server-handlers/product-metrics.js';
import productRatingsHandler from '../server-handlers/product-ratings.js';
import releaseNotificationsHandler from '../server-handlers/release-notifications.js';
import productChatHandler from '../server-handlers/product-chat.js';
import vendorProductChatHandler from '../server-handlers/vendor-product-chat.js';
import appDownloadHandler from '../server-handlers/app-download.js';

const handlers = {
  '/app-download': appDownloadHandler,
  '/admin-auth': adminAuthHandler,
  '/admin-access': adminAccessHandler,
  '/admin-health': adminHealthHandler,
  '/admin-update': adminUpdateHandler,
  '/admin-customers': adminCustomersHandler,
  '/customer-notifications': customerNotificationsHandler,
  '/complete-shop-payment': completeShopPaymentHandler,
  '/initialize-shop-payment': initializeShopPaymentHandler,
  '/product-release-notification': productReleaseNotificationHandler,
  '/release-notifications': releaseNotificationsHandler,
  '/product-chat': productChatHandler,
  '/vendor-product-chat': vendorProductChatHandler,
  '/complete-service-payment': completeServicePaymentHandler,
  '/product-preview': productPreviewHandler,
  '/vendor-support': vendorSupportHandler,
  '/customer-support': customerSupportHandler,
  '/resolve-bank-account': resolveBankAccountHandler,
  '/store-products-public': storeProductsPublicHandler,
  '/product-metrics': productMetricsHandler,
  '/product-ratings': productRatingsHandler,
  '/vendor-password-reset-email': vendorPasswordResetEmailHandler,
  '/vendor-pin-changed-email': vendorPinChangedEmailHandler,
  '/activity-notification': activityNotificationHandler,
  '/testimonial-submission': testimonialSubmissionHandler,
  '/generate-product-description': generateProductDescriptionHandler,
  '/mentor-shop-order': mentorShopOrderHandler,
  '/currency-rates': currencyRatesHandler,
  '/fetch-meta': fetchMetaHandler,
  '/paystack-webhook': paystackWebhookHandler,
  '/resend-webhook': resendWebhookHandler,
  '/send-notification-email': sendNotificationEmailHandler,
  '/send-registration-email': sendRegistrationEmailHandler,
  '/track-visitor': trackVisitorHandler,
  '/webhook': resendWebhookHandler
};

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') return res.status(statusCode).json(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = requestUrl.pathname.startsWith('/api/')
    ? requestUrl.pathname.slice('/api'.length)
    : requestUrl.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const routeHandler = handlers[route];

  if (!routeHandler) return sendJson(res, 404, { error: 'API route not found' });

  req.query = Object.fromEntries(requestUrl.searchParams.entries());

  try {
    return await routeHandler(req, res);
  } catch (error) {
    console.error(`API Error (${route}):`, error);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}
